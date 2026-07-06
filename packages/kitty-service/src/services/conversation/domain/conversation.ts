import type { ConversationId, Platform } from '@kitty/shared/types/ids';
import type { ConversationType } from '@kitty/contracts/events/chat-event.contract';

export type ConversationStatus = 'active' | 'muted' | 'blocked';

export interface Conversation {
  readonly id: ConversationId;
  readonly platform: Platform;
  readonly type: ConversationType;
  readonly externalId: string;
  readonly title?: string;
  readonly status: ConversationStatus;
}
