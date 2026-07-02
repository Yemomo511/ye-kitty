import { describe, expect, test } from 'vitest';
import { OneBotMessageIngressService } from './onebot-message-ingress.service';
import type { OneBotV11GroupMessageEvent } from '../domain/onebot-v11';

describe('OneBotMessageIngressService', () => {
  test('将 OneBot 群消息转换为 QQ 文本载荷', () => {
    const service = new OneBotMessageIngressService();
    const event: OneBotV11GroupMessageEvent = {
      time: 1782921600,
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      message_id: 42,
      group_id: 123456,
      user_id: 654321,
      message: [
        { type: 'at', data: { qq: '10000' } },
        { type: 'text', data: { text: ' 你好，叶猫猫 ' } },
      ],
      sender: {
        user_id: 654321,
        nickname: '测试用户',
        card: '群名片',
      },
    };

    const payload = service.toQqTextMessagePayload(event);

    expect(payload).toMatchObject({
      messageId: '42',
      conversationExternalId: '123456',
      conversationType: 'group',
      senderExternalId: '654321',
      senderDisplayName: '群名片',
      text: '你好，叶猫猫',
      mentions: ['10000'],
    });
  });

  test('将 OneBot 好友消息转换为 QQ 私聊载荷', () => {
    const service = new OneBotMessageIngressService();
    const payload = service.toQqTextMessagePayload({
      time: 1782921600,
      self_id: 10000,
      post_type: 'message',
      message_type: 'private',
      message_id: 'private-1',
      user_id: 1463645455,
      message: '你好，叶猫猫',
      sender: {
        user_id: 1463645455,
        nickname: '好友用户',
      },
    });

    expect(payload).toMatchObject({
      messageId: 'private-1',
      conversationExternalId: '1463645455',
      conversationType: 'private',
      senderExternalId: '1463645455',
      senderDisplayName: '好友用户',
      text: '你好，叶猫猫',
      mentions: [],
    });
  });
});
