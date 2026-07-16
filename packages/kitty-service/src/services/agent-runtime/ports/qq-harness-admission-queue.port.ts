import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';

/** QQ Harness准入队列配置 */
export interface QqHarnessAdmissionQueueConfig {
  /** 最大并发消息数 */
  readonly maxConcurrency: number;
  /** 最大等待消息数 */
  readonly maxQueueSize: number;
}

/** QQ Harness准入任务 */
export interface QqHarnessAdmissionTask {
  /** QQ标准消息 */
  readonly event: ChatEventContract;
  /** 是否明确@叶猫猫 */
  readonly mentionsAgent: boolean;
  /**
   * 执行完整消息处理
   *
   * 实现方必须在任务结束后释放全局令牌和会话锁，异常继续抛给调用方。
   */
  readonly execute: () => Promise<void>;
}

/** QQ Harness准入丢弃原因 */
export type QqHarnessAdmissionDropReason = 'queue_full' | 'replaced_by_higher_priority';

/** QQ Harness准入结果 */
export type QqHarnessAdmissionResult =
  | {
      /** 任务已完成 */
      readonly status: 'completed';
    }
  | {
      /** 任务未执行 */
      readonly status: 'dropped';
      /** 丢弃原因 */
      readonly reason: QqHarnessAdmissionDropReason;
    };

/**
 * QQ Harness准入队列端口
 *
 * 调用方提交已经通过消息门控的任务，并等待任务完成或收到满载丢弃结果。
 */
export interface QqHarnessAdmissionQueuePort {
  /**
   * 提交消息任务
   * @param task QQ消息任务
   * @returns 完成或丢弃结果
   */
  enqueue(task: QqHarnessAdmissionTask): Promise<QqHarnessAdmissionResult>;
}
