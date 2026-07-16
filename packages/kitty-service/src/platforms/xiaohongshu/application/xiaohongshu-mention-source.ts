import type { XiaohongshuMentionEventContract } from '@kitty/contracts/events/xiaohongshu-mention-event.contract';
import { PlatformMessageService } from '@kitty/platforms/shared';
import type {
  XiaohongshuMention,
  XiaohongshuMentionCheckpoint,
} from '../domain/xiaohongshu-mention';
import type { XiaohongshuMentionCheckpointRepositoryPort } from '../ports/xiaohongshu-mention-checkpoint.repository.port';
import type { XiaohongshuMentionReaderPort } from '../ports/xiaohongshu-mention-reader.port';

const MAX_RECENT_MENTION_IDS = 200;

/** 小红书被提及信息源配置 */
export interface XiaohongshuMentionSourceOptions {
  readonly reader: XiaohongshuMentionReaderPort;
  readonly checkpointRepository: XiaohongshuMentionCheckpointRepositoryPort;
  readonly pollIntervalMs: number;
  readonly maxBackoffMs: number;
  readonly schedule?: (handler: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  readonly cancelSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
  readonly now?: () => Date;
}

/**
 * 小红书被提及信息源
 *
 * 递归定时保证同一信息源永远只有一次上游读取。首次成功读取只建立基线，
 * 后续才按时间顺序发布未见提醒。
 */
export class XiaohongshuMentionSource extends PlatformMessageService<XiaohongshuMentionEventContract> {
  private readonly schedule: NonNullable<XiaohongshuMentionSourceOptions['schedule']>;
  private readonly cancelSchedule: NonNullable<XiaohongshuMentionSourceOptions['cancelSchedule']>;
  private readonly now: () => Date;
  private checkpoint: XiaohongshuMentionCheckpoint | undefined;
  private lifecycle: 'idle' | 'running' | 'stopped' = 'idle';
  private consecutiveFailures = 0;
  private scheduledHandle: ReturnType<typeof setTimeout> | undefined;
  private activePoll: Promise<void> | undefined;

  constructor(private readonly options: XiaohongshuMentionSourceOptions) {
    super();
    this.schedule = options.schedule ?? setTimeout;
    this.cancelSchedule = options.cancelSchedule ?? clearTimeout;
    this.now = options.now ?? (() => new Date());
  }

  /** 读取检查点、立即执行一次轮询并开始递归调度 */
  async start(): Promise<void> {
    if (this.lifecycle === 'running') return;
    this.lifecycle = 'running';
    console.info(
      `🚧 [XiaohongshuMentionSource-start] 正在启动被提及信息源 pollIntervalMs=${this.options.pollIntervalMs}`,
    );
    await this.pollNow();
    console.info('✅ [XiaohongshuMentionSource-start] 被提及信息源已启动');
  }

  /** 停止后续调度并等待当前读取完成 */
  async stop(): Promise<void> {
    if (this.lifecycle === 'stopped') return;
    this.lifecycle = 'stopped';
    this.cancelPendingSchedule();
    await this.activePoll;
    console.info('✅ [XiaohongshuMentionSource-stop] 被提及信息源已停止');
  }

  /**
   * 立即执行一次轮询
   *
   * 仅供启动编排、运行诊断和测试使用；已停止的信息源不会再读取。
   */
  async pollNow(): Promise<void> {
    if (this.lifecycle === 'stopped') return;
    if (this.activePoll) return await this.activePoll;
    this.cancelPendingSchedule();
    this.activePoll = this.runPoll();
    try {
      await this.activePoll;
    } finally {
      this.activePoll = undefined;
    }
  }

  // 单轮读取失败只改变下次退避，不让定时任务退出。
  private async runPoll(): Promise<void> {
    try {
      this.checkpoint ??= await this.options.checkpointRepository.load();
      const page = await this.options.reader.listMentions();
      await this.acceptPage(page.mentions);
      this.consecutiveFailures = 0;
      this.scheduleNext(this.options.pollIntervalMs);
    } catch (error) {
      this.consecutiveFailures += 1;
      const nextDelayMs = Math.min(
        this.options.maxBackoffMs,
        this.options.pollIntervalMs * 2 ** this.consecutiveFailures,
      );
      console.warn(
        `⚠️ [XiaohongshuMentionSource-poll] 读取被提及提醒失败，将退避重试 failureCount=${this.consecutiveFailures} nextDelayMs=${nextDelayMs} reason=${formatError(error)}`,
      );
      this.scheduleNext(nextDelayMs);
    }
  }

  // 基线不回放历史；增量批次反转为旧到新后再发布。
  private async acceptPage(mentions: readonly XiaohongshuMention[]): Promise<void> {
    if (!this.checkpoint?.initialized) {
      this.checkpoint = createCheckpoint(mentions, []);
      await this.options.checkpointRepository.save(this.checkpoint);
      console.info(
        `✅ [XiaohongshuMentionSource-baseline] 已建立首次基线 mentionCount=${mentions.length}`,
      );
      return;
    }

    const knownIds = new Set(this.checkpoint.recentMentionIds);
    const freshMentions = mentions.filter((mention) => !knownIds.has(mention.id)).reverse();
    for (const mention of freshMentions) {
      await this.publishMessage(toEvent(mention, this.now()));
    }

    this.checkpoint = createCheckpoint(mentions, this.checkpoint.recentMentionIds);
    await this.options.checkpointRepository.save(this.checkpoint);
    if (freshMentions.length > 0) {
      console.info(
        `✅ [XiaohongshuMentionSource-poll] 已发布新的被提及事件 newMentionCount=${freshMentions.length}`,
      );
    }
  }

  private scheduleNext(milliseconds: number): void {
    if (this.lifecycle !== 'running') return;
    this.scheduledHandle = this.schedule(() => {
      this.scheduledHandle = undefined;
      void this.pollNow();
    }, milliseconds);
  }

  private cancelPendingSchedule(): void {
    if (this.scheduledHandle === undefined) return;
    this.cancelSchedule(this.scheduledHandle);
    this.scheduledHandle = undefined;
  }
}

function createCheckpoint(
  mentions: readonly XiaohongshuMention[],
  existingIds: readonly string[],
): XiaohongshuMentionCheckpoint {
  return {
    initialized: true,
    recentMentionIds: [
      ...new Set([...mentions.map((mention) => mention.id), ...existingIds]),
    ].slice(0, MAX_RECENT_MENTION_IDS),
  };
}

function toEvent(mention: XiaohongshuMention, receivedAt: Date): XiaohongshuMentionEventContract {
  const senderId = mention.actorId ?? `unknown:${mention.id}`;
  return {
    id: `xiaohongshu:mention:${mention.id}`,
    platform: 'xiaohongshu',
    eventType: 'mention.received',
    mentionId: mention.id,
    senderId: `xiaohongshu:participant:${senderId}`,
    ...(mention.actorDisplayName ? { senderDisplayName: mention.actorDisplayName } : {}),
    content: mention.content || mention.title,
    source: {
      ...(mention.noteId ? { noteId: mention.noteId } : {}),
      ...(mention.commentId ? { commentId: mention.commentId } : {}),
      ...(mention.url ? { url: mention.url } : {}),
    },
    ...(mention.occurredAt ? { occurredAt: mention.occurredAt } : {}),
    receivedAt,
  };
}

function formatError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
