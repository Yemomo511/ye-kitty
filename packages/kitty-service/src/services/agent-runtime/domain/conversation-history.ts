import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { ConversationId } from '@kitty/shared/types/ids';

/**
 * 会话历史读取接口（domain 层）
 *
 * 只定义读取能力，供 RuntimeToolCall 引用。
 * ConversationHistoryPort 在 ports 层扩展此接口。
 */
export interface ConversationHistory {
  /**
   * 写入消息
   * @param event 标准消息
   */
  recordMessage(event: ChatEventContract): void;

  /**
   * 读取最近消息
   * @param conversationId 会话ID
   * @param limit 数量上限
   * @returns 最近消息
   */
  getRecentMessages(
    conversationId: ConversationId,
    limit: number,
  ): readonly ChatEventContract[];
}
