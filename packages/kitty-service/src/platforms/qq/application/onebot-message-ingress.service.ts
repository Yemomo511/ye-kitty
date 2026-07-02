import type { QqTextMessagePayload } from '../domain/qq-message';
import type {
  OneBotV11GroupMessageEvent,
  OneBotV11MessageSegment,
} from '../domain/onebot-v11';

export class OneBotMessageIngressService {
  toQqTextMessagePayload(event: OneBotV11GroupMessageEvent): QqTextMessagePayload {
    const text = this.extractText(event.message);
    const mentions = this.extractMentions(event.message);

    return {
      messageId: String(event.message_id),
      conversationExternalId: String(event.group_id),
      conversationType: 'group',
      senderExternalId: String(event.user_id),
      senderDisplayName: event.sender.card || event.sender.nickname,
      text,
      mentions,
      receivedAt: new Date(event.time * 1000),
      rawPayload: event,
    };
  }

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

  extractMentions(message: string | readonly OneBotV11MessageSegment[]): readonly string[] {
    if (typeof message === 'string') return [];

    return message
      .filter((segment): segment is OneBotV11MessageSegment & { readonly data: { readonly qq: string } } => {
        return segment.type === 'at' && typeof segment.data?.qq === 'string';
      })
      .map((segment) => segment.data.qq);
  }
}
