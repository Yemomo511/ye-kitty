import { afterEach, describe, expect, test, vi } from 'vitest';
import { FallbackQqReplyAgent } from '../agent-runtime/lm/fallback';
import { SafeQqReplyAgent } from '../agent-runtime/safe';
import { DEFAULT_AGENT_MAX_TURNS, createQqReplyAgent, loadQqReplyAgentConfig } from './agent';
import type { PlatformMessage } from '@kitty/platforms/message';
import type { QqReplyAgentPort } from '../agent-runtime/runtime';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';

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
      openAiBaseUrl: undefined,
      agentModel: 'gpt-4.1-mini',
      agentName: '叶猫猫',
      replyTimeoutMs: 15000,
      modelPoolNodes: [],
    });
    expect(agent).toBeInstanceOf(FallbackQqReplyAgent);
  });

  test('有OPENAI_API_KEY时使用Agent包装配置', () => {
    const config = loadQqReplyAgentConfig({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://relay.example.com',
      YE_KITTY_AGENT_MODEL: 'gpt-4.1-mini',
      YE_KITTY_AGENT_NAME: '测试叶猫猫',
      YE_KITTY_AGENT_REPLY_TIMEOUT_MS: '20000',
    });
    const agent = createQqReplyAgent(config);

    expect(config).toEqual({
      openAiApiKey: 'sk-test',
      openAiBaseUrl: 'https://relay.example.com',
      agentModel: 'gpt-4.1-mini',
      agentName: '测试叶猫猫',
      replyTimeoutMs: 20000,
      modelPoolNodes: [
        {
          id: 'default-openai-agent',
          apiKey: 'sk-test',
          baseURL: 'https://relay.example.com',
          model: 'gpt-4.1-mini',
          maxConcurrency: 3,
          minIntervalMs: 2000,
          maxRetries: 3,
          backoff: {
            initialMs: 2000,
            maxMs: 60000,
            multiplier: 2,
          },
        },
      ],
    });
    expect(agent).toBeInstanceOf(SafeQqReplyAgent);
  });

  test('有YE_KITTY_MODEL_POOL时不依赖全局OPENAI_API_KEY', () => {
    const config = loadQqReplyAgentConfig({
      YE_KITTY_MODEL_POOL: JSON.stringify({
        models: [
          {
            id: 'pool-main',
            apiKey: 'sk-pool',
            baseURL: 'https://pool.example.com',
            model: 'deepseek-chat',
            maxConcurrency: 4,
            minIntervalMs: 2000,
          },
        ],
      }),
    });
    const agent = createQqReplyAgent(config);

    expect(config.modelPoolNodes).toEqual([
      {
        id: 'pool-main',
        apiKey: 'sk-pool',
        baseURL: 'https://pool.example.com',
        model: 'deepseek-chat',
        maxConcurrency: 4,
        minIntervalMs: 2000,
        maxRetries: 3,
        backoff: {
          initialMs: 2000,
          maxMs: 60000,
          multiplier: 2,
        },
      },
    ]);
    expect(agent).toBeInstanceOf(SafeQqReplyAgent);
  });

  test('Agent默认最大循环次数为100次', () => {
    expect(DEFAULT_AGENT_MAX_TURNS).toBe(100);
  });
});

function createChatEvent(text: string): PlatformMessage {
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
