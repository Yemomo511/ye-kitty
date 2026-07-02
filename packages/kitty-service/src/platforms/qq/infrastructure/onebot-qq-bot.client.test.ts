import { describe, expect, test } from 'vitest';
import { OneBotQqBotClient } from './onebot-qq-bot.client';
import type { OneBotV11ActionRequest } from '../domain/onebot-v11';
import type { OneBotFastifyReverseWsServer } from './onebot-fastify-reverse-ws.server';

describe('OneBotQqBotClient', () => {
  test('发送群文本消息时生成 send_group_msg 动作', async () => {
    const sentActions: OneBotV11ActionRequest[] = [];
    const server = {
      async sendAction(action: OneBotV11ActionRequest) {
        sentActions.push(action);
      },
    } as OneBotFastifyReverseWsServer;

    const client = new OneBotQqBotClient(server);
    await client.sendTextMessage({
      conversationExternalId: '123456',
      conversationType: 'group',
      text: '叶猫猫收到：你好',
    });

    expect(sentActions).toHaveLength(1);
    expect(sentActions[0]).toMatchObject({
      action: 'send_group_msg',
      params: {
        group_id: '123456',
        message: '叶猫猫收到：你好',
      },
    });
  });

  test('发送好友文本消息时生成 send_private_msg 动作', async () => {
    const sentActions: OneBotV11ActionRequest[] = [];
    const server = {
      async sendAction(action: OneBotV11ActionRequest) {
        sentActions.push(action);
      },
    } as OneBotFastifyReverseWsServer;

    const client = new OneBotQqBotClient(server);
    await client.sendTextMessage({
      conversationExternalId: '1463645455',
      conversationType: 'private',
      text: '叶猫猫收到：你好',
    });

    expect(sentActions).toHaveLength(1);
    expect(sentActions[0]).toMatchObject({
      action: 'send_private_msg',
      params: {
        user_id: '1463645455',
        message: '叶猫猫收到：你好',
      },
    });
  });
});
