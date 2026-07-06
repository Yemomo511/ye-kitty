import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { PlatformMessageService } from '@kitty/platforms/shared';
import type { QqBotClientPort } from '@kitty/platforms/qq/ports/qq-bot-client.port';
import type { ConversationId } from '@kitty/shared/types/ids';
import { writeDebugLog } from '@kitty/shared/infrastructure/logging';
import type { QqReplyAction, QqReplyAgentPort } from '../ports/qq-reply-agent.port';
import type { SkillRuntimeService } from './skill-runtime.service';

/**
 * QQ回复事件订阅器
 *
 * Agent Runtime 的 RxJS 入口。它订阅下层 QQ 服务发布的标准消息事件，
 * 调用 QQ 回复 Agent 生成文本，并通过 QQ 发送端口完成 MVP 回写。
 */
export class QqReplyEventSubscriber {
  constructor(
    private readonly qqMessageService: PlatformMessageService<ChatEventContract>,
    private readonly botClient: QqBotClientPort,
    private readonly replyAgent: QqReplyAgentPort,
    private readonly skillRuntime?: SkillRuntimeService,
  ) {}

  /**
   * 注册QQ消息订阅
   *
   * 订阅必须由上层 Agent Runtime 发起，避免 QQ 平台模块反向依赖业务服务。
   */
  async start(): Promise<void> {
    console.info('✅ [AgentRuntime-QQReplySubscriber] 已注册QQ消息订阅');
    await this.qqMessageService.subscribe(async (message) => {
      await this.handleMessage(message);
    });
  }

  /**
   * 处理QQ消息
   * @param message 标准消息
   */
  async handleMessage(message: ChatEventContract): Promise<void> {
    if (!isQqReceivedMessage(message)) return;

    if (message.message.text.trim().length === 0) {
      writeDebugLog(
        `⏭️ [AgentRuntime-QQReplySubscriber-handleMessage] 跳过空文本消息 conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )}`,
      );
      return;
    }

    writeDebugLog(
      `🚧 [AgentRuntime-QQReplySubscriber-handleMessage] 开始生成QQ回复 conversationType=${message.conversationType} messageId=${maskId(
        message.message.id,
      )} textLength=${message.message.text.length}`,
    );
    const availableSkills = await this.skillRuntime?.selectSkillsForQqReply(message);
    const reply = await this.replyAgent.generateReply({ event: message, availableSkills });

    await this.executeReply(message, reply.text, reply.actions ?? []);
    console.info(
      `✅ [AgentRuntime-QQReplySubscriber-handleMessage] 已发送QQ回复 conversationType=${message.conversationType} messageId=${maskId(
        message.message.id,
      )} replyLength=${reply.text?.length ?? 0} actionCount=${reply.actions?.length ?? 0}`,
    );
  }

  // 执行文本和受控动作，确保单个动作失败不会中断后续动作。
  private async executeReply(
    message: ChatEventContract,
    text: string | undefined,
    actions: readonly QqReplyAction[],
  ): Promise<void> {
    const normalizedActions = normalizeReplyActions(text, actions);

    if (normalizedActions.length === 0) {
      console.warn(
        `⚠️ [AgentRuntime-QQReplySubscriber-executeReply] Agent返回空动作，已跳过发送 conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )}`,
      );
      return;
    }

    for (const action of normalizedActions) {
      await this.executeReplyAction(message, action);
    }
  }

  // 将 Agent 动作转为 QQ 发送端口调用。
  private async executeReplyAction(
    message: ChatEventContract,
    action: QqReplyAction,
  ): Promise<void> {
    try {
      const conversationExternalId = stripQqConversationPrefix(message.conversationId);

      if (action.type === 'send_text') {
        await this.botClient.sendTextMessage({
          conversationExternalId,
          conversationType: message.conversationType,
          text: action.text,
        });
        return;
      }

      if (action.type === 'send_face') {
        await this.botClient.sendMessageSegments({
          conversationExternalId,
          conversationType: message.conversationType,
          segments: [{ type: 'face', id: action.faceId }],
        });
        return;
      }

      if (action.type === 'send_custom_image') {
        await this.botClient.sendMessageSegments({
          conversationExternalId,
          conversationType: message.conversationType,
          segments: [{ type: 'image', file: action.file }],
        });
        return;
      }

      if (action.type === 'poke_sender') {
        await this.botClient.sendPoke({
          conversationExternalId,
          conversationType: message.conversationType,
          userExternalId: stripQqParticipantPrefix(message.senderId),
        });
        return;
      }

      await this.botClient.reactToMessage({
        messageExternalId: message.message.id,
        emojiId: action.emojiId,
      });
    } catch (error) {
      console.warn(
        `⚠️ [AgentRuntime-QQReplySubscriber-executeReply] QQ动作执行失败，已继续后续动作 actionType=${action.type} conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )} reason=${formatError(error)}`,
      );
    }
  }
}

// 识别 QQ 标准收信事件，避免 Agent Runtime 处理非目标消息。
function isQqReceivedMessage(message: ChatEventContract): boolean {
  return message.platform === 'qq' && message.eventType === 'message.received';
}

// 还原 OneBot 发送动作需要的平台会话ID。
function stripQqConversationPrefix(conversationId: ConversationId): string {
  return String(conversationId).replace('qq:conversation:', '');
}

// 还原 OneBot 互动动作需要的发送者 QQ 号。
function stripQqParticipantPrefix(senderId: string): string {
  return String(senderId).replace('qq:participant:', '');
}

// 兼容旧文本字段，并保留 Agent 显式动作顺序。
function normalizeReplyActions(
  text: string | undefined,
  actions: readonly QqReplyAction[],
): readonly QqReplyAction[] {
  const normalizedActions: QqReplyAction[] = [];
  const normalizedText = text?.trim();
  if (normalizedText) normalizedActions.push({ type: 'send_text', text: normalizedText });
  normalizedActions.push(...actions);
  return normalizedActions;
}

// 脱敏消息ID，仅保留排障所需的尾部特征。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}

// 压缩错误内容，避免日志输出大对象或敏感上下文。
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
