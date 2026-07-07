import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { QqBotClientPort } from '@kitty/platforms/qq/ports/qq-bot-client.port';
import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
} from '@kitty/shared/types/ids';
import { describe, expect, test, vi } from 'vitest';
import { QqReplyActionExecutor } from '../application/qq-reply-action-executor';
import { parseQqReplyAction } from '../domain/qq-reply-action';
import type { QqReplyAction } from '../ports/qq-reply-agent.port';

describe('parseQqReplyAction', () => {
  test('解析QQ动作', () => {
    expect(parseQqReplyAction({ type: 'send_text', text: '  你好喵~  ' })).toEqual({
      type: 'send_text',
      text: '你好喵~',
    });
    expect(
      parseQqReplyAction({
        type: 'send_text_with_face',
        segments: [
          { type: 'text', text: ' 好好好 ' },
          { type: 'face', faceId: ' 66 ' },
        ],
      }),
    ).toEqual({
      type: 'send_text_with_face',
      segments: [
        { type: 'text', text: '好好好' },
        { type: 'face', faceId: '66' },
      ],
    });
    expect(parseQqReplyAction({ type: 'send_face', faceId: ' 66 ' })).toEqual({
      type: 'send_face',
      faceId: '66',
    });
    expect(parseQqReplyAction({ type: 'send_custom_image', file: ' cat.png ' })).toEqual({
      type: 'send_custom_image',
      file: 'cat.png',
    });
    expect(
      parseQqReplyAction({
        type: 'send_market_face',
        emojiPackageId: ' 123 ',
        emojiId: 'abc123',
        key: 'market-key',
        summary: '摸摸头',
      }),
    ).toEqual({
      type: 'send_market_face',
      emojiPackageId: 123,
      emojiId: 'abc123',
      key: 'market-key',
      summary: '摸摸头',
    });
    expect(parseQqReplyAction({ type: 'poke_sender' })).toEqual({ type: 'poke_sender' });
    expect(parseQqReplyAction({ type: 'react_to_message', emojiId: ' 128512 ' })).toEqual({
      type: 'react_to_message',
      emojiId: '128512',
    });
  });

  test('过滤未知动作、空字段和控制字符', () => {
    expect(parseQqReplyAction({ type: 'reply_to_message', text: '不允许' })).toBeUndefined();
    expect(parseQqReplyAction({ type: 'mention_sender', text: '不允许' })).toBeUndefined();
    expect(parseQqReplyAction({ type: 'send_text', text: '   ' })).toBeUndefined();
    expect(
      parseQqReplyAction({
        type: 'send_text_with_face',
        segments: [{ type: 'text', text: '只有文字' }],
      }),
    ).toBeUndefined();
    expect(
      parseQqReplyAction({
        type: 'send_text_with_face',
        segments: [
          { type: 'text', text: '好' },
          { type: 'face', faceId: '66\n77' },
        ],
      }),
    ).toBeUndefined();
    expect(parseQqReplyAction({ type: 'send_face', faceId: '66\n77' })).toBeUndefined();
    expect(
      parseQqReplyAction({
        type: 'send_market_face',
        emojiPackageId: 0,
        emojiId: 'abc123',
        key: 'market-key',
        summary: '摸摸头',
      }),
    ).toBeUndefined();
  });
});

describe('QqReplyActionExecutor', () => {
  test('将文本、表情和图片动作映射为QQ发送端口输入', async () => {
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const executor = new QqReplyActionExecutor(createTestBotClient({ replies, segments }));

    await executor.executeReply(createChatEvent(), '主回复喵~', [
      {
        type: 'send_text_with_face',
        segments: [
          { type: 'text', text: '好好好' },
          { type: 'face', faceId: '66' },
        ],
      },
      { type: 'send_face', faceId: '66' },
      { type: 'send_custom_image', file: 'https://example.com/cat.png' },
      {
        type: 'send_market_face',
        emojiPackageId: 123,
        emojiId: 'abc123',
        key: 'market-key',
        summary: '摸摸头',
      },
    ]);

    expect(replies).toEqual([]);
    expect(segments).toEqual([
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        segments: [{ type: 'text', text: '主回复喵~' }],
      },
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        segments: [
          { type: 'text', text: '好好好' },
          { type: 'face', id: '66' },
        ],
      },
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        segments: [{ type: 'face', id: '66' }],
      },
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        segments: [{ type: 'image', file: 'https://example.com/cat.png' }],
      },
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        segments: [
          {
            type: 'mface',
            emojiPackageId: 123,
            emojiId: 'abc123',
            key: 'market-key',
            summary: '摸摸头',
          },
        ],
      },
    ]);
  });

  test('互动动作绑定当前消息上下文', async () => {
    const pokes: Array<Parameters<QqBotClientPort['sendPoke']>[0]> = [];
    const reactions: Array<Parameters<QqBotClientPort['reactToMessage']>[0]> = [];
    const executor = new QqReplyActionExecutor(createTestBotClient({ pokes, reactions }));

    await executor.executeReply(createChatEvent(), undefined, [{ type: 'poke_sender' }]);
    await executor.executeReply(createChatEvent(), undefined, [
      { type: 'react_to_message', emojiId: '128512' },
    ]);

    expect(pokes).toEqual([
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        userExternalId: '20000',
      },
    ]);
    expect(reactions).toEqual([{ messageExternalId: 'message-1', emojiId: '128512' }]);
  });

  test('戳一戳会独占本轮回复并忽略文本', async () => {
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const pokes: Array<Parameters<QqBotClientPort['sendPoke']>[0]> = [];
    const executor = new QqReplyActionExecutor(createTestBotClient({ replies, segments, pokes }));

    await executor.executeReply(createChatEvent(), '不要发出去', [
      { type: 'send_face', faceId: '66' },
      { type: 'poke_sender' },
    ]);

    expect(replies).toEqual([]);
    expect(segments).toEqual([]);
    expect(pokes).toEqual([
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        userExternalId: '20000',
      },
    ]);
  });

  test('外层文本和send_text重复时只发送一次', async () => {
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const executor = new QqReplyActionExecutor(createTestBotClient({ replies, segments }));

    await executor.executeReply(createChatEvent(), '重复回复', [
      { type: 'send_text', text: '重复回复' },
      { type: 'send_text', text: '追加一句' },
      { type: 'send_text', text: '追加一句' },
    ]);

    expect(replies).toEqual([]);
    expect(segments).toEqual([
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        segments: [{ type: 'text', text: '重复回复' }],
      },
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        segments: [{ type: 'text', text: '追加一句' }],
      },
    ]);
  });

  test('外层文本和混排动作重复时只发送混排消息', async () => {
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const executor = new QqReplyActionExecutor(createTestBotClient({ replies, segments }));

    await executor.executeReply(createChatEvent(), '好好好', [
      {
        type: 'send_text_with_face',
        segments: [
          { type: 'text', text: '好好好' },
          { type: 'face', faceId: '66' },
        ],
      },
    ]);

    expect(replies).toEqual([]);
    expect(segments).toEqual([
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        segments: [
          { type: 'text', text: '好好好' },
          { type: 'face', id: '66' },
        ],
      },
    ]);
  });

  test('表情回应只能绑定当前消息上下文', async () => {
    const reactions: Array<Parameters<QqBotClientPort['reactToMessage']>[0]> = [];
    const executor = new QqReplyActionExecutor(createTestBotClient({ reactions }));
    const actions = [
      parseQqReplyAction({
        type: 'react_to_message',
        messageExternalId: 'evil-message',
        emojiId: '128512',
      }),
    ].filter((action): action is QqReplyAction => Boolean(action));

    await executor.executeReply(createChatEvent(), undefined, actions);

    expect(reactions).toEqual([{ messageExternalId: 'message-1', emojiId: '128512' }]);
  });

  test('单个动作失败时记录警告并继续后续动作', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reactions: Array<Parameters<QqBotClientPort['reactToMessage']>[0]> = [];
    const executor = new QqReplyActionExecutor(
      createTestBotClient({
        reactions,
        async sendMessageSegments() {
          throw new Error('NapCat暂不可用');
        },
      }),
    );

    await executor.executeReply(createChatEvent(), undefined, [
      { type: 'send_face', faceId: '66' },
      { type: 'react_to_message', emojiId: '128512' },
    ]);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('QQ动作执行失败'));
    expect(reactions).toEqual([{ messageExternalId: 'message-1', emojiId: '128512' }]);
  });
});

function createChatEvent(): ChatEventContract {
  return {
    id: 'chat-event-1' as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: 'qq:conversation:123456' as ConversationId,
    conversationType: 'group',
    senderId: 'qq:participant:20000' as ParticipantId,
    senderDisplayName: '测试用户',
    message: {
      id: 'message-1' as MessageId,
      type: 'text',
      text: '你好',
      mentions: [],
    },
    receivedAt: new Date('2026-07-02T00:00:00.000Z'),
  };
}

function createTestBotClient(options: {
  readonly replies?: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]>;
  readonly segments?: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]>;
  readonly pokes?: Array<Parameters<QqBotClientPort['sendPoke']>[0]>;
  readonly reactions?: Array<Parameters<QqBotClientPort['reactToMessage']>[0]>;
  readonly sendMessageSegments?: QqBotClientPort['sendMessageSegments'];
  readonly sendPoke?: QqBotClientPort['sendPoke'];
}): QqBotClientPort {
  return {
    async sendTextMessage(input) {
      options.replies?.push(input);
    },
    async sendMessageSegments(input) {
      if (options.sendMessageSegments) return await options.sendMessageSegments(input);
      options.segments?.push(input);
    },
    async sendPoke(input) {
      if (options.sendPoke) return await options.sendPoke(input);
      options.pokes?.push(input);
    },
    async reactToMessage(input) {
      options.reactions?.push(input);
    },
  };
}
