import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  AgentRuntimeHarness,
  HarnessQqReplyAgentAdapter,
} from '../application/agent-runtime-harness';
import { InMemoryConversationHistory } from '../application/in-memory-conversation-history';
import {
  BuiltinRuntimeToolExecutor,
  BuiltinRuntimeToolRegistry,
} from '../application/runtime-tools';
import type { AgentObservation } from '../domain/agent-observation';
import type { AgentRunnerPort } from '../ports/agent-runner.port';
import type { QqReplyAgentPort } from '../ports/qq-reply-agent.port';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
} from '@kitty/shared/types/ids';

describe('AgentRuntimeHarness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('模型先调用最近消息工具，再根据工具观察输出回复', async () => {
    const observations: AgentObservation[] = [];
    const harness = createHarness({
      async decide(observation) {
        observations.push(observation);
        if (observation.turnIndex === 1) {
          return {
            type: 'tool_call',
            toolName: 'get_recent_messages',
            input: { limit: 3 },
            reason: '需要上下文',
          };
        }

        return {
          type: 'reply',
          text: '看到了上下文，我来接一句。',
          reason: '上下文足够',
        };
      },
    });

    const result = await harness.run({ event: createChatEvent('你好') });

    expect(result).toMatchObject({
      type: 'reply',
      text: '看到了上下文，我来接一句。',
    });
    expect(observations).toHaveLength(2);
    expect(observations[1]?.toolResults[0]?.observation).toContain('最近 1 条消息');
  });

  test('工具调用超过预算时降级到fallback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = createHarness({
      async decide() {
        return {
          type: 'tool_call',
          toolName: 'get_recent_messages',
          input: {},
          reason: '持续请求工具',
        };
      },
    });

    const result = await harness.run({ event: createChatEvent('预算测试') });

    expect(result).toMatchObject({
      type: 'reply',
      text: 'fallback:预算测试',
    });
  });

  test('Runner异常会进入下一轮观察并允许恢复', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let called = false;
    const harness = createHarness({
      async decide() {
        if (!called) {
          called = true;
          throw new Error('非法 JSON');
        }

        return {
          type: 'reply',
          text: '恢复成功',
          reason: '已重新输出',
        };
      },
    });

    const result = await harness.run({ event: createChatEvent('恢复测试') });

    expect(result).toMatchObject({
      type: 'reply',
      text: '恢复成功',
    });
  });

  test('Skill调用请求会转成下一轮观察', async () => {
    const observations: AgentObservation[] = [];
    const harness = createHarness({
      async decide(observation) {
        observations.push(observation);
        if (observation.turnIndex === 1) {
          return {
            type: 'skill_call',
            skillName: 'qq-chat',
            input: { goal: '判断是否参与群聊' },
            reason: '需要群聊方法论',
          };
        }

        return {
          type: 'reply',
          text: '我会按群聊方法论来回。',
          reason: 'Skill状态已确认',
        };
      },
    });

    const result = await harness.run({
      event: createChatEvent('Skill测试'),
      skills: [
        {
          metadata: {
            name: 'qq-chat',
            description: '用于 QQ 群聊回复',
            rootPath: '/tmp/skills/qq-chat',
            allowedTools: ['get_recent_messages'],
          },
          body: '保持自然。',
        },
      ],
    });

    expect(result).toMatchObject({
      type: 'reply',
      text: '我会按群聊方法论来回。',
    });
    expect(observations[1]?.toolResults[0]).toMatchObject({
      toolName: 'skill_call:qq-chat',
      success: true,
    });
    expect(observations[1]?.toolResults[0]?.observation).toContain('Skill qq-chat 已在本轮启用');
  });

  test('ignore和human_review通过旧端口适配为空动作', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const ignoreAgent = new HarnessQqReplyAgentAdapter(
      createHarness({
        async decide() {
          return { type: 'ignore', reason: '不需要参与' };
        },
      }),
    );
    const reviewAgent = new HarnessQqReplyAgentAdapter(
      createHarness({
        async decide() {
          return { type: 'human_review', reason: '需要人看一眼' };
        },
      }),
    );

    await expect(ignoreAgent.generateReply({ event: createChatEvent('静默') })).resolves.toEqual(
      {},
    );
    await expect(reviewAgent.generateReply({ event: createChatEvent('审核') })).resolves.toEqual(
      {},
    );
  });

  test('最近消息工具按会话隔离', async () => {
    const history = new InMemoryConversationHistory();
    const executor = new BuiltinRuntimeToolExecutor(history);
    const eventA = createChatEvent('A消息', 'qq:conversation:a');
    const eventB = createChatEvent('B消息', 'qq:conversation:b');
    history.recordMessage(eventA);
    history.recordMessage(eventB);

    const result = await executor.execute({
      event: eventA,
      toolName: 'get_recent_messages',
      input: { limit: 5 },
    });

    expect(result).toMatchObject({
      success: true,
      observation: expect.stringContaining('A消息'),
    });
    expect(result.observation).not.toContain('B消息');
  });
});

function createHarness(runner: AgentRunnerPort): AgentRuntimeHarness {
  const history = new InMemoryConversationHistory();
  return new AgentRuntimeHarness(
    runner,
    new BuiltinRuntimeToolRegistry(),
    new BuiltinRuntimeToolExecutor(history),
    history,
    createFallbackAgent(),
    {
      maxTurns: 4,
      maxToolCalls: 3,
    },
  );
}

function createFallbackAgent(): QqReplyAgentPort {
  return {
    async generateReply(input) {
      return { text: `fallback:${input.event.message.text}` };
    },
  };
}

function createChatEvent(
  text: string,
  conversationId: string = 'qq:conversation:123456',
): ChatEventContract {
  return {
    id: `chat-event-${text}` as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: conversationId as ConversationId,
    conversationType: 'group',
    senderId: 'qq:participant:20000' as ParticipantId,
    senderDisplayName: '测试用户',
    message: {
      id: `message-${text}` as MessageId,
      type: 'text',
      text,
      mentions: [],
    },
    receivedAt: new Date('2026-07-02T00:00:00.000Z'),
  };
}
