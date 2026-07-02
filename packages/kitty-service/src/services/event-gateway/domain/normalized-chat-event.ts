import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';

export interface NormalizedChatEvent {
  readonly event: ChatEventContract;
  readonly dedupeKey: string;
  readonly sourceReceivedAt: Date;
}
