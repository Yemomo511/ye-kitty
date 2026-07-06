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
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const subscriber = new QqReplyEventSubscriber(
      messageService,
      {
        async sendTextMessage(input) {
          replies.push(input);
        },
      },
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
    expect(agentInputs[0]?.skills).toEqual([
      {
        metadata: skillMetadata,
        body: '群聊回复短一点。',
      },
    ]);
    expect(replies).toEqual([
      {
        conversationExternalId: '123456',
        conversationType: 'group',
        text: 'Agent回复：你好',
      },
    ]);
  });

  test('Agent失败时由安全Agent回落默认回复', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const failedAgent: QqReplyAgentPort = {
      async generateReply() {
        throw new Error('模型不可用');
      },
    };
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      {
        async sendTextMessage(input) {
          replies.push(input);
        },
      },
      new SafeQqReplyAgent(failedAgent, new FallbackQqReplyAgent()),
    );

    await subscriber.handleMessage(createChatEvent({ text: '模型失败后的消息' }));

    expect(replies[0]?.text).toBe('叶猫猫收到：模型失败后的消息');
  });

  test('非QQ事件或空文本事件不触发回复', async () => {
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const replyAgent: QqReplyAgentPort = {
      async generateReply() {
        return { text: '不应该触发' };
      },
    };
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      {
        async sendTextMessage(input) {
          replies.push(input);
        },
      },
      replyAgent,
    );

    await subscriber.handleMessage(createChatEvent({ platform: 'feishu' }));
    await subscriber.handleMessage(createChatEvent({ text: '   ' }));

    expect(replies).toEqual([]);
  });

  test('Skill加载失败时不阻断回复并传入空Skill列表', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const skillMetadata = createSkillMetadata();
    const agentInputs: QqReplyAgentInput[] = [];
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const subscriber = new QqReplyEventSubscriber(
      new TestQqMessageService(),
      {
        async sendTextMessage(input) {
          replies.push(input);
        },
      },
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
          async loadSkillContent() {
            throw new Error('SKILL.md不可读');
          },
        },
      ),
    );

    await subscriber.handleMessage(createChatEvent());

    expect(agentInputs[0]?.skills).toEqual([]);
    expect(replies[0]?.text).toBe('Skill失败也能回复');
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
  } = {},
): ChatEventContract {
  return {
    id: 'chat-event-1' as ChatEventId,
    platform: (options.platform ?? 'qq') as ChatEventContract['platform'],
    eventType: 'message.received',
    conversationId: 'qq:conversation:123456' as ConversationId,
    conversationType: 'group',
    senderId: 'qq:participant:20000' as ParticipantId,
    senderDisplayName: '测试用户',
    message: {
      id: 'message-1' as MessageId,
      type: 'text',
      text: options.text ?? '你好',
      mentions: [],
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

function waitForAsyncSubscriber(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
