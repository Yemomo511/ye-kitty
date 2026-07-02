import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
  Platform,
} from '@kitty/shared/domain/ids';

export type ChatEventType = 'message.received';
export type ConversationType = 'private' | 'group';
export type IncomingMessageType = 'text';

export interface IncomingMessageContract {
  readonly id: MessageId;
  readonly type: IncomingMessageType;
  readonly text: string;
  readonly mentions: readonly string[];
  readonly replyToMessageId?: MessageId;
}

export interface ChatEventContract {
  readonly id: ChatEventId;
  readonly platform: Platform;
  readonly eventType: ChatEventType;
  readonly conversationId: ConversationId;
  readonly conversationType: ConversationType;
  readonly senderId: ParticipantId;
  readonly senderDisplayName?: string;
  readonly message: IncomingMessageContract;
  readonly receivedAt: Date;
  readonly rawPayloadRef?: string;
}
