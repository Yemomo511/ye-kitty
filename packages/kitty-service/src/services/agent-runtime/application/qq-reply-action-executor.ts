import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { QqBotClientPort } from '@kitty/platforms/qq/ports/qq-bot-client.port';
import type { ConversationId } from '@kitty/shared/types/ids';
import type { QqReplyAction } from '../ports/qq-reply-agent.port';

/**
 * QQ回复动作执行器
 *
 * 将 Agent 的受控动作绑定到当前消息上下文，再交给 QQ 发送端口执行。
 * Agent 不能指定任意会话、任意用户或任意消息，避免绕过平台白名单边界。
 */
export class QqReplyActionExecutor {
  constructor(private readonly botClient: QqBotClientPort) {}

  /**
   * 执行回复文本和受控动作
   * @param message 当前QQ消息
   * @param text 兼容文本回复
   * @param actions 受控动作
   */
  async executeReply(
    message: ChatEventContract,
    text: string | undefined,
    actions: readonly QqReplyAction[],
  ): Promise<void> {
    const normalizedActions = normalizeReplyActions(text, actions);

    if (normalizedActions.length === 0) {
      console.warn(
        `⚠️ [AgentRuntime-QqReplyActionExecutor-executeReply] Agent返回空动作，已跳过发送 conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )}`,
      );
      return;
    }

    for (const action of normalizedActions) {
      await this.executeReplyAction(message, action);
    }
  }

  // 将单个动作转换为 QQ 平台端口调用，单次失败不影响后续动作。
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
        `⚠️ [AgentRuntime-QqReplyActionExecutor-executeReplyAction] QQ动作执行失败，已继续后续动作 actionType=${action.type} conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )} reason=${formatError(error)}`,
      );
    }
  }
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

// 还原 OneBot 发送动作需要的平台会话ID。
function stripQqConversationPrefix(conversationId: ConversationId): string {
  return String(conversationId).replace('qq:conversation:', '');
}

// 还原 OneBot 互动动作需要的发送者 QQ 号。
function stripQqParticipantPrefix(senderId: string): string {
  return String(senderId).replace('qq:participant:', '');
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
