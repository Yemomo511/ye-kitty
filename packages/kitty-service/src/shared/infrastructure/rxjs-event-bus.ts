import { type Observable, Subject } from 'rxjs';
import type { EventBusPort, EventHandler } from '@kitty/shared/types/event-bus';

/**
 * RxJS 泛型事件总线
 *
 * 用于在模块之间传递任意结构事件。
 * 订阅方通过泛型声明自己关心的事件类型，必要时在 handler 内自行做类型守卫。
 */
export class RxjsEventBus implements EventBusPort {
  private readonly eventsSubject = new Subject<unknown>();

  /**
   * 对外只暴露只读事件流，避免订阅方绕过 publish 直接写入总线。
   */
  readonly events$: Observable<unknown> = this.eventsSubject.asObservable();

  async publish<TEvent>(event: TEvent): Promise<void> {
    this.eventsSubject.next(event);
  }

  async subscribe<TEvent>(handler: EventHandler<TEvent>): Promise<void> {
    this.eventsSubject.subscribe((event) => {
      void handler(event as TEvent);
    });
  }
}
