import type {
  ConversationActorMeta,
  EvictionPolicyPort,
} from '../ports/eviction-policy.port';

/**
 * 最少最近空闲淘汰策略
 *
 * 只淘汰 Idle 状态且空闲超过 minIdleBeforeEvictionMs 的 Actor。
 * 选择 lastActiveAt 最早的候选。
 */
export class LeastRecentlyIdleEvictionPolicy implements EvictionPolicyPort {
  constructor(private readonly minIdleBeforeEvictionMs: number) {}

  /**
   * 选择淘汰候选
   * @param actors 当前所有 Actor 元信息
   * @returns 被淘汰的会话ID，无合适候选时返回 undefined
   */
  selectCandidate(
    actors: ReadonlyMap<string, ConversationActorMeta>,
  ): string | undefined {
    let oldest: { id: string; lastActiveAt: number } | undefined;

    for (const [id, meta] of actors) {
      // 只淘汰 Idle 状态的 Actor
      if (meta.state !== 'idle') continue;

      // 空闲时间必须超过阈值
      const idleDuration = Date.now() - meta.lastActiveAt;
      if (idleDuration < this.minIdleBeforeEvictionMs) continue;

      if (!oldest || meta.lastActiveAt < oldest.lastActiveAt) {
        oldest = { id, lastActiveAt: meta.lastActiveAt };
      }
    }

    return oldest?.id;
  }
}
