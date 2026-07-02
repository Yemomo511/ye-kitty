import type { EventBusPort } from '@kitty/shared/types/event-bus';
import type { EventIngressPort } from '../ports/event-ingress.port';

export class EventGatewayService<TRawPayload> {
  constructor(
    private readonly ingress: EventIngressPort<TRawPayload>,
    private readonly eventBus: EventBusPort,
  ) {}

  async accept(rawPayload: TRawPayload): Promise<void> {
    const normalized = await this.ingress.normalize(rawPayload);
    await this.eventBus.publish({
      eventId: normalized.event.id,
      eventType: normalized.event.eventType,
      occurredAt: normalized.event.receivedAt,
      payload: normalized.event,
    });
  }
}
