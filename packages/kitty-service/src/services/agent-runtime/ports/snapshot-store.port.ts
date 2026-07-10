import type { ActorSnapshot } from '../domain/actor-snapshot';

/**
 * 快照存储端口
 *
 * 定义 Actor 快照的持久化操作，支持内存、文件、Redis 等实现。
 */
export interface SnapshotStorePort {
  /**
   * 保存快照
   * @param snapshot Actor 快照
   */
  save(snapshot: ActorSnapshot): Promise<void>;

  /**
   * 加载快照
   * @param conversationId 会话ID
   * @returns 快照，不存在时返回 undefined
   */
  load(conversationId: string): Promise<ActorSnapshot | undefined>;

  /**
   * 删除快照
   * @param conversationId 会话ID
   */
  delete(conversationId: string): Promise<void>;
}
