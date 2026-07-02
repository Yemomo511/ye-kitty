export interface QqTextMessagePayload {
  readonly messageId: string;
  readonly conversationExternalId: string;
  readonly conversationType: 'private' | 'group';
  readonly senderExternalId: string;
  readonly senderDisplayName?: string;
  readonly text: string;
  readonly mentions: readonly string[];
  readonly receivedAt: Date;
  readonly rawPayload: unknown;
}
