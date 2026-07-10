import type { ActorState } from '../domain/actor-state';

/**
 * Actor 元信息
 *
 * 提供给淘汰策略的最小 Actor 画像。
 */
export interface ConversationActorMeta {
  /** 当前状态 */
  readonly state: ActorState;
  /** 最后活动时间戳 */
  readonly lastActiveAt: number;
}

/**
 * 淘汰策略端口
 *
 * 决定当 Actor 数量达到上限时，应该淘汰哪个 Actor。
 */
export interface EvictionPolicyPort {
  /**
   * 选择淘汰候选
   * @param actors 当前所有 Actor 元信息
   * @returns 被淘汰的会话ID，无合适候选时返回 undefined
   */
  selectCandidate(
    actors: ReadonlyMap<string, ConversationActorMeta>,
  ): string | undefined;
}
