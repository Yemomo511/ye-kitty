import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SenderBatch } from '../domain/sender-batch';
import { writeDebugLog } from '@kitty/shared/infrastructure/logging';

/** batch 最后一条后静默多久封口（毫秒） */
const DEFAULT_BATCH_GRACE_MS = 60_000;

/** batch 最大存活时间（毫秒），超时强制封口 */
const DEFAULT_BATCH_MAX_AGE_MS = 120_000;

/** mailbox 最大 batch 数 */
const DEFAULT_MAX_BATCHES = 20;

/** Mailbox 配置 */
export interface ConversationMailboxConfig {
  /** 最后一条消息后静默多久封口 */
  readonly batchGraceMs: number;
  /** batch 最大存活时间 */
  readonly batchMaxAgeMs: number;
  /** 最大 batch 数 */
  readonly maxBatches: number;
}

interface ActiveBatch {
  readonly batch: SenderBatch;
  graceTimer?: NodeJS.Timeout;
  maxAgeTimer?: NodeJS.Timeout;
}

/**
 * 会话邮件箱
 *
 * 管理 Actor 私有消息队列，将同一发送者的连续消息归入批次，
 * 在 grace 期结束后封口送入 Actor 处理。
 * 不做任何语义级别的合并或替换——LLM 自行判断。
 */
export class ConversationMailbox {
  private readonly batches: ActiveBatch[] = [];
  private readonly config: ConversationMailboxConfig;
  private sequenceCounter = 0;

  constructor(config?: Partial<ConversationMailboxConfig>) {
    this.config = {
      batchGraceMs: config?.batchGraceMs ?? DEFAULT_BATCH_GRACE_MS,
      batchMaxAgeMs: config?.batchMaxAgeMs ?? DEFAULT_BATCH_MAX_AGE_MS,
      maxBatches: config?.maxBatches ?? DEFAULT_MAX_BATCHES,
    };
  }

  /**
   * 投递消息
   * @param event 聊天事件
   */
  push(event: ChatEventContract): void {
    const senderId = String(event.senderId);
    const last = this.findOpenBatchFor(senderId);

    if (last) {
      // 追加到已有 batch
      last.batch.messages.push(event);
      last.batch.lastAppendedAt = Date.now();
      // 检查是否超过 maxAge
      if (Date.now() - last.batch.createdAt >= this.config.batchMaxAgeMs) {
        this.sealBatch(last);
      } else {
        this.resetGraceTimer(last);
      }
    } else {
      // 新建 batch
      const batch: SenderBatch = {
        id: `batch:${this.sequenceCounter++}`,
        senderId,
        messages: [event],
        sealed: false,
        createdAt: Date.now(),
        lastAppendedAt: Date.now(),
      };
      const active: ActiveBatch = {
        batch,
        maxAgeTimer: setTimeout(
          () => this.sealBatch(active),
          this.config.batchMaxAgeMs,
        ),
      };
      this.batches.push(active);
      this.resetGraceTimer(active);

      // FIFO 上限保护
      if (this.batches.length > this.config.maxBatches) {
        const removed = this.batches.shift();
        if (removed) {
          this.clearTimers(removed);
          writeDebugLog(
            `⏭️ [ConversationMailbox-push] 邮件箱已满，丢弃最旧批次 batchId=${removed.batch.id} batchCount=${this.batches.length}`,
          );
        }
      }
    }
  }

  /**
   * 取出下一个可处理的批次
   * @returns 已封口的批次，无可用批次时返回 undefined
   */
  takeNext(): SenderBatch | undefined {
    const active = this.batches[0];
    if (!active) return undefined;

    if (!active.batch.sealed) {
      // Actor 主动取，不等 grace——立即封口
      this.sealBatch(active);
    }

    this.batches.shift();
    return active.batch;
  }

  /**
   * 构建批次提示信息
   * @param batch 发件批次
   * @returns 单条消息返回空字符串；多条返回 batch hint
   */
  buildBatchHint(batch: SenderBatch): string {
    if (batch.messages.length <= 1) return '';

    return [
      `以上是同一用户在短时间内发送的 ${batch.messages.length} 条消息。`,
      '请自行判断：是同一段话的多个片段、对前一条的纠正、还是独立的不同问题。',
    ].join('\n');
  }

  /** 返回当前 batch 数量 */
  get batchCount(): number {
    return this.batches.length;
  }

  /** 返回队首 batch 是否已封口 */
  get isHeadSealed(): boolean {
    return this.batches[0]?.batch.sealed ?? false;
  }

  /** 销毁邮件箱，清理所有计时器 */
  destroy(): void {
    for (const active of this.batches) {
      this.clearTimers(active);
    }
    this.batches.length = 0;
  }

  // 查找同一发送者且未封口的 batch
  private findOpenBatchFor(senderId: string): ActiveBatch | undefined {
    for (let i = this.batches.length - 1; i >= 0; i--) {
      const active = this.batches[i];
      if (!active.batch.sealed && active.batch.senderId === senderId) {
        return active;
      }
    }
    return undefined;
  }

  // 重置 grace 计时器
  private resetGraceTimer(active: ActiveBatch): void {
    if (active.graceTimer) clearTimeout(active.graceTimer);

    const remainingMaxAge =
      this.config.batchMaxAgeMs - (Date.now() - active.batch.createdAt);
    const delay = Math.min(this.config.batchGraceMs, Math.max(0, remainingMaxAge));

    active.graceTimer = setTimeout(() => this.sealBatch(active), delay);
  }

  // 封口 batch
  private sealBatch(active: ActiveBatch): void {
    if (active.batch.sealed) return;
    active.batch.sealed = true;
    this.clearTimers(active);
  }

  // 清理计时器
  private clearTimers(active: ActiveBatch): void {
    if (active.graceTimer) {
      clearTimeout(active.graceTimer);
      active.graceTimer = undefined;
    }
    if (active.maxAgeTimer) {
      clearTimeout(active.maxAgeTimer);
      active.maxAgeTimer = undefined;
    }
  }
}
