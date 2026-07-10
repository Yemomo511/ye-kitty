import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SkillMetadata } from '../domain/skill';
import type { ActorState } from '../domain/actor-state';
import type {
  AgentRuntimeHarnessPort,
  AgentRuntimeRunResult,
} from '../ports/agent-runtime-harness.port';
import type { EvictionPolicyPort } from '../ports/eviction-policy.port';
import type { RecoveryPolicyPort } from '../ports/recovery-policy.port';
import type { SnapshotStorePort } from '../ports/snapshot-store.port';
import { ConversationActor } from './conversation-actor';
import { writeDebugLog } from '@kitty/shared/infrastructure/logging';

/**
 * QQ 回复 Actor Supervisor 配置
 */
export interface QqReplyActorSupervisorConfig {
  /** 全局最大 Actor 数 */
  readonly maxActors: number;
  /** Idle 多久才能被淘汰（毫秒） */
  readonly minIdleBeforeEvictionMs: number;
}

const DEFAULT_MAX_ACTORS = 100;
const DEFAULT_MIN_IDLE_BEFORE_EVICTION_MS = 300_000;

/**
 * 会话 Actor Supervisor
 *
 * 管理所有 ConversationActor 的生命周期：
 * - 路由消息到正确的 Actor
 * - 创建和淘汰 Actor
 * - 崩溃恢复
 */
export class ConversationActorSupervisor {
  private readonly actors = new Map<string, ConversationActor>();
  private readonly harness: AgentRuntimeHarnessPort;
  private readonly snapshotStore: SnapshotStorePort;
  private readonly evictionPolicy: EvictionPolicyPort;
  private readonly recoveryPolicy: RecoveryPolicyPort;
  private readonly config: QqReplyActorSupervisorConfig;

  constructor(params: {
    readonly harness: AgentRuntimeHarnessPort;
    readonly snapshotStore: SnapshotStorePort;
    readonly evictionPolicy: EvictionPolicyPort;
    readonly recoveryPolicy: RecoveryPolicyPort;
    readonly config?: Partial<QqReplyActorSupervisorConfig>;
  }) {
    this.harness = params.harness;
    this.snapshotStore = params.snapshotStore;
    this.evictionPolicy = params.evictionPolicy;
    this.recoveryPolicy = params.recoveryPolicy;
    this.config = {
      maxActors: params.config?.maxActors ?? DEFAULT_MAX_ACTORS,
      minIdleBeforeEvictionMs:
        params.config?.minIdleBeforeEvictionMs ??
        DEFAULT_MIN_IDLE_BEFORE_EVICTION_MS,
    };
  }

  /**
   * 分发消息到对应 Actor
   * @param event 聊天事件
   * @param availableSkills 本轮可用 Skill 目录
   * @returns Harness 运行结果
   */
  async dispatch(
    event: ChatEventContract,
    availableSkills?: readonly SkillMetadata[],
  ): Promise<AgentRuntimeRunResult> {
    const actorOrError = this.getOrCreateActor(String(event.conversationId));

    if (actorOrError === 'capacity_error') {
      return {
        type: 'capacity_error',
        reason: 'Actor 池已满，拒绝新会话',
        traceId: createTraceId(String(event.conversationId)),
      };
    }

    try {
      return await actorOrError.send(event, availableSkills);
    } catch (error) {
      // 崩溃恢复
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(
        `❌ [ConversationActorSupervisor-dispatch] Actor 崩溃，尝试恢复 conversationId=${String(
          event.conversationId,
        )} reason=${err.message}`,
      );

      return this.recoverActor(String(event.conversationId), event, availableSkills);
    }
  }

  /**
   * 获取指定会话的 Actor
   * @param conversationId 会话ID
   * @returns Actor，不存在时返回 undefined
   */
  getActor(conversationId: string): ConversationActor | undefined {
    return this.actors.get(conversationId);
  }

  /** 当前 Actor 总数 */
  get actorCount(): number {
    return this.actors.size;
  }

  /** 当前活跃 Actor 数（processing + draining） */
  get activeActorCount(): number {
    let count = 0;
    for (const actor of this.actors.values()) {
      if (actor.state === 'processing' || actor.state === 'draining') {
        count++;
      }
    }
    return count;
  }

  // ─── 私有方法 ───

  // 获取或创建 Actor
  private getOrCreateActor(
    conversationId: string,
  ): ConversationActor | 'capacity_error' {
    const existing = this.actors.get(conversationId);
    if (existing) return existing;

    // 总数 < 上限 → 直接创建
    if (this.actors.size < this.config.maxActors) {
      return this.createActor(conversationId);
    }

    // 总数 >= 上限 → 尝试淘汰
    const candidate = this.evictionPolicy.selectCandidate(this.collectActorMetas());
    if (candidate) {
      const target = this.actors.get(candidate);
      if (target) {
        // 淘汰前持久化快照
        const snapshot = target.snapshot();
        this.snapshotStore.save(snapshot).catch((error) => {
          console.warn(
            `⚠️ [ConversationActorSupervisor-evict] 淘汰前快照保存失败 conversationId=${candidate} reason=${error instanceof Error ? error.message : String(error)}`,
          );
        });
        target.destroy().catch(() => {
          // destroy 失败不阻塞淘汰
        });
        this.actors.delete(candidate);

        writeDebugLog(
          `⏭️ [ConversationActorSupervisor-evict] 已淘汰 Idle Actor conversationId=${candidate} activeActors=${this.activeActorCount}`,
        );
      }

      return this.createActor(conversationId);
    }

    // 没有可淘汰的 Idle Actor → 拒绝
    console.warn(
      `⚠️ [ConversationActorSupervisor-dispatch] Actor 池已满，拒绝新会话 conversationId=${conversationId} actorCount=${this.actors.size}`,
    );
    return 'capacity_error';
  }

  // 创建新 Actor
  private createActor(conversationId: string): ConversationActor {
    const actor = new ConversationActor({
      conversationId,
      harness: this.harness,
      snapshotStore: this.snapshotStore,
      recoveryPolicy: this.recoveryPolicy,
    });
    this.actors.set(conversationId, actor);
    writeDebugLog(
      `✅ [ConversationActorSupervisor-create] 已创建 Actor conversationId=${conversationId} actorCount=${this.actors.size}`,
    );
    return actor;
  }

  // 崩溃恢复
  private async recoverActor(
    conversationId: string,
    event: ChatEventContract,
    availableSkills?: readonly SkillMetadata[],
  ): Promise<AgentRuntimeRunResult> {
    // 移除崩溃的 Actor
    this.actors.delete(conversationId);

    // 尝试从快照恢复
    const snapshot = await this.snapshotStore.load(conversationId);
    if (snapshot) {
      writeDebugLog(
        `🚧 [ConversationActorSupervisor-recover] 从快照恢复 Actor conversationId=${conversationId} historyLength=${snapshot.history.length} mailboxBatches=${snapshot.mailbox.length}`,
      );

      const actor = this.createActor(conversationId);
      // note: Phase 2 将从快照恢复 history 和 mailbox
      // Phase 1 仅重建空 Actor，内存中的历史丢失但服务继续
      return actor.send(event, availableSkills);
    }

    // 无快照 → 重建空 Actor
    writeDebugLog(
      `🚧 [ConversationActorSupervisor-recover] 无快照，重建空 Actor conversationId=${conversationId}`,
    );
    const actor = this.createActor(conversationId);
    return actor.send(event, availableSkills);
  }

  // 收集所有 Actor 元信息
  private collectActorMetas(): ReadonlyMap<
    string,
    { state: ActorState; lastActiveAt: number }
  > {
    const metas = new Map<
      string,
      { state: ActorState; lastActiveAt: number }
    >();
    for (const [id, actor] of this.actors) {
      metas.set(id, {
        state: actor.state,
        lastActiveAt: actor.lastActiveAt,
      });
    }
    return metas;
  }
}

// 生成轻量追踪 ID
function createTraceId(conversationId: string): string {
  return `supervisor:${conversationId}:${Date.now().toString(36)}`;
}
