import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
} from '@kitty/shared/types/ids';
import type { NormalizedChatEvent } from '@kitty/services/event-gateway/domain/normalized-chat-event';
import type { EventIngressPort } from '@kitty/services/event-gateway/ports/event-ingress.port';
import type { QqTextMessagePayload } from '../domain/qq-message';

export class QqMessageIngressService implements EventIngressPort<QqTextMessagePayload> {
  async normalize(rawPayload: QqTextMessagePayload): Promise<NormalizedChatEvent> {
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
    } satisfies ChatEventContract;

    return {
      event,
      dedupeKey: `qq:${rawPayload.messageId}`,
      sourceReceivedAt: rawPayload.receivedAt,
    };
  }
}
