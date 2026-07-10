import type { ActorSnapshot } from '../domain/actor-snapshot';
import type { SnapshotStorePort } from '../ports/snapshot-store.port';

/**
 * 进程内快照存储
 *
 * 使用内存 Map 存储 Actor 快照，进程重启后快照丢失。
 * 匹配 InMemoryConversationHistory 的模式，放在 application/ 而非 infrastructure/。
 */
export class InMemorySnapshotStore implements SnapshotStorePort {
  private readonly store = new Map<string, ActorSnapshot>();

  /**
   * 保存快照
   * @param snapshot Actor 快照
   */
  async save(snapshot: ActorSnapshot): Promise<void> {
    this.store.set(snapshot.conversationId, snapshot);
  }

  /**
   * 加载快照
   * @param conversationId 会话ID
   * @returns 快照，不存在时返回 undefined
   */
  async load(conversationId: string): Promise<ActorSnapshot | undefined> {
    return this.store.get(conversationId);
  }

  /**
   * 删除快照
   * @param conversationId 会话ID
   */
  async delete(conversationId: string): Promise<void> {
    this.store.delete(conversationId);
  }
}
