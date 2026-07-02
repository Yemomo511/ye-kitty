import type { QqTextMessagePayload } from '../domain/qq-message';
import type {
  OneBotV11MessageSegment,
  OneBotV11SupportedMessageEvent,
} from '../domain/onebot-v11';

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
    const text = this.extractText(event.message);
    const mentions = this.extractMentions(event.message);
    const conversationType = event.message_type === 'group' ? 'group' : 'private';

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
    if (typeof message === 'string') return message;

    return message
      .filter((segment): segment is OneBotV11MessageSegment & { readonly data: { readonly text: string } } => {
        return segment.type === 'text' && typeof segment.data?.text === 'string';
      })
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
    if (typeof message === 'string') return [];

    return message
      .filter((segment): segment is OneBotV11MessageSegment & { readonly data: { readonly qq: string } } => {
        return segment.type === 'at' && typeof segment.data?.qq === 'string';
      })
      .map((segment) => segment.data.qq);
  }

  // 获取群聊或私聊的外部会话ID
  private getConversationExternalId(event: OneBotV11SupportedMessageEvent): string {
    if (event.message_type === 'group') return String(event.group_id);
    return String(event.user_id);
  }
}
