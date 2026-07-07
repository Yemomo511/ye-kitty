import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { ConversationId } from '@kitty/shared/types/ids';
import type { ConversationHistoryPort } from '../ports/conversation-history.port';

/** 单会话最多保留消息数 */
const DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 100;

/**
 * 进程内会话历史
 *
 * 为 Harness MVP 提供最近消息工具的数据源，进程重启后历史会丢失。
 */
export class InMemoryConversationHistory implements ConversationHistoryPort {
  private readonly messagesByConversation = new Map<string, ChatEventContract[]>();

  constructor(
    private readonly maxMessagesPerConversation = DEFAULT_MAX_MESSAGES_PER_CONVERSATION,
  ) {}

  /**
   * 写入消息
   * @param event 标准消息
   */
  recordMessage(event: ChatEventContract): void {
    const key = String(event.conversationId);
    const messages = this.messagesByConversation.get(key) ?? [];
    messages.push(event);

    if (messages.length > this.maxMessagesPerConversation) {
      messages.splice(0, messages.length - this.maxMessagesPerConversation);
    }

    this.messagesByConversation.set(key, messages);
  }

  /**
   * 读取最近消息
   * @param conversationId 会话ID
   * @param limit 数量上限
   * @returns 最近消息
   */
  getRecentMessages(conversationId: ConversationId, limit: number): readonly ChatEventContract[] {
    const messages = this.messagesByConversation.get(String(conversationId)) ?? [];
    return messages.slice(-limit);
  }
}
