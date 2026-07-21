import { describe, expect, test } from 'vitest';
import { OneBotQqBotClient } from './client';
import type { OneBotV11ActionRequest } from './schema';
import type { OneBotFastifyReverseWsServer } from './server';

describe('OneBotQqBotClient', () => {
  test('发送群文本消息时生成统一 send_msg 动作', async () => {
    const sentActions: OneBotV11ActionRequest[] = [];
    const server = {
      async sendAction(action: OneBotV11ActionRequest) {
        sentActions.push(action);
      },
    } as unknown as OneBotFastifyReverseWsServer;

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
    } as unknown as OneBotFastifyReverseWsServer;

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
    } as unknown as OneBotFastifyReverseWsServer;

    const client = new OneBotQqBotClient(server);
    await client.sendMessageSegments({
      conversationExternalId: '123456',
      conversationType: 'group',
      segments: [
        { type: 'reply', id: 'message-1' },
        { type: 'text', text: '好好好' },
        { type: 'at', qq: '20000' },
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
          { type: 'reply', data: { id: 'message-1' } },
          { type: 'text', data: { text: '好好好' } },
          { type: 'at', data: { qq: '20000' } },
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

  test('引用回复消息段携带reply id', async () => {
    const sentActions: OneBotV11ActionRequest[] = [];
    const server = {
      async sendAction(action: OneBotV11ActionRequest) {
        sentActions.push(action);
      },
    } as unknown as OneBotFastifyReverseWsServer;

    const client = new OneBotQqBotClient(server);
    await client.sendMessageSegments({
      conversationExternalId: '123456',
      conversationType: 'group',
      segments: [
        { type: 'reply', id: '123' },
        { type: 'text', text: '我喜欢你\n' },
      ],
    });

    expect(sentActions[0]).toMatchObject({
      action: 'send_msg',
      params: {
        message_type: 'group',
        group_id: '123456',
        message: [
          { type: 'reply', data: { id: '123' } },
          { type: 'text', data: { text: '我喜欢你\n' } },
        ],
      },
    });
  });

  test('读取自定义表情时调用fetch_custom_face并归一化可发送资源', async () => {
    const sentActions: OneBotV11ActionRequest[] = [];
    const server = {
      async sendActionAndWait(action: OneBotV11ActionRequest) {
        sentActions.push(action);
        return {
          status: 'ok',
          retcode: 0,
          data: [
            { md5: 'face-md5', file: 'custom-face://cat', summary: '猫猫震惊' },
            { id: 'face-2', url: 'https://example.com/doge.png', name: '狗狗点头' },
            { id: 'missing-file' },
          ],
          echo: action.echo,
        };
      },
    } as unknown as OneBotFastifyReverseWsServer;

    const client = new OneBotQqBotClient(server);
    const faces = await client.fetchCustomFaces();

    expect(sentActions[0]).toMatchObject({ action: 'fetch_custom_face' });
    expect(faces).toEqual([
      {
        id: 'face-md5',
        file: 'custom-face://cat',
        summary: '猫猫震惊',
        name: undefined,
      },
      {
        id: 'face-2',
        file: 'https://example.com/doge.png',
        summary: undefined,
        name: '狗狗点头',
      },
    ]);
  });

  test('读取自定义表情时兼容NapCat返回URL字符串数组', async () => {
    const server = {
      async sendActionAndWait(action: OneBotV11ActionRequest) {
        return {
          status: 'ok',
          retcode: 0,
          data: [
            'https://p.qpic.cn/qq_expression/3860284970/3860284970_0_0_0_D4720C24BBCFB6245E85A46CEBE9B43E_0_0/0',
            'https://p.qpic.cn/qq_expression/3860284970/3860284970_0_0_0_892D127A739FFFE164B56A26B6462793_0_0/0',
            'https://p.qpic.cn/qq_expression/3860284970/3860284970_0_0_0_D4720C24BBCFB6245E85A46CEBE9B43E_0_0/0',
            '',
          ],
          echo: action.echo,
        };
      },
    } as unknown as OneBotFastifyReverseWsServer;

    const client = new OneBotQqBotClient(server);
    const faces = await client.fetchCustomFaces();

    expect(faces).toEqual([
      {
        id: 'D4720C24BBCFB6245E85A46CEBE9B43E',
        file: 'https://p.qpic.cn/qq_expression/3860284970/3860284970_0_0_0_D4720C24BBCFB6245E85A46CEBE9B43E_0_0/0',
        name: undefined,
        summary: undefined,
      },
      {
        id: '892D127A739FFFE164B56A26B6462793',
        file: 'https://p.qpic.cn/qq_expression/3860284970/3860284970_0_0_0_892D127A739FFFE164B56A26B6462793_0_0/0',
        name: undefined,
        summary: undefined,
      },
    ]);
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
