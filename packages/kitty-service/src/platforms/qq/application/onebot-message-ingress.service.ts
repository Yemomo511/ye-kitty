import type { QqTextMessagePayload } from '../domain/qq-message';
import type { OneBotV11MessageSegment, OneBotV11SupportedMessageEvent } from '../domain/onebot-v11';

/**
 * OneBot消息入口转换器
 *
 * 负责把 NapCat 上报的 OneBot v11 消息事件转换为 QQ 平台载荷。
 * 该类只处理平台字段映射，不发布事件、不发送回复。
 */
export class OneBotMessageIngressService {
  /**
   * 转换为QQ文本载荷
   * @param event OneBot消息事件
   * @returns QQ文本载荷
   */
  toQqTextMessagePayload(event: OneBotV11SupportedMessageEvent): QqTextMessagePayload {
    // 1. 从 OneBot 消息段中提取 Ye-Kitty 当前关心的文本和@信息。
    const text = this.extractText(event.message);
    const mentions = this.extractMentions(event.message);

    // 2. 识别群聊或好友私聊，决定后续回复使用的会话类型。
    const conversationType = event.message_type === 'group' ? 'group' : 'private';

    // 3. 封装为 QQ 平台载荷，交给统一聊天事件转换器继续标准化。
    return {
      messageId: String(event.message_id),
      conversationExternalId: this.getConversationExternalId(event),
      conversationType,
      senderExternalId: String(event.user_id),
      senderDisplayName: event.sender.card || event.sender.nickname,
      text,
      mentions,
      receivedAt: new Date(event.time * 1000),
      rawPayload: event,
    };
  }

  /**
   * 提取文本内容
   * @param message OneBot消息
   * @returns 纯文本
   */
  extractText(message: string | readonly OneBotV11MessageSegment[]): string {
    // 1. NapCat 可能直接给字符串消息，此时可直接作为文本内容。
    if (typeof message === 'string') return message;

    // 2. 结构化消息只拼接 text 段，图片、表情等非文本段暂不参与默认回复。
    return message
      .filter(
        (
          segment,
        ): segment is OneBotV11MessageSegment & { readonly data: { readonly text: string } } => {
          return segment.type === 'text' && typeof segment.data?.text === 'string';
        },
      )
      .map((segment) => segment.data.text)
      .join('')
      .trim();
  }

  /**
   * 提取@目标
   * @param message OneBot消息
   * @returns QQ号列表
   */
  extractMentions(message: string | readonly OneBotV11MessageSegment[]): readonly string[] {
    // 1. 字符串消息不携带结构化@信息。
    if (typeof message === 'string') return [];

    // 2. 只收集 at 段里的 QQ 号，供后续自主回复决策使用。
    return message
      .filter(
        (
          segment,
        ): segment is OneBotV11MessageSegment & { readonly data: { readonly qq: string } } => {
          return segment.type === 'at' && typeof segment.data?.qq === 'string';
        },
      )
      .map((segment) => segment.data.qq);
  }

  // 获取群聊或私聊的外部会话ID
  private getConversationExternalId(event: OneBotV11SupportedMessageEvent): string {
    if (event.message_type === 'group') return String(event.group_id);
    return String(event.user_id);
  }
}
