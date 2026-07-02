import type { EventBusPort } from '@kitty/shared/types/event-bus';
import { TemplateUseCase } from '@kitty/shared/abstracts/template-use-case';
import type { TemplateExecutionContext } from '@kitty/shared/types/template-method';
import type { EventIngressPort } from '../ports/event-ingress.port';

export class EventGatewayService<TRawPayload> extends TemplateUseCase<
  TRawPayload,
  void
> {
  constructor(
    private readonly ingress: EventIngressPort<TRawPayload>,
    private readonly eventBus: EventBusPort,
  ) {
    super();
  }

  async accept(rawPayload: TRawPayload): Promise<void> {
    await this.execute(rawPayload);
  }

  protected async executeCore(
    context: TemplateExecutionContext<TRawPayload>,
  ): Promise<void> {
    const normalized = await this.ingress.normalize(context.input);
    await this.eventBus.publish({
      eventId: normalized.event.id,
      eventType: normalized.event.eventType,
      occurredAt: normalized.event.receivedAt,
      payload: normalized.event,
    });
  }
}
