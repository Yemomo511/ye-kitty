// 标准事件信封，适合需要事件ID、类型和发生时间的业务事件。
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
 * 只约束“发布一个事件”和“订阅一个事件流”的能力。
 * 事件本身不强制使用 EventEnvelope，便于后续接入外部协议事件或轻量内部信号。
 */
export interface EventBusPort {
  // 发布任意结构事件
  publish<TEvent>(event: TEvent): Promise<void>;

  // 订阅任意结构事件
  subscribe<TEvent>(handler: EventHandler<TEvent>): Promise<void>;
}
