import { filter, type Observable, Subject } from 'rxjs';
import type { EventBusPort, EventEnvelope } from '@kitty/shared/types/event-bus';

export class RxjsEventBus implements EventBusPort {
  private readonly eventsSubject = new Subject<EventEnvelope<unknown>>();

  /**
   * 对外只暴露只读事件流，避免订阅方绕过 publish 直接写入总线。
   */
  readonly events$: Observable<EventEnvelope<unknown>> = this.eventsSubject.asObservable();

  async publish<TEvent>(event: EventEnvelope<TEvent>): Promise<void> {
    this.eventsSubject.next(event as EventEnvelope<unknown>);
  }

  async subscribe<TEvent>(
    eventType: string,
    handler: (event: EventEnvelope<TEvent>) => Promise<void>,
  ): Promise<void> {
    this.events$
      .pipe(filter((event) => event.eventType === eventType))
      .subscribe((event) => {
        void handler(event as EventEnvelope<TEvent>);
      });
  }
}
