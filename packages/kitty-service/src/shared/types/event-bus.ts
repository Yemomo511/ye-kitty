// 通用事件信封，适合项目配置、并发策略等系统级消息。
export interface EventEnvelope<TEvent> {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly payload: TEvent;
}

// 事件处理器，具体事件结构由订阅方通过泛型约定。
export type EventHandler<TEvent> = (event: TEvent) => Promise<void>;

/**
 * 事件总线接口
 *
 * 只用于跨模块通用系统消息，例如项目配置、并发策略或轻量内部信号。
 * 具体平台业务消息由各 platform service 自持 Subject 并通过 subscribe 暴露。
 */
export interface EventBusPort {
  // 发布系统级通用事件
  publish<TEvent>(event: TEvent): Promise<void>;

  // 订阅系统级通用事件
  subscribe<TEvent>(handler: EventHandler<TEvent>): Promise<void>;
}
