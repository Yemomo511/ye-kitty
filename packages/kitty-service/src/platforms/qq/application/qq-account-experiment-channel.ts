import type { EventBusPort } from '@kitty/shared/types/event-bus';
import { QqMessageIngressService } from './qq-message-ingress.service';
import { OneBotMessageIngressService } from './onebot-message-ingress.service';
import {
  isOneBotV11SupportedMessageEvent,
  type OneBotV11SupportedMessageEvent,
} from '../domain/onebot-v11';
import type { OneBotFastifyReverseWsServer } from '../infrastructure/onebot-fastify-reverse-ws.server';

/**
 * QQ账号实验通道配置
 *
 * 控制普通 QQ 账号模式下允许进入 Ye-Kitty 的消息来源。
 * 群聊和好友均采用白名单，避免机器人误入非目标会话。
 */
export interface QqAccountExperimentChannelConfig {
  /** 机器人QQ号 */
  readonly selfQqId: string;
  /** 允许监听的群号 */
  readonly allowedGroupIds: readonly string[];
  /** 允许监听的好友号 */
  readonly allowedFriendIds: readonly string[];
}

/**
 * QQ账号实验通道
 *
 * 编排 NapCat/OneBot 事件接收、白名单过滤和统一事件发布。
 * 该通道属于非官方 QQ 账号实验链路，启动后会监听 WebSocket 连接。
 * 回复动作交给上层 MessageAdapter，避免平台通道直接绑定 Agent 策略。
 */
export class QqAccountExperimentChannel {
  // OneBot事件转换器
  private readonly oneBotIngress = new OneBotMessageIngressService();
  // QQ统一事件转换器
  private readonly qqIngress = new QqMessageIngressService();

  constructor(
    private readonly config: QqAccountExperimentChannelConfig,
    private readonly server: OneBotFastifyReverseWsServer,
    private readonly eventBus: EventBusPort,
  ) {}

  /**
   * 启动实验通道
   *
   * 注册 OneBot 原始消息处理器并启动 WebSocket 服务。
   * 调用后 NapCat 可以连接并开始推送 QQ 消息。
   */
  async start(): Promise<void> {
    // 1. 把 WebSocket 收到的 OneBot 原始事件接入当前通道。
    this.server.registerRawMessageHandler(async (rawMessage) => {
      await this.handleRawMessage(rawMessage);
    });

    // 2. 启动反向 WebSocket 服务，等待 NapCat 推送 QQ 消息。
    await this.server.start();
  }

  /**
   * 停止实验通道
   *
   * 关闭 WebSocket 服务和现有连接。
   */
  async stop(): Promise<void> {
    await this.server.stop();
  }

  /**
   * 处理OneBot原始消息
   * @param rawMessage OneBot原始事件
   */
  async handleRawMessage(rawMessage: unknown): Promise<void> {
    // 1. 只处理 OneBot v11 的群聊和好友消息事件。
    if (!isOneBotV11SupportedMessageEvent(rawMessage)) return;

    // 2. 过滤非白名单来源和机器人自己发出的消息。
    if (!this.shouldAcceptMessage(rawMessage)) return;

    // 3. 转成 QQ 平台载荷，再标准化为项目内部聊天事件。
    const qqPayload = this.oneBotIngress.toQqTextMessagePayload(rawMessage);
    const normalized = await this.qqIngress.normalize(qqPayload);

    // 4. 发布到 RxJS 消息总线，后续 MessageAdapter 会接管回复链路。
    await this.eventBus.publish({
      eventId: normalized.event.id,
      eventType: normalized.event.eventType,
      occurredAt: normalized.event.receivedAt,
      payload: normalized.event,
    });
  }

  // 判断消息来源是否允许进入实验通道
  private shouldAcceptMessage(message: OneBotV11SupportedMessageEvent): boolean {
    // 1. 忽略机器人自己发出的消息，避免自己回复自己形成循环。
    if (String(message.user_id) === this.config.selfQqId) return false;

    // 2. 群聊只允许配置在 YE_KITTY_QQ_GROUP_ALLOWLIST 的群号。
    if (message.message_type === 'group') {
      return this.config.allowedGroupIds.includes(String(message.group_id));
    }

    // 3. 好友私聊只允许配置在 YE_KITTY_QQ_FRIEND_ALLOWLIST 的 QQ 号。
    return this.config.allowedFriendIds.includes(String(message.user_id));
  }
}
