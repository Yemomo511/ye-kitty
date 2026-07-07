import { describe, expect, test } from 'vitest';
import { OneBotQqBotClient } from '../infrastructure/onebot-qq-bot.client';
import type { OneBotV11ActionRequest } from '../domain/onebot-v11';
import type { OneBotFastifyReverseWsServer } from '../infrastructure/onebot-fastify-reverse-ws.server';

describe('OneBotQqBotClient', () => {
  test('发送群文本消息时生成统一 send_msg 动作', async () => {
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
      action: 'send_msg',
      params: {
        message_type: 'group',
        group_id: '123456',
        message: [{ type: 'text', data: { text: '叶猫猫收到：你好' } }],
      },
    });
  });

  test('发送好友文本消息时生成统一 send_msg 动作', async () => {
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
      action: 'send_msg',
      params: {
        message_type: 'private',
        user_id: '1463645455',
        message: [{ type: 'text', data: { text: '叶猫猫收到：你好' } }],
      },
    });
  });

  test('发送文本、内置表情、商城表情和图片消息段时生成受控消息段动作', async () => {
    const sentActions: OneBotV11ActionRequest[] = [];
    const server = {
      async sendAction(action: OneBotV11ActionRequest) {
        sentActions.push(action);
      },
    } as OneBotFastifyReverseWsServer;

    const client = new OneBotQqBotClient(server);
    await client.sendMessageSegments({
      conversationExternalId: '123456',
      conversationType: 'group',
      segments: [
        { type: 'text', text: '好好好' },
        { type: 'face', id: '66' },
        {
          type: 'mface',
          emojiPackageId: 123,
          emojiId: 'abc123',
          key: 'market-key',
          summary: '摸摸头',
        },
        { type: 'image', file: 'https://example.com/cat.png' },
      ],
    });

    expect(sentActions[0]).toMatchObject({
      action: 'send_msg',
      params: {
        message_type: 'group',
        group_id: '123456',
        message: [
          { type: 'text', data: { text: '好好好' } },
          { type: 'face', data: { id: '66' } },
          {
            type: 'mface',
            data: {
              emoji_package_id: 123,
              emoji_id: 'abc123',
              key: 'market-key',
              summary: '摸摸头',
            },
          },
          { type: 'image', data: { file: 'https://example.com/cat.png' } },
        ],
      },
    });
  });

  test('戳一戳按会话类型生成对应动作', async () => {
    const sentActions: OneBotV11ActionRequest[] = [];
    const server = {
      async sendAction(action: OneBotV11ActionRequest) {
        sentActions.push(action);
      },
    } as OneBotFastifyReverseWsServer;

    const client = new OneBotQqBotClient(server);
    await client.sendPoke({
      conversationExternalId: '123456',
      conversationType: 'group',
      userExternalId: '20000',
    });
    await client.sendPoke({
      conversationExternalId: '20000',
      conversationType: 'private',
      userExternalId: '20000',
    });

    expect(sentActions[0]).toMatchObject({
      action: 'group_poke',
      params: {
        group_id: '123456',
        user_id: '20000',
      },
    });
    expect(sentActions[1]).toMatchObject({
      action: 'friend_poke',
      params: {
        user_id: '20000',
      },
    });
  });

  test('消息表情回应默认使用收到的消息ID', async () => {
    const sentActions: OneBotV11ActionRequest[] = [];
    const server = {
      async sendAction(action: OneBotV11ActionRequest) {
        sentActions.push(action);
      },
    } as OneBotFastifyReverseWsServer;

    const client = new OneBotQqBotClient(server);
    await client.reactToMessage({
      messageExternalId: 'message-1',
      emojiId: '128512',
    });

    expect(sentActions[0]).toMatchObject({
      action: 'set_msg_emoji_like',
      params: {
        message_id: 'message-1',
        emoji_id: '128512',
      },
    });
  });
});
