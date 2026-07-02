import { describe, expect, test } from 'vitest';
import { QqAccountExperimentChannel } from '../application/qq-account-experiment-channel';
import { RxjsEventBus } from '@kitty/shared/infrastructure/rxjs-event-bus';
import type { QqBotClientPort } from '../ports/qq-bot-client.port';
import type { OneBotFastifyReverseWsServer } from '../infrastructure/onebot-fastify-reverse-ws.server';

describe('QqAccountExperimentChannel', () => {
  test('处理白名单群消息并回复默认文本', async () => {
    const eventBus = new RxjsEventBus();
    const replies: string[] = [];
    const botClient: QqBotClientPort = {
      async sendTextMessage(input) {
        replies.push(input.text);
      },
    };
    const server = {} as OneBotFastifyReverseWsServer;
    const channel = new QqAccountExperimentChannel(
      { selfQqId: '10000', allowedGroupIds: ['123456'], allowedFriendIds: [] },
      server,
      eventBus,
      botClient,
    );

    await channel.handleRawMessage({
      time: 1782921600,
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      message_id: 1,
      group_id: 123456,
      user_id: 20000,
      message: '你好',
      sender: { user_id: 20000, nickname: '测试用户' },
    });

    expect(replies).toEqual(['叶猫猫收到：你好']);
  });

  test('处理白名单好友私聊消息并回复默认文本', async () => {
    const eventBus = new RxjsEventBus();
    const replies: Array<{ readonly text: string; readonly conversationType: 'private' | 'group' }> = [];
    const botClient: QqBotClientPort = {
      async sendTextMessage(input) {
        replies.push({
          text: input.text,
          conversationType: input.conversationType,
        });
      },
    };
    const server = {} as OneBotFastifyReverseWsServer;
    const channel = new QqAccountExperimentChannel(
      { selfQqId: '10000', allowedGroupIds: [], allowedFriendIds: ['1463645455'] },
      server,
      eventBus,
      botClient,
    );

    await channel.handleRawMessage({
      time: 1782921600,
      self_id: 10000,
      post_type: 'message',
      message_type: 'private',
      message_id: 1,
      user_id: 1463645455,
      message: '私聊你好',
      sender: { user_id: 1463645455, nickname: '好友用户' },
    });

    expect(replies).toEqual([
      {
        text: '叶猫猫收到：私聊你好',
        conversationType: 'private',
      },
    ]);
  });

  test('忽略非白名单群和自身消息', async () => {
    const eventBus = new RxjsEventBus();
    const replies: string[] = [];
    const botClient: QqBotClientPort = {
      async sendTextMessage(input) {
        replies.push(input.text);
      },
    };
    const server = {} as OneBotFastifyReverseWsServer;
    const channel = new QqAccountExperimentChannel(
      { selfQqId: '10000', allowedGroupIds: ['123456'], allowedFriendIds: ['1463645455'] },
      server,
      eventBus,
      botClient,
    );

    await channel.handleRawMessage({
      time: 1782921600,
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      message_id: 1,
      group_id: 999999,
      user_id: 20000,
      message: '非白名单',
      sender: { user_id: 20000 },
    });
    await channel.handleRawMessage({
      time: 1782921600,
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      message_id: 2,
      group_id: 123456,
      user_id: 10000,
      message: '自己发的',
      sender: { user_id: 10000 },
    });

    expect(replies).toEqual([]);
  });

  test('忽略非白名单好友私聊消息', async () => {
    const eventBus = new RxjsEventBus();
    const replies: string[] = [];
    const botClient: QqBotClientPort = {
      async sendTextMessage(input) {
        replies.push(input.text);
      },
    };
    const server = {} as OneBotFastifyReverseWsServer;
    const channel = new QqAccountExperimentChannel(
      { selfQqId: '10000', allowedGroupIds: [], allowedFriendIds: ['1463645455'] },
      server,
      eventBus,
      botClient,
    );

    await channel.handleRawMessage({
      time: 1782921600,
      self_id: 10000,
      post_type: 'message',
      message_type: 'private',
      message_id: 3,
      user_id: 999999,
      message: '非白名单好友',
      sender: { user_id: 999999 },
    });

    expect(replies).toEqual([]);
  });
});
