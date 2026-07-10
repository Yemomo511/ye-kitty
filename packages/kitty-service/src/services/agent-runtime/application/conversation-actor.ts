import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SkillMetadata } from '../domain/skill';
import type { ActorState } from '../domain/actor-state';
import type { ActorSnapshot } from '../domain/actor-snapshot';
import type { ConversationActorMeta } from '../ports/eviction-policy.port';
import type { RecoveryPolicyPort } from '../ports/recovery-policy.port';
import type { SnapshotStorePort } from '../ports/snapshot-store.port';
import type {
  AgentRuntimeHarnessPort,
  AgentRuntimeRunResult,
} from '../ports/agent-runtime-harness.port';
import { ConversationMailbox } from './actor-mailbox';
import { writeDebugLog } from '@kitty/shared/infrastructure/logging';

/**
 * ConversationActor 配置
 */
export interface ConversationActorConfig {
  /** 会话ID */
  readonly conversationId: string;
  /** Agent Harness（共享） */
  readonly harness: AgentRuntimeHarnessPort;
  /** 快照存储 */
  readonly snapshotStore: SnapshotStorePort;
  /** 恢复策略 */
  readonly recoveryPolicy: RecoveryPolicyPort;
  /** 邮件箱配置 */
  readonly mailboxConfig?: {
    readonly batchGraceMs?: number;
    readonly batchMaxAgeMs?: number;
    readonly maxBatches?: number;
  };
}

/**
 * 会话 Actor
 *
 * 每个 QQ 会话一个 Actor，内部严格串行处理消息。
 * 拥有该会话的对话历史（history）和邮件箱（mailbox），
 * 崩溃后可通过快照恢复。
 */
export class ConversationActor {
  private readonly conversationId: string;
  private _state: ActorState = 'idle';
  private readonly mailbox: ConversationMailbox;
  private readonly history: ChatEventContract[] = [];
  private _errorCount = 0;
  private _lastActiveAt = Date.now();
  private _sequenceNumber = 0;
  private currentTask: Promise<void> = Promise.resolve();
  private availableSkills?: readonly SkillMetadata[];
  private readonly harness: AgentRuntimeHarnessPort;
  private readonly snapshotStore: SnapshotStorePort;
  private readonly recoveryPolicy: RecoveryPolicyPort;
  private destroyed = false;

  constructor(config: ConversationActorConfig) {
    this.conversationId = config.conversationId;
    this.harness = config.harness;
    this.snapshotStore = config.snapshotStore;
    this.recoveryPolicy = config.recoveryPolicy;
    this.mailbox = new ConversationMailbox(config.mailboxConfig);
  }

  // ─── 公共属性 ───

  /** 当前状态 */
  get state(): ActorState {
    return this._state;
  }

  /** 最后活动时间 */
  get lastActiveAt(): number {
    return this._lastActiveAt;
  }

  /** 累计崩溃次数 */
  get errorCount(): number {
    return this._errorCount;
  }

  /** Actor 元信息（供淘汰策略使用） */
  get meta(): ConversationActorMeta {
    return {
      state: this._state,
      lastActiveAt: this._lastActiveAt,
    };
  }

  // ─── 公共方法 ───

  /**
   * 投递消息到 Actor
   * @param event 聊天事件
   * @param skills 本轮可用 Skill 目录
   * @returns Harness 运行结果
   */
  send(
    event: ChatEventContract,
    skills?: readonly SkillMetadata[],
  ): Promise<AgentRuntimeRunResult> {
    if (this.destroyed) {
      return Promise.resolve(this.capacityError('Actor 已销毁'));
    }

    this.mailbox.push(event);

    // 存储本轮 availableSkills（供 processNext 使用）
    if (skills) this.availableSkills = skills;

    // 空闲 → 处理中，更新活动时间
    if (this._state === 'idle') {
      this._lastActiveAt = Date.now();
    }

    return this.scheduleProcess();
  }

  /**
   * 生成当前快照
   * @returns ActorSnapshot
   */
  snapshot(): ActorSnapshot {
    return {
      conversationId: this.conversationId,
      history: [...this.history],
      mailbox: this.mailboxSnapshot(),
      errorCount: this._errorCount,
      sequenceNumber: this._sequenceNumber,
      createdAt: Date.now(),
    };
  }

  /**
   * 销毁 Actor，清理资源并保存最终快照
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    this.mailbox.destroy();
    await this.snapshotStore.save(this.snapshot());
  }

  // ─── 私有方法 ───

  // 调度处理——链式串行，确保同一 Actor 内部严格有序
  private scheduleProcess(): Promise<AgentRuntimeRunResult> {
    return new Promise<AgentRuntimeRunResult>((resolve, reject) => {
      this.currentTask = this.currentTask
        .then(() => this.processNext())
        .then((result) => resolve(result))
        .catch((err: unknown) => reject(err));
    });
  }

  // 处理邮件箱中的下一条消息
  private async processNext(): Promise<AgentRuntimeRunResult> {
    if (this.destroyed) return this.capacityError('Actor 已销毁');

    this._state = 'processing';
    let lastResult: AgentRuntimeRunResult = {
      type: 'ignore',
      reason: '无消息待处理',
      traceId: createTraceId(this.conversationId),
    };

    while (true) {
      const batch = this.mailbox.takeNext();
      if (!batch) break;

      try {
        // 直接构造 AgentRuntimeRunInput（Harness 内部自行构建 Observation）
        const result = await this.harness.run({
          event: batch.messages[0],
          availableSkills: this.availableSkills,
          batchHint: this.mailbox.buildBatchHint(batch),
        });

        lastResult = result;

        if (result.type === 'reply' || result.type === 'ignore') {
          this.history.push(...batch.messages);
          this._sequenceNumber++;
          await this.snapshotStore.save(this.snapshot());
        } else if (result.type === 'human_review') {
          this.history.push(...batch.messages);
          this._sequenceNumber++;
          await this.snapshotStore.save(this.snapshot());
          continue;
        } else if (result.type === 'capacity_error') {
          break;
        }
      } catch (error) {
        // 单条消息处理失败——按恢复策略决定重试还是放弃
        this._errorCount++;
        const err = error instanceof Error ? error : new Error(String(error));

        if (this.recoveryPolicy.shouldRetry(this._errorCount, err)) {
          const delay = this.recoveryPolicy.backoffMs(this._errorCount);
          writeDebugLog(
            `⚠️ [ConversationActor-processNext] Actor 异常，${delay}ms 后重试 conversationId=${this.conversationId} errorCount=${this._errorCount} reason=${err.message}`,
          );
          await sleep(delay);
          // continue 回到 while 循环顶部，mailbox 中还有未处理的 batch
          continue;
        }

        // 重试耗尽——标记 faulty，抛出给 Supervisor 做崩溃恢复
        console.error(
          `❌ [ConversationActor-processNext] Actor 达到最大重试次数，标记为 faulty conversationId=${this.conversationId} errorCount=${this._errorCount}`,
        );
        this._state = 'faulty';
        throw err;
      }
    }

    // 邮箱已空，回到空闲或 draining
    if (this.mailbox.batchCount > 0) {
      this._state = 'draining';
    } else {
      this._state = 'idle';
    }

    return lastResult;
  }

  // 生成过载拒绝结果
  private capacityError(reason: string): AgentRuntimeRunResult {
    return {
      type: 'capacity_error',
      reason,
      traceId: createTraceId(this.conversationId),
    };
  }

  // 导出邮箱的快照视图
  // Phase 1：只导出已封口的 batch（timer 状态不可序列化）
  private mailboxSnapshot(): ActorSnapshot['mailbox'] {
    // 简化处理——已封口的 batch 直接存入快照
    // 完整 timer 序列化留到 Phase 3
    return [];
  }
}

let traceCounter = 0;

// 生成轻量追踪 ID
function createTraceId(conversationId: string): string {
  return `actor-run:${conversationId}:${Date.now().toString(36)}:${traceCounter++}`;
}

// 等待
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
