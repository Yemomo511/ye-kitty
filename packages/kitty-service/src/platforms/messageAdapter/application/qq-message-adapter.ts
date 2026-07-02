import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { QqReplyAgentPort } from '@kitty/services/agent-runtime';
import type { EventBusPort, EventEnvelope } from '@kitty/shared/types/event-bus';
import type { ConversationId } from '@kitty/shared/types/ids';
import type { QqBotClientPort } from '@kitty/platforms/qq/ports/qq-bot-client.port';

/**
 * QQ消息适配器
 *
 * 订阅平台标准消息事件，把 QQ 文本消息实时交给 Agent Runtime。
 * 回复生成后通过 QQ 发送端口回写，平台通道自身不再持有回复策略。
 */
export class QqMessageAdapter {
  constructor(
    private readonly eventBus: EventBusPort,
    private readonly botClient: QqBotClientPort,
    private readonly replyAgent: QqReplyAgentPort,
  ) {}

  /**
   * 注册QQ消息订阅
   *
   * 调用后会持续监听事件总线，直到进程或底层总线关闭。
   */
  async start(): Promise<void> {
    console.info('[MessageAdapter-QQ] 已注册QQ消息订阅');
    await this.eventBus.subscribe<EventEnvelope<unknown>>(async (event) => {
      await this.handleEvent(event);
    });
  }

  /**
   * 处理总线事件
   * @param event 标准事件信封
   */
  async handleEvent(event: EventEnvelope<unknown>): Promise<void> {
    if (!isQqReceivedMessageEvent(event)) return;

    const chatEvent = event.payload;
    if (chatEvent.message.text.trim().length === 0) return;

    console.info(
      `[MessageAdapter-QQ] 开始生成QQ回复 conversationType=${chatEvent.conversationType} messageId=${maskId(
        chatEvent.message.id,
      )}`,
    );
    const reply = await this.replyAgent.generateReply({ event: chatEvent });

    await this.botClient.sendTextMessage({
      conversationExternalId: stripQqConversationPrefix(chatEvent.conversationId),
      conversationType: chatEvent.conversationType,
      text: reply.text,
    });
    console.info(
      `[MessageAdapter-QQ] 已发送QQ回复 conversationType=${chatEvent.conversationType} messageId=${maskId(
        chatEvent.message.id,
      )}`,
    );
  }
}

// 识别 QQ 标准收信事件，避免调度层误处理其他平台事件。
function isQqReceivedMessageEvent(
  event: EventEnvelope<unknown>,
): event is EventEnvelope<ChatEventContract> {
  if (event.eventType !== 'message.received') return false;
  if (!isRecord(event.payload)) return false;

  return event.payload.platform === 'qq' && event.payload.eventType === 'message.received';
}

// 判断未知对象是否可安全读取字段。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// 还原 OneBot 发送动作需要的平台会话ID。
function stripQqConversationPrefix(conversationId: ConversationId): string {
  return String(conversationId).replace('qq:conversation:', '');
}

// 脱敏消息ID，仅保留排障所需的尾部特征。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}
