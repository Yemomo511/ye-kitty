import type { ConversationId, MessageId, ParticipantId } from '@kitty/shared/types/ids';

export type MessageDirection = 'incoming' | 'outgoing';

export interface ConversationMessage {
  readonly id: MessageId;
  readonly conversationId: ConversationId;
  readonly senderId: ParticipantId;
  readonly direction: MessageDirection;
  readonly text: string;
  readonly createdAt: Date;
}
