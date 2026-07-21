import type { PlatformMessage } from '@kitty/platforms/message';
import type { ConversationId } from '@kitty/shared/ids';

/**
 * 会话历史端口
 *
 * MVP 使用进程内实现，为 get_recent_messages 提供最近消息上下文。
 */
export interface ConversationHistoryPort {
  /**
   * 写入消息
   * @param event 标准消息
   * @returns 是否新增写入
   */
  recordMessage(event: PlatformMessage): boolean;

  /**
   * 读取最近消息
   * @param conversationId 会话ID
   * @param limit 数量上限
   * @returns 最近消息
   */
  getRecentMessages(conversationId: ConversationId, limit: number): readonly PlatformMessage[];
}
