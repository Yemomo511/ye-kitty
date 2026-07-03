import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { QqBotClientPort } from '@kitty/platforms/qq/ports/qq-bot-client.port';
import type { EventBusPort, EventEnvelope } from '@kitty/shared/types/event-bus';
import type { ConversationId } from '@kitty/shared/types/ids';
import { writeDebugLog } from '@kitty/shared/infrastructure/logging';
import type { QqReplyAgentPort } from '../ports/qq-reply-agent.port';

/**
 * QQ回复事件订阅器
 *
 * Agent Runtime 的 RxJS 入口。它订阅下层 QQ runtime 发布的标准消息事件，
 * 调用 QQ 回复 Agent 生成文本，并通过 QQ 发送端口完成 MVP 回写。
 */
export class QqReplyEventSubscriber {
  constructor(
    private readonly eventBus: EventBusPort,
    private readonly botClient: QqBotClientPort,
    private readonly replyAgent: QqReplyAgentPort,
  ) {}

  /**
   * 注册QQ消息订阅
   *
   * 订阅必须由上层 Agent Runtime 发起，避免 QQ 平台模块反向依赖业务服务。
   */
  async start(): Promise<void> {
    console.info('✅ [AgentRuntime-QQReplySubscriber] 已注册QQ消息订阅');
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
    if (chatEvent.message.text.trim().length === 0) {
      writeDebugLog(
        `⏭️ [AgentRuntime-QQReplySubscriber-handleEvent] 跳过空文本消息 conversationType=${chatEvent.conversationType} messageId=${maskId(
          chatEvent.message.id,
        )}`,
      );
      return;
    }

    writeDebugLog(
      `🚧 [AgentRuntime-QQReplySubscriber-handleEvent] 开始生成QQ回复 conversationType=${chatEvent.conversationType} messageId=${maskId(
        chatEvent.message.id,
      )} textLength=${chatEvent.message.text.length}`,
    );
    const reply = await this.replyAgent.generateReply({ event: chatEvent });

    await this.botClient.sendTextMessage({
      conversationExternalId: stripQqConversationPrefix(chatEvent.conversationId),
      conversationType: chatEvent.conversationType,
      text: reply.text,
    });
    console.info(
      `✅ [AgentRuntime-QQReplySubscriber-handleEvent] 已发送QQ回复 conversationType=${chatEvent.conversationType} messageId=${maskId(
        chatEvent.message.id,
      )} replyLength=${reply.text.length}`,
    );
  }
}

// 识别 QQ 标准收信事件，避免 Agent Runtime 误处理其他平台事件。
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
