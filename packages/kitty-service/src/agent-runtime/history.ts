import type { PlatformMessage } from '@kitty/platforms/message';
import type { ConversationId } from '@kitty/shared/ids';
import type { ConversationHistoryPort } from './history-type';

/** 单会话最多保留消息数 */
const DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 100;

/**
 * 进程内会话历史
 *
 * 为 Agent MVP 提供最近消息工具的数据源，进程重启后历史会丢失。
 */
export class InMemoryConversationHistory implements ConversationHistoryPort {
  private readonly messagesByConversation = new Map<string, PlatformMessage[]>();
  private readonly messageKeys = new Set<string>();

  constructor(
    private readonly maxMessagesPerConversation = DEFAULT_MAX_MESSAGES_PER_CONVERSATION,
  ) {}

  /**
   * 写入消息
   * @param event 标准消息
   * @returns 是否新增写入
   */
  recordMessage(event: PlatformMessage): boolean {
    const key = String(event.conversationId);
    const messageKey = `${key}:${event.message.id}`;
    if (this.messageKeys.has(messageKey)) return false;

    const messages = this.messagesByConversation.get(key) ?? [];
    messages.push(event);
    this.messageKeys.add(messageKey);

    if (messages.length > this.maxMessagesPerConversation) {
      const removedMessages = messages.splice(0, messages.length - this.maxMessagesPerConversation);
      for (const removedMessage of removedMessages) {
        this.messageKeys.delete(`${key}:${removedMessage.message.id}`);
      }
    }

    this.messagesByConversation.set(key, messages);
    return true;
  }

  /**
   * 读取最近消息
   * @param conversationId 会话ID
   * @param limit 数量上限
   * @returns 最近消息
   */
  getRecentMessages(conversationId: ConversationId, limit: number): readonly PlatformMessage[] {
    const messages = this.messagesByConversation.get(String(conversationId)) ?? [];
    return messages.slice(-limit);
  }
}
