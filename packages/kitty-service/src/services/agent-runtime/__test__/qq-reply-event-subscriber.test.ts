import { afterEach, describe, expect, test, vi } from 'vitest';
import { QqReplyEventSubscriber } from '../application/qq-reply-event-subscriber';
import { FallbackQqReplyAgent } from '../application/fallback-qq-reply.agent';
import { SafeQqReplyAgent } from '../application/safe-qq-reply.agent';
import { SkillRuntimeService } from '../application/skill-runtime.service';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import { PlatformMessageService } from '@kitty/platforms/shared';
import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
} from '@kitty/shared/types/ids';
import type { QqBotClientPort } from '@kitty/platforms/qq/ports/qq-bot-client.port';
import type { QqReplyAgentInput, QqReplyAgentPort } from '../ports/qq-reply-agent.port';
import type { SkillMetadata } from '../domain/skill';

describe('QqReplyEventSubscriber', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('订阅QQ消息后调用Agent并发送回复', async () => {
    const messageService = new TestQqMessageService();
    const skillMetadata = createSkillMetadata();
    const agentInputs: QqReplyAgentInput[] = [];
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const botClient = createTestBotClient({ segments });
    const subscriber = new QqReplyEventSubscriber(
      messageService,
      botClient,
      {
        async generateReply(input) {
          agentInputs.push(input);
          return { text: 'Agent回复：你好' };
        },
      },
      new SkillRuntimeService(
        [skillMetadata],
        {
          async selectSkills() {
            return [skillMetadata];
          },
        },
        {
          async loadSkillContent() {
            return {
              metadata: skillMetadata,
              body: '群聊回复短一点。',
            };
          },
        },
      ),
      { selfQqId: '10000' },
    );

    await subscriber.start();
    await messageService.publish(createChatEvent());
    await waitForAsyncSubscriber();

    expect(agentInputs).toHaveLength(1);
    expect(agentInputs[0]?.event).toMatchObject({
      conversationType: 'group',
      senderId: 'qq:participant:20000',
      senderDisplayName: '测试用户',
      message: { text: '你好' },
    });
    expect(agentInputs[0]?.availableSkills).toEqual([skillMetadata]);
    expect(agentInputs[0]?.skills).toBeUndefined();
    expect(segments).toEqual([
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        segments: [{ type: 'text', text: 'Agent回复：你好' }],
      },
    ]);
  });

  test('Agent失败时由安全Agent回落默认回复', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const botClient = createTestBotClient({ segments });
    const failedAgent: QqReplyAgentPort = {
      async generateReply() {
        throw new Error('模型不可用');
      },
    };
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      botClient,
      new SafeQqReplyAgent(failedAgent, new FallbackQqReplyAgent()),
      undefined,
      { selfQqId: '10000' },
    );

    await subscriber.handleMessage(createChatEvent({ text: '模型失败后的消息' }));

    expect(segments[0]?.segments).toEqual([{ type: 'text', text: '叶猫猫收到：模型失败后的消息' }]);
  });

  test('非QQ事件或空文本事件不触发回复', async () => {
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const botClient = createTestBotClient({ replies, segments });
    const replyAgent: QqReplyAgentPort = {
      async generateReply() {
        return { text: '不应该触发' };
      },
    };
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      botClient,
      replyAgent,
      undefined,
      { selfQqId: '10000' },
    );

    await subscriber.handleMessage(createChatEvent({ platform: 'feishu' }));
    await subscriber.handleMessage(createChatEvent({ text: '   ' }));

    expect(replies).toEqual([]);
    expect(segments).toEqual([]);
  });

  test('订阅器只传入Skill目录，不提前读取正文', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const skillMetadata = createSkillMetadata();
    const loadSkillContent = vi.fn(async () => ({
      metadata: skillMetadata,
      body: '不应该提前读取。',
    }));
    const agentInputs: QqReplyAgentInput[] = [];
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const botClient = createTestBotClient({ segments });
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      botClient,
      {
        async generateReply(input) {
          agentInputs.push(input);
          return { text: 'Skill失败也能回复' };
        },
      },
      new SkillRuntimeService(
        [skillMetadata],
        {
          async selectSkills() {
            return [skillMetadata];
          },
        },
        {
          loadSkillContent,
        },
      ),
      { selfQqId: '10000' },
    );

    await subscriber.handleMessage(createChatEvent());

    expect(agentInputs[0]?.availableSkills).toEqual([skillMetadata]);
    expect(agentInputs[0]?.skills).toBeUndefined();
    expect(loadSkillContent).not.toHaveBeenCalled();
    expect(segments[0]?.segments).toEqual([{ type: 'text', text: 'Skill失败也能回复' }]);
  });

  test('执行Agent返回的QQ互动动作', async () => {
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const pokes: Array<Parameters<QqBotClientPort['sendPoke']>[0]> = [];
    const reactions: Array<Parameters<QqBotClientPort['reactToMessage']>[0]> = [];
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      createTestBotClient({ replies, segments, pokes, reactions }),
      {
        async generateReply() {
          return {
            text: '先用文字接住你',
            actions: [
              { type: 'send_face', faceId: '66' },
              { type: 'send_custom_image', file: 'https://example.com/cat.png' },
              {
                type: 'send_market_face',
                emojiPackageId: 123,
                emojiId: 'abc123',
                key: 'market-key',
                summary: '摸摸头',
              },
              { type: 'poke_sender' },
              { type: 'react_to_message', emojiId: '128512' },
            ],
          };
        },
      },
      undefined,
      { selfQqId: '10000' },
    );

    await subscriber.handleMessage(createChatEvent());

    expect(replies).toEqual([]);
    expect(segments).toEqual([]);
    expect(pokes).toEqual([
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        userExternalId: '20000',
      },
    ]);
    expect(reactions).toEqual([]);
  });

  test('执行Agent返回的文字和QQ内置表情混排动作', async () => {
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      createTestBotClient({ segments }),
      {
        async generateReply() {
          return {
            actions: [
              {
                type: 'send_text_with_face',
                segments: [
                  { type: 'text', text: '好好好' },
                  { type: 'face', faceId: '66' },
                ],
              },
            ],
          };
        },
      },
      undefined,
      { selfQqId: '10000' },
    );

    await subscriber.handleMessage(createChatEvent());

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

  test('QQ动作执行失败时记录警告并继续后续动作', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const reactions: Array<Parameters<QqBotClientPort['reactToMessage']>[0]> = [];
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      createTestBotClient({
        replies,
        reactions,
        async sendMessageSegments() {
          throw new Error('NapCat暂不可用');
        },
      }),
      {
        async generateReply() {
          return {
            actions: [
              { type: 'send_face', faceId: '66' },
              { type: 'react_to_message', emojiId: '128512' },
            ],
          };
        },
      },
      undefined,
      { selfQqId: '10000' },
    );

    await subscriber.handleMessage(createChatEvent());

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('QQ动作执行失败'));
    expect(reactions).toEqual([{ messageExternalId: 'message-1', emojiId: '128512' }]);
  });

  test('群聊未@叶猫猫或只@其他人时不触发Agent', async () => {
    const agentInputs: QqReplyAgentInput[] = [];
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      createTestBotClient({ replies }),
      {
        async generateReply(input) {
          agentInputs.push(input);
          return { text: '不应该触发' };
        },
      },
      undefined,
      { selfQqId: '10000' },
    );

    await subscriber.handleMessage(createChatEvent({ mentions: [] }));
    await subscriber.handleMessage(createChatEvent({ mentions: ['20001'] }));

    expect(agentInputs).toEqual([]);
    expect(replies).toEqual([]);
  });

  test('私聊不需要@也会触发Agent', async () => {
    const agentInputs: QqReplyAgentInput[] = [];
    const segments: Array<Parameters<QqBotClientPort['sendMessageSegments']>[0]> = [];
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      createTestBotClient({ segments }),
      {
        async generateReply(input) {
          agentInputs.push(input);
          return { text: '私聊收到' };
        },
      },
      undefined,
      { selfQqId: '10000' },
    );

    await subscriber.handleMessage(createChatEvent({ conversationType: 'private', mentions: [] }));

    expect(agentInputs).toHaveLength(1);
    expect(segments).toEqual([
      {
        conversationExternalId: '123456',
        conversationType: 'private',
        segments: [{ type: 'text', text: '私聊收到' }],
      },
    ]);
  });
});

class TestQqMessageService extends PlatformMessageService<ChatEventContract> {
  async publish(message: ChatEventContract): Promise<void> {
    await this.publishMessage(message);
  }
}

function createChatEvent(
  options: {
    readonly text?: string;
    readonly platform?: ChatEventContract['platform'] | 'feishu';
    readonly conversationType?: ChatEventContract['conversationType'];
    readonly mentions?: readonly string[];
  } = {},
): ChatEventContract {
  return {
    id: 'chat-event-1' as ChatEventId,
    platform: (options.platform ?? 'qq') as ChatEventContract['platform'],
    eventType: 'message.received',
    conversationId: 'qq:conversation:123456' as ConversationId,
    conversationType: options.conversationType ?? 'group',
    senderId: 'qq:participant:20000' as ParticipantId,
    senderDisplayName: '测试用户',
    message: {
      id: 'message-1' as MessageId,
      type: 'text',
      text: options.text ?? '你好',
      mentions: options.mentions ?? ['10000'],
    },
    receivedAt: new Date('2026-07-02T00:00:00.000Z'),
  };
}

function createSkillMetadata(): SkillMetadata {
  return {
    name: 'qq-chat',
    description: '用于 QQ 群聊和私聊中的自然中文回复。',
    rootPath: '/tmp/skills/qq-chat',
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
    async fetchCustomFaces() {
      return [];
    },
  };
}

function waitForAsyncSubscriber(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
