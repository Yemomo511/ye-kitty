import { writeDebugLog } from '@kitty/shared/logging';
import type { PlatformMessage } from '@kitty/platforms/message';

/** Agent消息准入队列配置。 */
export interface AdmissionQueueConfig {
  readonly maxConcurrency: number;
  readonly maxQueueSize: number;
}

/** 等待Agent处理的平台消息任务。 */
export interface AdmissionTask {
  readonly event: PlatformMessage;
  readonly mentionsAgent: boolean;
  readonly execute: () => Promise<void>;
}

/** 准入任务丢弃原因。 */
export type AdmissionDropReason = 'queue_full' | 'replaced_by_higher_priority';

/** 准入任务处理结果。 */
export type AdmissionResult =
  | { readonly status: 'completed' }
  | { readonly status: 'dropped'; readonly reason: AdmissionDropReason };

/** Agent消息准入能力。 */
export interface MessageAdmission {
  enqueue(task: AdmissionTask): Promise<AdmissionResult>;
}

/** QQ消息准入优先级 */
type AdmissionPriority = 'private' | 'group_mention' | 'group_cadence';

/** 等待中的QQ消息准入任务 */
interface PendingAdmissionTask {
  /** 调用方提交的完整任务 */
  readonly task: AdmissionTask;
  /** 消息业务优先级 */
  readonly priority: AdmissionPriority;
  /** 实际入队序号 */
  readonly sequence: number;
  /** 入队毫秒时间戳 */
  readonly enqueuedAt: number;
  /** 返回准入结果 */
  readonly resolve: (result: AdmissionResult) => void;
  /** 返回任务异常 */
  readonly reject: (error: unknown) => void;
}

const PRIORITY_RANK: Record<AdmissionPriority, number> = {
  private: 3,
  group_mention: 2,
  group_cadence: 1,
};

/** Agent准入队列默认配置 */
export const DEFAULT_ADMISSION_QUEUE_CONFIG: AdmissionQueueConfig = {
  maxConcurrency: 2,
  maxQueueSize: 10,
};

/**
 * 进程内Agent准入队列
 *
 * 在群聊节奏门控与 Agent 之间维护等待任务、全局并发令牌和会话锁。
 * 队列只影响尚未运行的任务，不抢占已经进入完整消息处理流程的任务。
 */
export class AdmissionQueue implements MessageAdmission {
  private readonly queue: PendingAdmissionTask[] = [];
  private readonly activeConversationIds = new Set<string>();
  private activeCount = 0;
  private nextSequence = 0;

  constructor(private readonly config: AdmissionQueueConfig = DEFAULT_ADMISSION_QUEUE_CONFIG) {
    validateConfig(config);
  }

  /**
   * 提交QQ消息任务
   * @param task 已通过门控的消息任务
   * @returns 完成或丢弃结果
   */
  enqueue(task: AdmissionTask): Promise<AdmissionResult> {
    return new Promise((resolve, reject) => {
      const pending: PendingAdmissionTask = {
        task,
        priority: resolvePriority(task),
        sequence: this.nextSequence,
        enqueuedAt: Date.now(),
        resolve,
        reject,
      };
      this.nextSequence += 1;
      this.queue.push(pending);
      this.sortQueue();
      writeDebugLog(
        `🔍 [AgentRuntime-AdmissionQueue-enqueue] QQ消息已进入准入调度 priority=${pending.priority} activeCount=${this.activeCount} queueLength=${this.queue.length} conversationId=${maskId(
          task.event.conversationId,
        )} messageId=${maskId(task.event.message.id)}`,
      );

      // 1. 先把可执行任务交给空闲令牌，容量只约束真正等待的任务。
      this.drain();
      // 2. 等待数超过上限时淘汰最低优先级中最后到达的任务。
      this.enforceQueueCapacity(pending);
    });
  }

  // 按优先级和入队顺序持续填充空闲令牌。
  private drain(): void {
    while (this.activeCount < this.config.maxConcurrency) {
      const nextIndex = this.queue.findIndex(
        (pending) => !this.activeConversationIds.has(pending.task.event.conversationId),
      );
      if (nextIndex < 0) return;

      const [pending] = this.queue.splice(nextIndex, 1);
      this.startTask(pending);
    }
  }

  // 启动任务前同步占用令牌和会话锁，避免异步间隙突破并发上限。
  private startTask(pending: PendingAdmissionTask): void {
    const conversationId = pending.task.event.conversationId;
    const startedAt = Date.now();
    this.activeCount += 1;
    this.activeConversationIds.add(conversationId);
    writeDebugLog(
      `🚧 [AgentRuntime-AdmissionQueue-startTask] 开始处理QQ消息 priority=${pending.priority} activeCount=${this.activeCount} queueLength=${this.queue.length} queueWaitMs=${Math.max(
        0,
        startedAt - pending.enqueuedAt,
      )} conversationId=${maskId(conversationId)} messageId=${maskId(
        pending.task.event.message.id,
      )}`,
    );

    void pending.task
      .execute()
      .then(() => {
        pending.resolve({ status: 'completed' });
        writeDebugLog(
          `✅ [AgentRuntime-AdmissionQueue-startTask] QQ消息处理完成 priority=${pending.priority} activeCount=${this.activeCount} queueLength=${this.queue.length} durationMs=${Math.max(
            0,
            Date.now() - startedAt,
          )} conversationId=${maskId(conversationId)} messageId=${maskId(
            pending.task.event.message.id,
          )}`,
        );
      })
      .catch((error: unknown) => {
        pending.reject(error);
      })
      .finally(() => {
        this.activeCount -= 1;
        this.activeConversationIds.delete(conversationId);
        this.drain();
      });
  }

  // 超出等待容量时保留高优先级和更早到达的任务。
  private enforceQueueCapacity(incoming: PendingAdmissionTask): void {
    if (this.queue.length <= this.config.maxQueueSize) return;

    const dropped = this.findLowestPriorityNewestTask();
    const droppedIndex = this.queue.indexOf(dropped);
    this.queue.splice(droppedIndex, 1);

    if (dropped === incoming) {
      dropped.resolve({ status: 'dropped', reason: 'queue_full' });
      console.warn(
        `⚠️ [AgentRuntime-AdmissionQueue-enqueue] 准入队列已满，丢弃新消息 priority=${dropped.priority} activeCount=${this.activeCount} queueLength=${this.queue.length} conversationId=${maskId(
          dropped.task.event.conversationId,
        )} messageId=${maskId(dropped.task.event.message.id)}`,
      );
      return;
    }

    dropped.resolve({ status: 'dropped', reason: 'replaced_by_higher_priority' });
    console.warn(
      `⚠️ [AgentRuntime-AdmissionQueue-enqueue] 高优先级消息已替换等待任务 incomingPriority=${incoming.priority} droppedPriority=${dropped.priority} activeCount=${this.activeCount} queueLength=${this.queue.length} droppedConversationId=${maskId(
        dropped.task.event.conversationId,
      )} droppedMessageId=${maskId(dropped.task.event.message.id)}`,
    );
  }

  // 查找优先级最低且在同级中最后入队的任务。
  private findLowestPriorityNewestTask(): PendingAdmissionTask {
    return this.queue.reduce((candidate, current) => {
      const candidateRank = PRIORITY_RANK[candidate.priority];
      const currentRank = PRIORITY_RANK[current.priority];
      if (currentRank < candidateRank) return current;
      if (currentRank === candidateRank && current.sequence > candidate.sequence) return current;
      return candidate;
    });
  }

  // 高优先级在前，同级保持实际入队顺序。
  private sortQueue(): void {
    this.queue.sort((left, right) => {
      const priorityDifference = PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority];
      if (priorityDifference !== 0) return priorityDifference;
      return left.sequence - right.sequence;
    });
  }
}

// 根据订阅器确认的消息语义计算准入优先级。
function resolvePriority(task: AdmissionTask): AdmissionPriority {
  if (task.event.conversationType === 'private') return 'private';
  if (task.mentionsAgent) return 'group_mention';
  return 'group_cadence';
}

// 拒绝无效容量，避免调度器永久阻塞或无限排队。
function validateConfig(config: AdmissionQueueConfig): void {
  if (!Number.isInteger(config.maxConcurrency) || config.maxConcurrency <= 0) {
    throw new Error('Agent准入最大并发数必须是正整数');
  }
  if (!Number.isInteger(config.maxQueueSize) || config.maxQueueSize <= 0) {
    throw new Error('Agent准入队列容量必须是正整数');
  }
}

// 脱敏消息和会话ID，仅保留排障所需的尾部特征。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}
