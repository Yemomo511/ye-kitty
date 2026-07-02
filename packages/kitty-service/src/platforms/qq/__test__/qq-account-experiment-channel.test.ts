import { describe, expect, test } from 'vitest';
import { QqAccountExperimentChannel } from '../application/qq-account-experiment-channel';
import { RxjsEventBus } from '@kitty/shared/infrastructure/rxjs-event-bus';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { EventEnvelope } from '@kitty/shared/types/event-bus';
import type { OneBotFastifyReverseWsServer } from '../infrastructure/onebot-fastify-reverse-ws.server';

describe('QqAccountExperimentChannel', () => {
  test('处理白名单群消息后只发布标准事件', async () => {
    const eventBus = new RxjsEventBus();
    const events: Array<EventEnvelope<ChatEventContract>> = [];
    await eventBus.subscribe<EventEnvelope<ChatEventContract>>(async (event) => {
      events.push(event);
    });
    const server = {} as OneBotFastifyReverseWsServer;
    const channel = new QqAccountExperimentChannel(
      { selfQqId: '10000', allowedGroupIds: ['123456'], allowedFriendIds: [] },
      server,
      eventBus,
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

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      platform: 'qq',
      eventType: 'message.received',
      conversationType: 'group',
      senderDisplayName: '测试用户',
      message: { text: '你好' },
    });
  });

  test('处理白名单好友私聊消息后只发布标准事件', async () => {
    const eventBus = new RxjsEventBus();
    const events: Array<EventEnvelope<ChatEventContract>> = [];
    await eventBus.subscribe<EventEnvelope<ChatEventContract>>(async (event) => {
      events.push(event);
    });
    const server = {} as OneBotFastifyReverseWsServer;
    const channel = new QqAccountExperimentChannel(
      { selfQqId: '10000', allowedGroupIds: [], allowedFriendIds: ['1463645455'] },
      server,
      eventBus,
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

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      platform: 'qq',
      eventType: 'message.received',
      conversationType: 'private',
      senderDisplayName: '好友用户',
      message: { text: '私聊你好' },
    });
  });

  test('忽略非白名单群和自身消息', async () => {
    const eventBus = new RxjsEventBus();
    const events: Array<EventEnvelope<ChatEventContract>> = [];
    await eventBus.subscribe<EventEnvelope<ChatEventContract>>(async (event) => {
      events.push(event);
    });
    const server = {} as OneBotFastifyReverseWsServer;
    const channel = new QqAccountExperimentChannel(
      { selfQqId: '10000', allowedGroupIds: ['123456'], allowedFriendIds: ['1463645455'] },
      server,
      eventBus,
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

    expect(events).toEqual([]);
  });

  test('忽略非白名单好友私聊消息', async () => {
    const eventBus = new RxjsEventBus();
    const events: Array<EventEnvelope<ChatEventContract>> = [];
    await eventBus.subscribe<EventEnvelope<ChatEventContract>>(async (event) => {
      events.push(event);
    });
    const server = {} as OneBotFastifyReverseWsServer;
    const channel = new QqAccountExperimentChannel(
      { selfQqId: '10000', allowedGroupIds: [], allowedFriendIds: ['1463645455'] },
      server,
      eventBus,
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

    expect(events).toEqual([]);
  });

  test('白名单空文本消息仍发布事件', async () => {
    const eventBus = new RxjsEventBus();
    const events: Array<EventEnvelope<ChatEventContract>> = [];
    await eventBus.subscribe<EventEnvelope<ChatEventContract>>(async (event) => {
      events.push(event);
    });
    const server = {} as OneBotFastifyReverseWsServer;
    const channel = new QqAccountExperimentChannel(
      { selfQqId: '10000', allowedGroupIds: ['123456'], allowedFriendIds: [] },
      server,
      eventBus,
    );

    await channel.handleRawMessage({
      time: 1782921600,
      self_id: 10000,
      post_type: 'message',
      message_type: 'group',
      message_id: 4,
      group_id: 123456,
      user_id: 20000,
      message: '',
      sender: { user_id: 20000 },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.payload.message.text).toBe('');
  });
});
