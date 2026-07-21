import type { NormalizedPlatformMessage, PlatformMessage } from '@kitty/platforms/message';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';
import type { QqTextMessagePayload } from './message';

/** QQ载荷标准化能力。 */
export interface MessageIngress<TPayload> {
  normalize(rawPayload: TPayload): Promise<NormalizedPlatformMessage>;
}

/**
 * QQ消息标准化入口
 *
 * 负责把 QQ 平台载荷转换为 Ye-Kitty 内部统一聊天事件。
 * 转换后事件会带有稳定的 qq 前缀 ID，供事件总线和下游服务去重。
 */
export class MessageIngressRuntime implements MessageIngress<QqTextMessagePayload> {
  /**
   * 标准化QQ消息
   * @param rawPayload QQ文本载荷
   * @returns 统一聊天事件
   */
  async normalize(rawPayload: QqTextMessagePayload): Promise<NormalizedPlatformMessage> {
    const event = {
      id: `qq:event:${rawPayload.messageId}` as ChatEventId,
      platform: 'qq',
      eventType: 'message.received',
      conversationId: `qq:conversation:${rawPayload.conversationExternalId}` as ConversationId,
      conversationType: rawPayload.conversationType,
      senderId: `qq:participant:${rawPayload.senderExternalId}` as ParticipantId,
      senderDisplayName: rawPayload.senderDisplayName,
      message: {
        id: `qq:message:${rawPayload.messageId}` as MessageId,
        type: 'text',
        text: rawPayload.text,
        mentions: rawPayload.mentions,
      },
      receivedAt: rawPayload.receivedAt,
    } satisfies PlatformMessage;

    return {
      event,
      dedupeKey: `qq:${rawPayload.messageId}`,
      sourceReceivedAt: rawPayload.receivedAt,
    };
  }
}
