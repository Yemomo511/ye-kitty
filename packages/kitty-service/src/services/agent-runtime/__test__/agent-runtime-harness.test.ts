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
import type { SkillContentLoaderPort } from '../ports/skill-content-loader.port';
import type { SkillReferenceLoaderPort } from '../ports/skill-reference-loader.port';
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

  test('Skill调用请求会在下一轮注入正文', async () => {
    const observations: AgentObservation[] = [];
    const loadSkillContent = vi.fn(async () => ({
      metadata: {
        name: 'qq-chat',
        description: '用于 QQ 群聊回复',
        rootPath: '/tmp/skills/qq-chat',
        allowedTools: ['get_recent_messages'],
      },
      body: '保持自然。',
    }));
    const harness = createHarness(
      {
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
      },
      { loadSkillContent },
    );

    const result = await harness.run({
      event: createChatEvent('Skill测试'),
      availableSkills: [
        {
          name: 'qq-chat',
          description: '用于 QQ 群聊回复',
          rootPath: '/tmp/skills/qq-chat',
          allowedTools: ['get_recent_messages'],
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
    expect(observations[0]?.promptState.phase).toBe('initial_observe');
    expect(observations[1]?.promptState.phase).toBe('skill_loaded');
    expect(observations[1]?.promptState.context.enabledSkillNames).toEqual(['qq-chat']);
    expect(observations[1]?.promptState.decisionHistory[0]).toMatchObject({
      decisionType: 'skill_call',
      target: 'qq-chat',
      success: true,
    });
    expect(observations[0]?.availableSkills[0]?.name).toBe('qq-chat');
    expect(observations[0]?.enabledSkills).toEqual([]);
    expect(observations[1]?.enabledSkills[0]?.body).toBe('保持自然。');
    expect(observations[1]?.conversationMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'skill_content',
          skill: expect.objectContaining({ body: '保持自然。' }),
        }),
      ]),
    );
    expect(observations[1]?.toolResults[0]?.observation).toContain(
      '正文将在下一轮模型上下文中生效',
    );
    expect(loadSkillContent).toHaveBeenCalledTimes(1);
  });

  test('不可用Skill请求不会读取正文', async () => {
    const loadSkillContent = vi.fn(async () => ({
      metadata: {
        name: 'missing-skill',
        description: '不应读取',
        rootPath: '/tmp/skills/missing-skill',
      },
      body: '不应注入。',
    }));
    const observations: AgentObservation[] = [];
    const harness = createHarness(
      {
        async decide(observation) {
          observations.push(observation);
          if (observation.turnIndex === 1) {
            return {
              type: 'skill_call',
              skillName: 'missing-skill',
              input: {},
              reason: '尝试不存在Skill',
            };
          }

          return {
            type: 'human_review',
            reason: 'Skill不可用',
          };
        },
      },
      { loadSkillContent },
    );

    const result = await harness.run({
      event: createChatEvent('不可用Skill测试'),
      availableSkills: [
        {
          name: 'qq-chat',
          description: '用于 QQ 群聊回复',
          rootPath: '/tmp/skills/qq-chat',
        },
      ],
    });

    expect(result).toMatchObject({ type: 'human_review' });
    expect(loadSkillContent).not.toHaveBeenCalled();
    expect(observations[1]?.toolResults[0]).toMatchObject({
      toolName: 'skill_call:missing-skill',
      success: false,
    });
  });

  test('重复请求已启用Skill不会重复加载正文', async () => {
    const loadSkillContent = vi.fn(async () => ({
      metadata: {
        name: 'qq-chat',
        description: '用于 QQ 群聊回复',
        rootPath: '/tmp/skills/qq-chat',
      },
      body: '保持自然。',
    }));
    const harness = createHarness(
      {
        async decide(observation) {
          if (observation.turnIndex < 3) {
            return {
              type: 'skill_call',
              skillName: 'qq-chat',
              input: {},
              reason: '重复确认Skill',
            };
          }

          return {
            type: 'reply',
            text: '不会重复加载。',
            reason: '已确认',
          };
        },
      },
      { loadSkillContent },
    );

    const result = await harness.run({
      event: createChatEvent('重复Skill测试'),
      availableSkills: [
        {
          name: 'qq-chat',
          description: '用于 QQ 群聊回复',
          rootPath: '/tmp/skills/qq-chat',
        },
      ],
    });

    expect(result).toMatchObject({ type: 'reply', text: '不会重复加载。' });
    expect(loadSkillContent).toHaveBeenCalledTimes(1);
  });

  test('Skill加载失败会进入下一轮观察并允许恢复', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = createHarness(
      {
        async decide(observation) {
          if (observation.turnIndex === 1) {
            return {
              type: 'skill_call',
              skillName: 'qq-chat',
              input: {},
              reason: '需要Skill正文',
            };
          }

          return {
            type: 'reply',
            text: 'Skill失败后改为直接回复。',
            reason: '已收到失败观察',
          };
        },
      },
      {
        async loadSkillContent() {
          throw new Error('SKILL.md不可读');
        },
      },
    );

    const result = await harness.run({
      event: createChatEvent('Skill失败测试'),
      availableSkills: [
        {
          name: 'qq-chat',
          description: '用于 QQ 群聊回复',
          rootPath: '/tmp/skills/qq-chat',
        },
      ],
    });

    expect(result).toMatchObject({
      type: 'reply',
      text: 'Skill失败后改为直接回复。',
    });
  });

  test('未启用Skill时不能读取references', async () => {
    const loadSkillReference = vi.fn(async () => ({
      skill: {
        name: 'chat-style',
        description: '聊天风格',
        rootPath: '/tmp/skills/chat-style',
      },
      referencePath: 'examples.md',
      absolutePath: '/tmp/skills/chat-style/references/examples.md',
      content: '不应读取。',
    }));
    const observations: AgentObservation[] = [];
    const harness = createHarness(
      {
        async decide(observation) {
          observations.push(observation);
          if (observation.turnIndex === 1) {
            return {
              type: 'skill_reference_call',
              skillName: 'chat-style',
              referencePath: 'examples.md',
              reason: '尝试读取引用',
            };
          }

          return { type: 'human_review', reason: '引用不可用' };
        },
      },
      createSkillContentLoader(),
      { loadSkillReference },
    );

    const result = await harness.run({
      event: createChatEvent('引用测试'),
      availableSkills: [
        {
          name: 'chat-style',
          description: '聊天风格',
          rootPath: '/tmp/skills/chat-style',
        },
      ],
    });

    expect(result).toMatchObject({ type: 'human_review' });
    expect(loadSkillReference).not.toHaveBeenCalled();
    expect(observations[1]?.toolResults[0]).toMatchObject({
      toolName: 'skill_reference_call:chat-style',
      success: false,
      errorMessage: 'Skill未启用',
    });
  });

  test('已启用Skill后可以按需读取references', async () => {
    const observations: AgentObservation[] = [];
    const loadSkillReference = vi.fn(async () => ({
      skill: {
        name: 'chat-style',
        description: '聊天风格',
        rootPath: '/tmp/skills/chat-style',
      },
      referencePath: 'examples.md',
      absolutePath: '/tmp/skills/chat-style/references/examples.md',
      content: '示例：短句回复。',
    }));
    const harness = createHarness(
      {
        async decide(observation) {
          observations.push(observation);
          if (observation.turnIndex === 1) {
            return {
              type: 'skill_call',
              skillName: 'chat-style',
              input: {},
              reason: '需要聊天风格',
            };
          }

          if (observation.turnIndex === 2) {
            return {
              type: 'skill_reference_call',
              skillName: 'chat-style',
              referencePath: 'examples.md',
              reason: '需要示例',
            };
          }

          return { type: 'reply', text: '我会短句回复。', reason: '引用已读取' };
        },
      },
      createSkillContentLoader(),
      { loadSkillReference },
    );

    const result = await harness.run({
      event: createChatEvent('引用成功测试'),
      availableSkills: [
        {
          name: 'chat-style',
          description: '聊天风格',
          rootPath: '/tmp/skills/chat-style',
        },
      ],
    });

    expect(result).toMatchObject({ type: 'reply', text: '我会短句回复。' });
    expect(loadSkillReference).toHaveBeenCalledTimes(1);
    expect(observations[2]?.conversationMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'skill_reference',
          reference: expect.objectContaining({ content: '示例：短句回复。' }),
        }),
      ]),
    );
    expect(observations[1]?.promptState.phase).toBe('skill_loaded');
    expect(observations[2]?.promptState.phase).toBe('reference_loaded');
    expect(observations[2]?.promptState.context.loadedReferenceKeys).toEqual([
      'chat-style:examples.md',
    ]);
    expect(observations[2]?.promptState.budget.skillReferenceCount).toBe(1);
  });

  test('重复读取同一reference不会重复加载', async () => {
    const loadSkillReference = vi.fn(async () => ({
      skill: {
        name: 'chat-style',
        description: '聊天风格',
        rootPath: '/tmp/skills/chat-style',
      },
      referencePath: 'examples.md',
      absolutePath: '/tmp/skills/chat-style/references/examples.md',
      content: '示例。',
    }));
    const harness = createHarness(
      {
        async decide(observation) {
          if (observation.turnIndex === 1) {
            return { type: 'skill_call', skillName: 'chat-style', input: {}, reason: '启用' };
          }

          if (observation.turnIndex < 4) {
            return {
              type: 'skill_reference_call',
              skillName: 'chat-style',
              referencePath: 'examples.md',
              reason: '重复读取',
            };
          }

          return { type: 'reply', text: '已完成', reason: '引用已存在' };
        },
      },
      createSkillContentLoader(),
      { loadSkillReference },
    );

    await harness.run({
      event: createChatEvent('重复引用测试'),
      availableSkills: [
        {
          name: 'chat-style',
          description: '聊天风格',
          rootPath: '/tmp/skills/chat-style',
        },
      ],
    });

    expect(loadSkillReference).toHaveBeenCalledTimes(1);
  });

  test('reference读取超过上限时拒绝', async () => {
    const loadSkillReference = vi.fn(async (_skill, referencePath) => ({
      skill: {
        name: 'chat-style',
        description: '聊天风格',
        rootPath: '/tmp/skills/chat-style',
      },
      referencePath,
      absolutePath: `/tmp/skills/chat-style/references/${referencePath}`,
      content: '示例。',
    }));
    const observations: AgentObservation[] = [];
    const harness = createHarness(
      {
        async decide(observation) {
          observations.push(observation);
          if (observation.turnIndex === 1) {
            return { type: 'skill_call', skillName: 'chat-style', input: {}, reason: '启用' };
          }

          if (observation.turnIndex <= 5) {
            return {
              type: 'skill_reference_call',
              skillName: 'chat-style',
              referencePath: `examples-${observation.turnIndex}.md`,
              reason: '读取多个引用',
            };
          }

          return { type: 'reply', text: '已停止', reason: '达到上限' };
        },
      },
      createSkillContentLoader(),
      { loadSkillReference },
    );

    await harness.run({
      event: createChatEvent('引用上限测试'),
      availableSkills: [
        {
          name: 'chat-style',
          description: '聊天风格',
          rootPath: '/tmp/skills/chat-style',
        },
      ],
    });

    expect(loadSkillReference).toHaveBeenCalledTimes(3);
    expect(observations[5]?.toolResults.at(-1)).toMatchObject({
      success: false,
      errorMessage: 'Skill引用读取超限',
    });
    expect(observations[5]?.promptState.phase).toBe('ready_to_decide');
    expect(observations[5]?.promptState.budget.skillReferenceCount).toBe(3);
  });

  test('Prompt状态会记录工具观察阶段和决策历史', async () => {
    const observations: AgentObservation[] = [];
    const harness = createHarness({
      async decide(observation) {
        observations.push(observation);
        if (observation.turnIndex === 1) {
          return {
            type: 'tool_call',
            toolName: 'get_recent_messages',
            input: {},
            reason: '需要最近消息',
          };
        }

        return {
          type: 'ignore',
          reason: '工具观察后判断不需要参与',
        };
      },
    });

    await harness.run({ event: createChatEvent('状态测试') });

    expect(observations[0]?.promptState.phase).toBe('initial_observe');
    expect(observations[1]?.promptState.phase).toBe('tool_observing');
    expect(observations[1]?.promptState.budget.toolCallCount).toBe(1);
    expect(observations[1]?.promptState.context.latestObservation).toContain('最近 1 条消息');
    expect(observations[1]?.promptState.decisionHistory[0]).toMatchObject({
      decisionType: 'tool_call',
      target: 'get_recent_messages',
      success: true,
    });
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

  test('最近消息工具在私聊读取100条消息', async () => {
    const history = new InMemoryConversationHistory();
    const executor = new BuiltinRuntimeToolExecutor(history);
    const events = createSequentialChatEvents('qq:conversation:private', 'private', 120);
    events.forEach((event) => history.recordMessage(event));

    const result = await executor.execute({
      event: events[119]!,
      toolName: 'get_recent_messages',
      input: { limit: 5 },
    });
    const structuredData = toStructuredMessages(result.structuredData);

    expect(structuredData).toHaveLength(100);
    expect(structuredData[0]).toMatchObject({ text: '消息21' });
    expect(structuredData.at(-1)).toMatchObject({ text: '消息120' });
  });

  test('最近消息工具在群聊读取50条消息', async () => {
    const history = new InMemoryConversationHistory();
    const executor = new BuiltinRuntimeToolExecutor(history);
    const events = createSequentialChatEvents('qq:conversation:group', 'group', 120);
    events.forEach((event) => history.recordMessage(event));

    const result = await executor.execute({
      event: events[119]!,
      toolName: 'get_recent_messages',
      input: { limit: 100 },
    });
    const structuredData = toStructuredMessages(result.structuredData);

    expect(structuredData).toHaveLength(50);
    expect(structuredData[0]).toMatchObject({ text: '消息71' });
    expect(structuredData.at(-1)).toMatchObject({ text: '消息120' });
  });
});

function createHarness(
  runner: AgentRunnerPort,
  skillContentLoader: SkillContentLoaderPort | undefined = createSkillContentLoader(),
  skillReferenceLoader: SkillReferenceLoaderPort | undefined = createSkillReferenceLoader(),
): AgentRuntimeHarness {
  const history = new InMemoryConversationHistory();
  return new AgentRuntimeHarness(
    runner,
    new BuiltinRuntimeToolRegistry(),
    new BuiltinRuntimeToolExecutor(history),
    history,
    skillContentLoader,
    skillReferenceLoader,
    createFallbackAgent(),
    {
      maxTurns: 6,
      maxToolCalls: 3,
      maxSkillReferences: 3,
    },
  );
}

function createSkillContentLoader(): SkillContentLoaderPort {
  return {
    async loadSkillContent(skillName) {
      return {
        metadata: {
          name: skillName,
          description: '测试Skill',
          rootPath: `/tmp/skills/${skillName}`,
        },
        body: '测试正文。',
      };
    },
  };
}

function createSkillReferenceLoader(): SkillReferenceLoaderPort {
  return {
    async loadSkillReference(skill, referencePath) {
      return {
        skill: skill.metadata,
        referencePath,
        absolutePath: `${skill.metadata.rootPath}/references/${referencePath}`,
        content: '测试引用。',
      };
    },
  };
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
  conversationType: ChatEventContract['conversationType'] = 'group',
): ChatEventContract {
  return {
    id: `chat-event-${text}` as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: conversationId as ConversationId,
    conversationType,
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

function createSequentialChatEvents(
  conversationId: string,
  conversationType: ChatEventContract['conversationType'],
  count: number,
): ChatEventContract[] {
  return Array.from({ length: count }, (_, index) =>
    createChatEvent(`消息${index + 1}`, conversationId, conversationType),
  );
}

function toStructuredMessages(value: unknown): Array<Record<string, string>> {
  expect(Array.isArray(value)).toBe(true);
  return value as Array<Record<string, string>>;
}
