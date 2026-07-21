import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
  Platform,
} from '@kitty/shared/ids';

export type ChatEventType = 'message.received';
export type ConversationType = 'private' | 'group';
export type IncomingMessageType = 'text';

export interface IncomingMessage {
  readonly id: MessageId;
  readonly type: IncomingMessageType;
  readonly text: string;
  readonly mentions: readonly string[];
  readonly replyToMessageId?: MessageId;
}

export interface PlatformMessage {
  readonly id: ChatEventId;
  readonly platform: Platform;
  readonly eventType: ChatEventType;
  readonly conversationId: ConversationId;
  readonly conversationType: ConversationType;
  readonly senderId: ParticipantId;
  readonly senderDisplayName?: string;
  readonly message: IncomingMessage;
  readonly receivedAt: Date;
  readonly rawPayloadRef?: string;
}

/** 平台消息进入统一通道后的标准化结果。 */
export interface NormalizedPlatformMessage {
  /** 可被 Agent Runtime 消费的统一消息。 */
  readonly event: PlatformMessage;
  /** 平台内稳定去重键。 */
  readonly dedupeKey: string;
  /** 平台实际接收载荷的时间。 */
  readonly sourceReceivedAt: Date;
}
