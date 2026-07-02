import { afterEach, describe, expect, test, vi } from 'vitest';
import { FallbackQqReplyAgent } from '../application/fallback-qq-reply.agent';
import { SafeQqReplyAgent } from '../application/safe-qq-reply.agent';
import { createQqReplyAgent, loadQqReplyAgentConfig } from '../application/qq-reply-agent.factory';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { QqReplyAgentPort } from '../ports/qq-reply-agent.port';
import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
} from '@kitty/shared/types/ids';

describe('QQ回复Agent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('fallback Agent返回默认回复', async () => {
    const agent = new FallbackQqReplyAgent();

    await expect(agent.generateReply({ event: createChatEvent('你好') })).resolves.toEqual({
      text: '叶猫猫收到：你好',
    });
  });

  test('safe Agent在真实Agent失败时回落默认回复', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failedAgent: QqReplyAgentPort = {
      async generateReply() {
        throw new Error('模型不可用');
      },
    };
    const safeAgent = new SafeQqReplyAgent(failedAgent, new FallbackQqReplyAgent());

    await expect(safeAgent.generateReply({ event: createChatEvent('降级测试') })).resolves.toEqual({
      text: '叶猫猫收到：降级测试',
    });
  });

  test('无OPENAI_API_KEY时使用fallback配置', () => {
    const config = loadQqReplyAgentConfig({
      YE_KITTY_AGENT_REPLY_TIMEOUT_MS: '15000',
    });
    const agent = createQqReplyAgent(config);

    expect(config).toEqual({
      openAiApiKey: undefined,
      agentModel: 'gpt-4.1-mini',
      agentName: '叶猫猫',
      replyTimeoutMs: 15000,
    });
    expect(agent).toBeInstanceOf(FallbackQqReplyAgent);
  });

  test('有OPENAI_API_KEY时使用OpenAI Agent包装配置', () => {
    const config = loadQqReplyAgentConfig({
      OPENAI_API_KEY: 'sk-test',
      YE_KITTY_AGENT_MODEL: 'gpt-4.1-mini',
      YE_KITTY_AGENT_NAME: '测试叶猫猫',
      YE_KITTY_AGENT_REPLY_TIMEOUT_MS: '20000',
    });
    const agent = createQqReplyAgent(config);

    expect(config).toEqual({
      openAiApiKey: 'sk-test',
      agentModel: 'gpt-4.1-mini',
      agentName: '测试叶猫猫',
      replyTimeoutMs: 20000,
    });
    expect(agent).toBeInstanceOf(SafeQqReplyAgent);
  });
});

function createChatEvent(text: string): ChatEventContract {
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
      text,
      mentions: [],
    },
    receivedAt: new Date('2026-07-02T00:00:00.000Z'),
  };
}
