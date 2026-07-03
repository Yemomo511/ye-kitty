import { afterEach, describe, expect, test, vi } from 'vitest';
import { QqReplyEventSubscriber } from '../application/qq-reply-event-subscriber';
import { FallbackQqReplyAgent } from '../application/fallback-qq-reply.agent';
import { SafeQqReplyAgent } from '../application/safe-qq-reply.agent';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { EventBusPort, EventEnvelope, EventHandler } from '@kitty/shared/types/event-bus';
import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
} from '@kitty/shared/types/ids';
import type { QqBotClientPort } from '@kitty/platforms/qq/ports/qq-bot-client.port';
import type { QqReplyAgentInput, QqReplyAgentPort } from '../ports/qq-reply-agent.port';

describe('QqReplyEventSubscriber', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('订阅QQ消息后调用Agent并发送回复', async () => {
    const eventBus = new FakeEventBus();
    const agentInputs: QqReplyAgentInput[] = [];
    const replies: Array<Parameters<QqBotClientPort['sendTextMessage']>[0]> = [];
    const subscriber = new QqReplyEventSubscriber(
      eventBus,
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
    );

    await subscriber.start();
    await eventBus.publish(createEnvelope(createChatEvent()));

    expect(agentInputs).toHaveLength(1);
    expect(agentInputs[0]?.event).toMatchObject({
      conversationType: 'group',
      senderId: 'qq:participant:20000',
      senderDisplayName: '测试用户',
      message: { text: '你好' },
    });
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
      new FakeEventBus(),
      {
        async sendTextMessage(input) {
          replies.push(input);
        },
      },
      new SafeQqReplyAgent(failedAgent, new FallbackQqReplyAgent()),
    );

    await subscriber.handleEvent(createEnvelope(createChatEvent({ text: '模型失败后的消息' })));

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
      new FakeEventBus(),
      {
        async sendTextMessage(input) {
          replies.push(input);
        },
      },
      replyAgent,
    );

    await subscriber.handleEvent({
      eventId: 'event-other',
      eventType: 'message.received',
      occurredAt: new Date('2026-07-02T00:00:00.000Z'),
      payload: { platform: 'feishu', eventType: 'message.received' },
    });
    await subscriber.handleEvent(createEnvelope(createChatEvent({ text: '   ' })));

    expect(replies).toEqual([]);
  });
});

class FakeEventBus implements EventBusPort {
  private handlers: Array<EventHandler<unknown>> = [];

  async publish<TEvent>(event: TEvent): Promise<void> {
    for (const handler of this.handlers) {
      await handler(event);
    }
  }

  async subscribe<TEvent>(handler: EventHandler<TEvent>): Promise<void> {
    this.handlers.push(handler as EventHandler<unknown>);
  }
}

function createEnvelope(event: ChatEventContract): EventEnvelope<ChatEventContract> {
  return {
    eventId: event.id,
    eventType: event.eventType,
    occurredAt: event.receivedAt,
    payload: event,
  };
}

function createChatEvent(options: { readonly text?: string } = {}): ChatEventContract {
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
      text: options.text ?? '你好',
      mentions: [],
    },
    receivedAt: new Date('2026-07-02T00:00:00.000Z'),
  };
}
