import type { PlatformMessage } from '@kitty/platforms/message';
import { writeDebugLog } from '@kitty/shared/logging';
import type { GroupChatCadenceDecision, GroupChatCadencePort } from './cadence-type';

/** 群聊节奏配置 */
export interface GroupChatCadenceConfig {
  /** 机器人QQ号 */
  readonly selfQqId: string;
  /** 当前时间 */
  readonly now?: () => Date;
  /** 随机数 */
  readonly random?: () => number;
  /** 回复后初始延迟毫秒 */
  readonly postReplyInitialDelayMs?: number;
  /** 回复后延迟递增毫秒 */
  readonly postReplyDelayStepMs?: number;
  /** 回复后最大延迟毫秒 */
  readonly postReplyMaxDelayMs?: number;
  /** 回复后初始计数 */
  readonly postReplyInitialMessageCount?: number;
  /** 回复后计数递增 */
  readonly postReplyMessageCountStep?: number;
  /** 回复后最大计数 */
  readonly postReplyMaxMessageCount?: number;
  /** 跨群主动触发最小间隔毫秒 */
  readonly proactiveGlobalMinimumIntervalMs?: number;
}

interface RandomReplyWindow {
  /** 所属小时 */
  readonly hourKey: string;
  /** 小时内开始毫秒 */
  readonly startMs: number;
  /** 小时内结束毫秒 */
  readonly endMs: number;
  /** 是否已触发 */
  consumed: boolean;
}

interface ConversationCadenceState {
  /** 最近消息去重窗口 */
  readonly messages: PlatformMessage[];
  /** 当前小时随机片段 */
  randomWindow?: RandomReplyWindow;
  /** 回复后观察截止时间 */
  postReplyDueAtMs?: number;
  /** 回复后新增消息数 */
  postReplyMessageCount: number;
  /** 下一轮等待毫秒 */
  nextDelayMs: number;
  /** 下一轮消息门槛 */
  nextMessageThreshold: number;
}

const RECENT_MESSAGE_LIMIT = 100;
const QUIET_START_HOUR = 1;
const QUIET_END_HOUR = 7;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const DEFAULT_INITIAL_DELAY_MS = 10 * MILLISECONDS_PER_MINUTE;
const DEFAULT_DELAY_STEP_MS = 10 * MILLISECONDS_PER_MINUTE;
const DEFAULT_MAX_DELAY_MS = 60 * MILLISECONDS_PER_MINUTE;
const DEFAULT_INITIAL_MESSAGE_COUNT = 10;
const DEFAULT_MESSAGE_COUNT_STEP = 10;
const DEFAULT_MAX_MESSAGE_COUNT = 50;
const DEFAULT_GLOBAL_MINIMUM_INTERVAL_MS = 2 * MILLISECONDS_PER_MINUTE;
const REGULAR_RANDOM_WINDOW_MINUTES = 2;
const LEISURE_RANDOM_WINDOW_MINUTES = 5;

/**
 * 群聊节奏控制器
 *
 * 让未 @ 群聊先经过随机观察片段、回复后计时计数器和跨群主动预算，
 * 再决定是否触发 Agent，避免高活跃群同时占满模型请求池。
 */
export class GroupChatCadenceController implements GroupChatCadencePort {
  private readonly states = new Map<string, ConversationCadenceState>();
  /** 下一次主动触发时间 */
  private nextProactiveTriggerAtMs = 0;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly postReplyInitialDelayMs: number;
  private readonly postReplyDelayStepMs: number;
  private readonly postReplyMaxDelayMs: number;
  private readonly postReplyInitialMessageCount: number;
  private readonly postReplyMessageCountStep: number;
  private readonly postReplyMaxMessageCount: number;
  private readonly proactiveGlobalMinimumIntervalMs: number;

  constructor(private readonly config: GroupChatCadenceConfig) {
    this.now = config.now ?? (() => new Date());
    this.random = config.random ?? Math.random;
    this.postReplyInitialDelayMs = config.postReplyInitialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    this.postReplyDelayStepMs = config.postReplyDelayStepMs ?? DEFAULT_DELAY_STEP_MS;
    this.postReplyMaxDelayMs = config.postReplyMaxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.postReplyInitialMessageCount =
      config.postReplyInitialMessageCount ?? DEFAULT_INITIAL_MESSAGE_COUNT;
    this.postReplyMessageCountStep = config.postReplyMessageCountStep ?? DEFAULT_MESSAGE_COUNT_STEP;
    this.postReplyMaxMessageCount = config.postReplyMaxMessageCount ?? DEFAULT_MAX_MESSAGE_COUNT;
    this.proactiveGlobalMinimumIntervalMs =
      config.proactiveGlobalMinimumIntervalMs ?? DEFAULT_GLOBAL_MINIMUM_INTERVAL_MS;
  }

  /**
   * 记录群聊消息
   * @param event 标准消息
   */
  recordMessage(event: PlatformMessage): void {
    if (event.conversationType !== 'group') return;

    const state = this.getState(event.conversationId);
    if (state.messages.some((message) => message.message.id === event.message.id)) return;

    state.messages.push(event);
    if (state.messages.length > RECENT_MESSAGE_LIMIT) {
      state.messages.splice(0, state.messages.length - RECENT_MESSAGE_LIMIT);
    }

    if (!this.isSelfMessage(event) && state.postReplyDueAtMs) {
      state.postReplyMessageCount += 1;
    }
  }

  /**
   * 判断当前消息是否触发Agent
   * @param event 标准消息
   * @returns 节奏门控结果
   */
  shouldTrigger(event: PlatformMessage): GroupChatCadenceDecision {
    if (event.conversationType !== 'group') return ignoreDecision('非群聊消息不走群聊节奏门控');

    if (this.isMentioningAgent(event)) {
      return triggerDecision('mention', false, '群聊消息明确@叶猫猫，立即触发回复');
    }

    const state = this.getState(event.conversationId);
    const currentTime = this.now();

    if (this.isQuietHour(currentTime)) {
      this.clearPostReplyWatch(state);
      return ignoreDecision('当前处于 01:00-07:00 休息时段，未@群聊不主动回复');
    }

    if (state.postReplyDueAtMs && currentTime.getTime() < state.postReplyDueAtMs) {
      return waitDecision('回复后冷却尚未到期，暂不检查随机回复片段');
    }

    if (this.isPostReplyCounterReached(state, currentTime)) {
      if (!this.tryReserveProactiveBudget(event.conversationId, currentTime)) {
        return waitDecision('跨群主动回复预算尚未恢复，保留消息并等待下一条群消息');
      }

      const matchedMessageCount = state.postReplyMessageCount;
      this.upgradePostReplyWatch(state, currentTime);
      writeDebugLog(
        `🔍 [AgentRuntime-GroupChatCadence-shouldTrigger] 回复后计时计数器命中 conversationId=${maskId(
          String(event.conversationId),
        )} messageCount=${matchedMessageCount} nextDelayMs=${state.nextDelayMs} nextThreshold=${state.nextMessageThreshold}`,
      );
      return triggerDecision(
        'post_reply_counter',
        true,
        '回复后群聊消息爆发，要求 Agent 读取最近100条群消息并回复',
      );
    }

    if (state.postReplyDueAtMs && currentTime.getTime() >= state.postReplyDueAtMs) {
      this.clearPostReplyWatch(state);
      return waitDecision('回复后计时器到达但消息数不足，回到随机观察窗口');
    }

    const randomWindow = this.getAvailableRandomWindow(state, currentTime);
    if (randomWindow) {
      if (!this.tryReserveProactiveBudget(event.conversationId, currentTime)) {
        return waitDecision('跨群主动回复预算尚未恢复，保留消息并等待下一条群消息');
      }

      randomWindow.consumed = true;
      writeDebugLog(
        `🔍 [AgentRuntime-GroupChatCadence-shouldTrigger] 随机回复片段已消费 conversationId=${maskId(
          String(event.conversationId),
        )} hour=${currentTime.getHours()} windowMinutes=${getRandomWindowMinutesForHour(currentTime.getHours())}`,
      );
      return triggerDecision(
        'random_window',
        true,
        '当前命中随机回复片段，要求 Agent 读取最近100条群消息并回复',
      );
    }

    return waitDecision('当前未命中随机回复片段，继续观察群聊');
  }

  /**
   * 标记已成功回复
   * @param event 触发回复的消息
   */
  markReplySent(event: PlatformMessage): void {
    if (event.conversationType !== 'group') return;

    const state = this.getState(event.conversationId);
    state.postReplyMessageCount = 0;
    state.postReplyDueAtMs = this.now().getTime() + state.nextDelayMs;
    writeDebugLog(
      `🔍 [AgentRuntime-GroupChatCadence-markReplySent] 已启动回复后计时计数器 conversationId=${maskId(
        String(event.conversationId),
      )} delayMs=${state.nextDelayMs} threshold=${state.nextMessageThreshold}`,
    );
  }

  // 获取会话状态，进程重启后重新生成。
  private getState(conversationId: PlatformMessage['conversationId']): ConversationCadenceState {
    const key = String(conversationId);
    const existing = this.states.get(key);
    if (existing) return existing;

    const state: ConversationCadenceState = {
      messages: [],
      postReplyMessageCount: 0,
      nextDelayMs: this.postReplyInitialDelayMs,
      nextMessageThreshold: this.postReplyInitialMessageCount,
    };
    this.states.set(key, state);
    return state;
  }

  // 判断回复后计时计数器是否达标。
  private isPostReplyCounterReached(state: ConversationCadenceState, currentTime: Date): boolean {
    return (
      typeof state.postReplyDueAtMs === 'number' &&
      currentTime.getTime() >= state.postReplyDueAtMs &&
      state.postReplyMessageCount >= state.nextMessageThreshold
    );
  }

  // 升级下一轮回复后观察门槛。
  private upgradePostReplyWatch(state: ConversationCadenceState, currentTime: Date): void {
    state.nextDelayMs = Math.min(
      state.nextDelayMs + this.postReplyDelayStepMs,
      this.postReplyMaxDelayMs,
    );
    state.nextMessageThreshold = Math.min(
      state.nextMessageThreshold + this.postReplyMessageCountStep,
      this.postReplyMaxMessageCount,
    );
    state.postReplyMessageCount = 0;
    state.postReplyDueAtMs = currentTime.getTime() + state.nextDelayMs;
  }

  // 清理回复后观察状态。
  private clearPostReplyWatch(state: ConversationCadenceState): void {
    state.postReplyDueAtMs = undefined;
    state.postReplyMessageCount = 0;
    state.nextDelayMs = this.postReplyInitialDelayMs;
    state.nextMessageThreshold = this.postReplyInitialMessageCount;
  }

  // 获取当前小时尚未消费的随机片段。
  private getAvailableRandomWindow(
    state: ConversationCadenceState,
    currentTime: Date,
  ): RandomReplyWindow | undefined {
    const window = this.getRandomWindow(state, currentTime);
    if (window.consumed) return undefined;

    const timeOfHourMs =
      currentTime.getMinutes() * MILLISECONDS_PER_MINUTE +
      currentTime.getSeconds() * 1000 +
      currentTime.getMilliseconds();

    if (timeOfHourMs < window.startMs || timeOfHourMs >= window.endMs) return undefined;
    return window;
  }

  // 生成当前小时唯一的随机回复片段。
  private getRandomWindow(state: ConversationCadenceState, currentTime: Date): RandomReplyWindow {
    const hourKey = `${currentTime.getFullYear()}-${currentTime.getMonth()}-${currentTime.getDate()}-${currentTime.getHours()}`;
    if (state.randomWindow?.hourKey === hourKey) return state.randomWindow;

    const windowMs =
      getRandomWindowMinutesForHour(currentTime.getHours()) * MILLISECONDS_PER_MINUTE;
    const maxStartMs = MILLISECONDS_PER_HOUR - windowMs;
    const startMs = Math.floor(this.random() * maxStartMs);
    const window: RandomReplyWindow = {
      hourKey,
      startMs,
      endMs: startMs + windowMs,
      consumed: false,
    };
    state.randomWindow = window;
    return window;
  }

  // 预占跨群主动请求预算，避免多个群同时进入模型队列。
  private tryReserveProactiveBudget(
    conversationId: PlatformMessage['conversationId'],
    currentTime: Date,
  ): boolean {
    const currentTimeMs = currentTime.getTime();
    if (currentTimeMs < this.nextProactiveTriggerAtMs) {
      writeDebugLog(
        `⏭️ [AgentRuntime-GroupChatCadence-shouldTrigger] 跨群主动回复预算未恢复 conversationId=${maskId(
          String(conversationId),
        )} remainingMs=${this.nextProactiveTriggerAtMs - currentTimeMs}`,
      );
      return false;
    }

    this.nextProactiveTriggerAtMs = currentTimeMs + this.proactiveGlobalMinimumIntervalMs;
    return true;
  }

  // 判断是否处于休息时段。
  private isQuietHour(currentTime: Date): boolean {
    const hour = currentTime.getHours();
    return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
  }

  // 判断消息是否明确@机器人。
  private isMentioningAgent(event: PlatformMessage): boolean {
    return event.message.mentions.includes(this.config.selfQqId);
  }

  // 判断是否为机器人自己的消息。
  private isSelfMessage(event: PlatformMessage): boolean {
    return String(event.senderId).endsWith(this.config.selfQqId);
  }
}

// 根据时段选择每小时唯一随机片段的长度。
function getRandomWindowMinutesForHour(hour: number): number {
  if ((hour >= 7 && hour < 12) || (hour >= 14 && hour < 18) || (hour >= 19 && hour < 21)) {
    return REGULAR_RANDOM_WINDOW_MINUTES;
  }

  return LEISURE_RANDOM_WINDOW_MINUTES;
}

// 构造触发结果。
function triggerDecision(
  triggerMode: GroupChatCadenceDecision['triggerMode'],
  replyRequired: boolean,
  reason: string,
): GroupChatCadenceDecision {
  return {
    type: 'trigger',
    triggerMode,
    replyRequired,
    requiresRecentMessages: true,
    recentMessageLimit: RECENT_MESSAGE_LIMIT,
    reason,
  };
}

// 构造静默结果。
function ignoreDecision(reason: string): GroupChatCadenceDecision {
  return {
    type: 'ignore',
    replyRequired: false,
    requiresRecentMessages: true,
    recentMessageLimit: RECENT_MESSAGE_LIMIT,
    reason,
  };
}

// 构造等待结果。
function waitDecision(reason: string): GroupChatCadenceDecision {
  return {
    type: 'wait',
    replyRequired: false,
    requiresRecentMessages: true,
    recentMessageLimit: RECENT_MESSAGE_LIMIT,
    reason,
  };
}

// 脱敏会话ID。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}
