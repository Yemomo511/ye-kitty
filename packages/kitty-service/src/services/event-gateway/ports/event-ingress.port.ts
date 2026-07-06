import type { NormalizedChatEvent } from '../domain/normalized-chat-event';

export interface EventIngressPort<TRawPayload> {
  normalize(rawPayload: TRawPayload): Promise<NormalizedChatEvent>;
}
