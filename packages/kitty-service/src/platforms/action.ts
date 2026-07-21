import type { ActionId, ChatEventId, ConversationId, Platform } from '@kitty/shared/ids';

export type OutgoingActionType = 'send_message';
export type OutgoingActionStatus = 'pending' | 'sent' | 'failed' | 'blocked';

export interface PlatformAction {
  readonly id: ActionId;
  readonly platform: Platform;
  readonly sourceEventId: ChatEventId;
  readonly conversationId: ConversationId;
  readonly type: OutgoingActionType;
  readonly payload: {
    readonly text: string;
  };
  readonly status: OutgoingActionStatus;
  readonly createdAt: Date;
  readonly executedAt?: Date;
  readonly errorMessage?: string;
}
