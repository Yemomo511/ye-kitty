import { Subject } from 'rxjs';

/**
 * 平台消息处理器
 *
 * 平台服务对外暴露的统一订阅回调。调用方只接收平台标准化后的消息，
 * 不直接读取平台内部 Subject，也不能向平台消息流写入数据。
 */
export type PlatformMessageHandler<TMessage> = (message: TMessage) => Promise<void>;

/**
 * 平台消息服务
 *
 * 每个平台服务各自持有独立的 RxJS Subject。
 * 上层应用只能通过 subscribe 订阅消息，发布能力仅开放给平台服务自身。
 */
export abstract class PlatformMessageService<TMessage> {
  private readonly messagesSubject = new Subject<TMessage>();

  /**
   * 订阅平台消息
   * @param handler 消息处理器
   */
  async subscribe(handler: PlatformMessageHandler<TMessage>): Promise<void> {
    this.messagesSubject.subscribe((message) => {
      void handler(message);
    });
  }

  /**
   * 发布平台消息
   * @param message 标准消息
   */
  protected async publishMessage(message: TMessage): Promise<void> {
    this.messagesSubject.next(message);
  }
}
