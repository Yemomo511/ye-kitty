import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import { writeDebugLog } from '@kitty/shared/infrastructure/logging';
import type {
  GroupChatCadenceDecision,
  GroupChatCadencePort,
} from '../ports/group-chat-cadence.port';

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
}

interface RandomReplyWindow {
  readonly startMs: number;
  readonly endMs: number;
}

interface ConversationCadenceState {
  readonly messages: ChatEventContract[];
  readonly windowsByHour: Map<string, readonly RandomReplyWindow[]>;
  postReplyDueAtMs?: number;
  postReplyMessageCount: number;
  nextDelayMs: number;
  nextMessageThreshold: number;
}

const RECENT_MESSAGE_LIMIT = 100;
const QUIET_START_HOUR = 1;
const QUIET_END_HOUR = 7;
const DEFAULT_INITIAL_DELAY_MS = 10000;
const DEFAULT_DELAY_STEP_MS = 10000;
const DEFAULT_MAX_DELAY_MS = 60000;
const DEFAULT_INITIAL_MESSAGE_COUNT = 1;
const DEFAULT_MESSAGE_COUNT_STEP = 2;
const DEFAULT_MAX_MESSAGE_COUNT = 10;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;

/**
 * 群聊节奏控制器
 *
 * 让未 @ 群聊先经过随机观察片段和回复后计时计数器，再决定是否触发 Agent。
 */
export class GroupChatCadenceController implements GroupChatCadencePort {
  private readonly states = new Map<string, ConversationCadenceState>();
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly postReplyInitialDelayMs: number;
  private readonly postReplyDelayStepMs: number;
  private readonly postReplyMaxDelayMs: number;
  private readonly postReplyInitialMessageCount: number;
  private readonly postReplyMessageCountStep: number;
  private readonly postReplyMaxMessageCount: number;

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
  }

  /**
   * 记录群聊消息
   * @param event 标准消息
   */
  recordMessage(event: ChatEventContract): void {
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
  shouldTrigger(event: ChatEventContract): GroupChatCadenceDecision {
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

    if (this.isPostReplyCounterReached(state, currentTime)) {
      this.upgradePostReplyWatch(state, currentTime);
      writeDebugLog(
        `🔍 [AgentRuntime-GroupChatCadence-shouldTrigger] 回复后计时计数器命中 conversationId=${maskId(
          String(event.conversationId),
        )} messageCount=${state.postReplyMessageCount} nextDelayMs=${state.nextDelayMs} nextThreshold=${state.nextMessageThreshold}`,
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

    if (this.isInRandomWindow(event, currentTime)) {
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
  markReplySent(event: ChatEventContract): void {
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
  private getState(conversationId: ChatEventContract['conversationId']): ConversationCadenceState {
    const key = String(conversationId);
    const existing = this.states.get(key);
    if (existing) return existing;

    const state: ConversationCadenceState = {
      messages: [],
      windowsByHour: new Map(),
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

  // 判断当前时间是否命中随机回复片段。
  private isInRandomWindow(event: ChatEventContract, currentTime: Date): boolean {
    const state = this.getState(event.conversationId);
    const windows = this.getRandomWindows(state, currentTime);
    const timeOfHourMs =
      currentTime.getMinutes() * MILLISECONDS_PER_MINUTE +
      currentTime.getSeconds() * 1000 +
      currentTime.getMilliseconds();

    return windows.some((window) => timeOfHourMs >= window.startMs && timeOfHourMs < window.endMs);
  }

  // 获取当前小时的随机回复片段。
  private getRandomWindows(
    state: ConversationCadenceState,
    currentTime: Date,
  ): readonly RandomReplyWindow[] {
    const hourKey = `${currentTime.getFullYear()}-${currentTime.getMonth()}-${currentTime.getDate()}-${currentTime.getHours()}`;
    const existing = state.windowsByHour.get(hourKey);
    if (existing) return existing;

    const windows = createRandomWindows(
      getReplyMinutesForHour(currentTime.getHours()),
      this.random,
    );
    state.windowsByHour.set(hourKey, windows);
    return windows;
  }

  // 判断是否处于休息时段。
  private isQuietHour(currentTime: Date): boolean {
    const hour = currentTime.getHours();
    return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
  }

  // 判断消息是否明确@机器人。
  private isMentioningAgent(event: ChatEventContract): boolean {
    return event.message.mentions.includes(this.config.selfQqId);
  }

  // 判断是否为机器人自己的消息。
  private isSelfMessage(event: ChatEventContract): boolean {
    return String(event.senderId).endsWith(this.config.selfQqId);
  }
}

// 生成随机回复片段。
function createRandomWindows(
  totalMinutes: number,
  random: () => number,
): readonly RandomReplyWindow[] {
  const count = totalMinutes === 10 ? randomInteger(random, 1, 10) : randomInteger(random, 10, 20);
  const totalMs = totalMinutes * MILLISECONDS_PER_MINUTE;
  const windowMs = Math.max(1000, Math.floor(totalMs / count));
  const windows: RandomReplyWindow[] = [];

  for (let index = 0; index < count; index += 1) {
    const maxStart = Math.max(0, MILLISECONDS_PER_HOUR - windowMs);
    const startMs = Math.floor(random() * maxStart);
    windows.push({ startMs, endMs: startMs + windowMs });
  }

  return windows.sort((left, right) => left.startMs - right.startMs);
}

// 根据小时判断主动回复分钟数。
function getReplyMinutesForHour(hour: number): number {
  if ((hour >= 7 && hour < 12) || (hour >= 14 && hour < 18) || (hour >= 19 && hour < 21)) {
    return 10;
  }

  return 20;
}

// 生成闭区间随机整数。
function randomInteger(random: () => number, min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
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
