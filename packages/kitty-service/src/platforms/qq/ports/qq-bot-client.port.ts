export interface QqBotClientPort {
  sendTextMessage(input: {
    readonly conversationExternalId: string;
    readonly conversationType: 'private' | 'group';
    readonly text: string;
  }): Promise<void>;
}
