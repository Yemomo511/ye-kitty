import type { PlatformMessage } from '@kitty/platforms/message';
import type { QqOutboundMessageSegment } from '@kitty/platforms/qq/api';
import type { QqBotClientPort } from '@kitty/platforms/qq/client';
import type { ConversationId } from '@kitty/shared/ids';
import type { QqReplyAction } from './reply-action';

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
   * @returns 是否发出外部动作
   */
  async executeReply(
    message: PlatformMessage,
    text: string | undefined,
    actions: readonly QqReplyAction[],
  ): Promise<boolean> {
    const normalizedActions = normalizeReplyActions(text, actions);

    if (normalizedActions.length === 0) {
      console.warn(
        `⚠️ [AgentRuntime-QqReplyActionExecutor-executeReply] Agent返回空动作，已跳过发送 conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )}`,
      );
      return false;
    }

    let sent = false;
    for (const action of normalizedActions) {
      sent = (await this.executeReplyAction(message, action)) || sent;
    }
    return sent;
  }

  // 将单个动作转换为 QQ 平台端口调用，单次失败不影响后续动作。
  private async executeReplyAction(
    message: PlatformMessage,
    action: QqReplyAction,
  ): Promise<boolean> {
    try {
      const conversationExternalId = stripQqConversationPrefix(message.conversationId);

      if (action.type === 'send_text') {
        await this.sendMessageSegments(message, conversationExternalId, [
          { type: 'text', text: action.text },
        ]);
        return true;
      }

      if (action.type === 'send_msg') {
        await this.sendMessageSegments(message, conversationExternalId, action.message);
        return true;
      }

      if (action.type === 'send_text_with_face') {
        await this.sendMessageSegments(
          message,
          conversationExternalId,
          action.segments.map((segment) => {
            if (segment.type === 'text') return { type: 'text', text: segment.text };
            return { type: 'face', id: segment.faceId };
          }),
        );
        return true;
      }

      if (action.type === 'send_face') {
        await this.sendMessageSegments(message, conversationExternalId, [
          { type: 'face', id: action.faceId },
        ]);
        return true;
      }

      if (action.type === 'send_custom_image') {
        await this.sendMessageSegments(message, conversationExternalId, [
          { type: 'image', file: action.file },
        ]);
        return true;
      }

      if (action.type === 'send_market_face') {
        await this.sendMessageSegments(message, conversationExternalId, [
          {
            type: 'mface',
            emojiPackageId: action.emojiPackageId,
            emojiId: action.emojiId,
            key: action.key,
            summary: action.summary,
          },
        ]);
        return true;
      }

      if (action.type === 'poke_sender') {
        await this.botClient.sendPoke({
          conversationExternalId,
          conversationType: message.conversationType,
          userExternalId: stripQqParticipantPrefix(message.senderId),
        });
        return true;
      }

      await this.botClient.reactToMessage({
        messageExternalId: stripQqMessagePrefix(message.message.id),
        emojiId: action.emojiId,
      });
      return true;
    } catch (error) {
      console.warn(
        `⚠️ [AgentRuntime-QqReplyActionExecutor-executeReplyAction] QQ动作执行失败，已继续后续动作 actionType=${action.type} conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )} reason=${formatError(error)}`,
      );
      return false;
    }
  }

  // 文字类消息保留上下文，自定义表情裸发，避免群聊重复提醒。
  private async sendMessageSegments(
    message: PlatformMessage,
    conversationExternalId: string,
    segments: readonly QqOutboundMessageSegment[],
  ): Promise<void> {
    const { contextualSegments, standaloneImageSegments } = splitStandaloneImageSegments(segments);

    if (contextualSegments.length > 0) {
      await this.botClient.sendMessageSegments({
        conversationExternalId,
        conversationType: message.conversationType,
        segments: withTriggerContext(message, contextualSegments),
      });
    }

    if (standaloneImageSegments.length > 0) {
      await this.botClient.sendMessageSegments({
        conversationExternalId,
        conversationType: message.conversationType,
        segments: standaloneImageSegments,
      });
    }
  }
}

// 兼容旧文本字段，并保留 Agent 显式动作顺序。
function normalizeReplyActions(
  text: string | undefined,
  actions: readonly QqReplyAction[],
): readonly QqReplyAction[] {
  // 戳一戳是轻量互动，不和文本回复混发，避免用户收到“戳一下又补一句”的噪音。
  const pokeAction = actions.find((action) => action.type === 'poke_sender');
  if (pokeAction) return [pokeAction];

  const normalizedActions: QqReplyAction[] = [];
  const normalizedText = text?.trim();
  const actionTexts = new Set(actions.flatMap(readActionTextSegments));
  const sentTexts = new Set<string>();

  if (normalizedText && !actionTexts.has(normalizedText)) {
    normalizedActions.push({ type: 'send_text', text: normalizedText });
    sentTexts.add(normalizedText);
  }

  for (const action of actions) {
    if (action.type === 'send_text') {
      const actionText = action.text.trim();
      if (sentTexts.has(actionText)) continue;
      sentTexts.add(actionText);
    }

    for (const actionText of readActionTextSegments(action)) {
      sentTexts.add(actionText);
    }

    normalizedActions.push(action);
  }

  return normalizedActions;
}

// 提取动作中会直接发送到 QQ 的文本，用于防止 reply.text 和动作内容重复发送。
function readActionTextSegments(action: QqReplyAction): readonly string[] {
  if (action.type === 'send_text') return [action.text.trim()].filter(Boolean);
  if (action.type === 'send_msg') {
    return action.message
      .filter((segment) => segment.type === 'text')
      .map((segment) => segment.text.trim())
      .filter(Boolean);
  }
  if (action.type === 'send_text_with_face') {
    return action.segments
      .filter((segment) => segment.type === 'text')
      .map((segment) => segment.text.trim())
      .filter(Boolean);
  }
  return [];
}

// 自定义表情通过 image 段单独发送，避免表情消息携带引用和 @ 造成重复提醒。
function splitStandaloneImageSegments(segments: readonly QqOutboundMessageSegment[]): {
  readonly contextualSegments: readonly QqOutboundMessageSegment[];
  readonly standaloneImageSegments: readonly QqOutboundMessageSegment[];
} {
  const contextualSegments = segments.filter((segment) => segment.type !== 'image');
  const standaloneImageSegments = segments.filter((segment) => segment.type === 'image');

  return { contextualSegments, standaloneImageSegments };
}

// 为普通消息补齐当前触发消息上下文。
function withTriggerContext(
  message: PlatformMessage,
  segments: readonly QqOutboundMessageSegment[],
): readonly QqOutboundMessageSegment[] {
  const senderExternalId = stripQqParticipantPrefix(message.senderId);
  const messageExternalId = stripQqMessagePrefix(message.message.id);
  const hasSenderAt = segments.some(
    (segment) => segment.type === 'at' && segment.qq === senderExternalId,
  );

  return [
    { type: 'reply', id: messageExternalId },
    ...(hasSenderAt
      ? []
      : [{ type: 'at', qq: senderExternalId } satisfies QqOutboundMessageSegment]),
    ...segments,
  ];
}

// 还原 OneBot 发送动作需要的平台会话ID。
function stripQqConversationPrefix(conversationId: ConversationId): string {
  return String(conversationId).replace('qq:conversation:', '');
}

// 还原 OneBot 互动动作需要的发送者 QQ 号。
function stripQqParticipantPrefix(senderId: string): string {
  return String(senderId).replace('qq:participant:', '');
}

// 还原 NapCat reply 和表情回应需要的平台原始消息ID。
function stripQqMessagePrefix(messageId: string): string {
  return String(messageId).replace('qq:message:', '');
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
