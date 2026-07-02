import type { EventBusPort } from '@kitty/shared/types/event-bus';
import type { ConversationId } from '@kitty/shared/types/ids';
import { QqMessageIngressService } from './qq-message-ingress.service';
import { OneBotMessageIngressService } from './onebot-message-ingress.service';
import {
  isOneBotV11SupportedMessageEvent,
  type OneBotV11SupportedMessageEvent,
} from '../domain/onebot-v11';
import type { QqBotClientPort } from '../ports/qq-bot-client.port';
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
 * 编排 NapCat/OneBot 事件接收、白名单过滤、统一事件发布和默认回复。
 * 该通道属于非官方 QQ 账号实验链路，启动后会监听 WebSocket 连接并可能发送 QQ 消息。
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
    private readonly botClient: QqBotClientPort,
  ) {}

  /**
   * 启动实验通道
   *
   * 注册 OneBot 原始消息处理器并启动 WebSocket 服务。
   * 调用后 NapCat 可以连接并开始推送 QQ 消息。
   */
  async start(): Promise<void> {
    this.server.registerRawMessageHandler(async (rawMessage) => {
      await this.handleRawMessage(rawMessage);
    });

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
    // 1. 丢弃非消息事件
    if (!isOneBotV11SupportedMessageEvent(rawMessage)) return;
    // 2. 白名单过滤
    if (!this.shouldAcceptMessage(rawMessage)) return;

    // 3. 转为统一聊天事件
    const qqPayload = this.oneBotIngress.toQqTextMessagePayload(rawMessage);
    const normalized = await this.qqIngress.normalize(qqPayload);

    // 4. 发布给内部订阅方
    await this.eventBus.publish({
      eventId: normalized.event.id,
      eventType: normalized.event.eventType,
      occurredAt: normalized.event.receivedAt,
      payload: normalized.event,
    });

    // 5. 空文本只入总线
    if (qqPayload.text.length === 0) return;

    // 6. MVP默认回复
    await this.botClient.sendTextMessage({
      conversationExternalId: this.stripQqConversationPrefix(normalized.event.conversationId),
      conversationType: qqPayload.conversationType,
      text: `叶猫猫收到：${qqPayload.text}`,
    });
  }

  // 判断消息来源是否允许进入实验通道
  private shouldAcceptMessage(message: OneBotV11SupportedMessageEvent): boolean {
    if (String(message.user_id) === this.config.selfQqId) return false;

    if (message.message_type === 'group') {
      return this.config.allowedGroupIds.includes(String(message.group_id));
    }

    return this.config.allowedFriendIds.includes(String(message.user_id));
  }

  // 还原 OneBot 发送动作需要的平台会话ID
  private stripQqConversationPrefix(conversationId: ConversationId): string {
    return String(conversationId).replace('qq:conversation:', '');
  }
}
