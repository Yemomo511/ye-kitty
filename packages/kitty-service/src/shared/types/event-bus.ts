export interface EventEnvelope<TEvent> {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly payload: TEvent;
}

export interface EventBusPort {
  publish<TEvent>(event: EventEnvelope<TEvent>): Promise<void>;
  subscribe<TEvent>(
    eventType: string,
    handler: (event: EventEnvelope<TEvent>) => Promise<void>,
  ): Promise<void>;
}
