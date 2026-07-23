import { RunContext } from '@openai/agents';
import type { PlatformMessage } from '@kitty/platforms/message';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';
import { describe, expect, test, vi } from 'vitest';
import { Agent, AgentAdapter } from '../agent';
import { InMemoryConversationHistory } from '../history';
import type { LMRunner, LMRunRequest } from '../lm/lm';
import type { QqReplyAgentPort } from '../runtime';
import type { SkillRuntime } from '../skills';

describe('Agent官方工具循环编排', () => {
  test('首轮模型请求前自动注入最近消息并通过finish收敛', async () => {
    let capturedInput = '';
    const agent = createAgent({
      async run(request) {
        capturedInput = request.input;
        await invokeTool(request, 'finish', {
          result: 'reply',
          text: '看到了，我来接一句。',
          reason: '已读取上下文',
        });
        return { interruptions: [] };
      },
    });

    const result = await agent.run({ event: createMessage('你好') });

    expect(result).toMatchObject({ type: 'reply', text: '看到了，我来接一句。' });
    expect(capturedInput).toContain('最近 1 条消息');
    expect(capturedInput).not.toContain('tool_budget');
    expect(capturedInput).not.toContain('trace_id');
  });

  test('模型未调用finish时由系统执行降级', async () => {
    const fallback = createFallback();
    const agent = createAgent({ run: async () => ({ interruptions: [] }) }, fallback);

    const result = await agent.run({ event: createMessage('降级测试') });

    expect(result).toMatchObject({ type: 'reply', text: 'fallback:降级测试' });
    expect(fallback.generateReply).toHaveBeenCalledOnce();
  });

  test('SDK审批中断转换为人工复核且不伪造执行结果', async () => {
    const agent = createAgent({
      async run() {
        return {
          interruptions: [{ toolName: 'code_agent', callId: 'sdk-call-1' }],
          state: { opaque: true },
        };
      },
    });

    await expect(agent.run({ event: createMessage('写点代码') })).resolves.toMatchObject({
      type: 'human_review',
      reason: expect.stringContaining('code_agent'),
    });
  });

  test('Skill Effect由系统写入状态并更新后续动态指令', async () => {
    let instructionsAfterSkill = '';
    const skillRuntime: Pick<SkillRuntime, 'load' | 'loadReference'> = {
      load: vi.fn(async () => ({
        metadata: {
          name: 'qq-chat',
          description: 'QQ聊天方法',
          rootPath: '/tmp/not-exists',
          allowedTools: [],
        },
        body: '说话保持自然。',
      })),
      loadReference: vi.fn(),
    };
    const agent = createAgent(
      {
        async run(request) {
          await invokeTool(request, 'skill', { name: 'qq-chat' });
          instructionsAfterSkill = request.instructions(request.context);
          await invokeTool(request, 'finish', {
            result: 'reply',
            text: '自然地接话。',
            reason: '已加载方法',
          });
          return { interruptions: [] };
        },
      },
      undefined,
      skillRuntime,
    );

    await agent.run({
      event: createMessage('在吗'),
      availableSkills: [
        {
          name: 'qq-chat',
          description: 'QQ聊天方法',
          rootPath: '/tmp/not-exists',
          allowedTools: [],
        },
      ],
    });

    expect(instructionsAfterSkill).toContain('说话保持自然。');
  });

  test('AgentAdapter不会外发ignore或review', async () => {
    const adapter = new AgentAdapter({
      run: vi.fn(async () => ({
        type: 'ignore' as const,
        reason: '无需参与',
        traceId: 'trace-1',
      })),
    });

    await expect(adapter.generateReply({ event: createMessage('路过') })).resolves.toEqual({});
  });
});

function createAgent(
  lm: LMRunner,
  fallback = createFallback(),
  skillRuntime?: Pick<SkillRuntime, 'load' | 'loadReference'>,
): Agent {
  return new Agent({
    lm,
    conversationHistory: new InMemoryConversationHistory(),
    skillRuntime,
    fallbackAgent: fallback,
    agentName: '叶猫猫',
    config: {
      maxTurns: 10,
      maxToolCalls: 3,
      maxSkillReferences: 3,
    },
  });
}

function createFallback(): QqReplyAgentPort & {
  readonly generateReply: ReturnType<typeof vi.fn>;
} {
  return {
    generateReply: vi.fn(async (input) => ({ text: `fallback:${input.event.message.text}` })),
  };
}

async function invokeTool(request: LMRunRequest, name: string, input: unknown): Promise<unknown> {
  const tool = request.tools.find((item) => item.name === name);
  if (!tool) throw new Error(`测试缺少工具 ${name}`);
  return await tool.invoke(new RunContext(request.context), JSON.stringify(input), {
    toolCall: {
      type: 'function_call',
      name,
      callId: `sdk-${name}-${Math.random()}`,
      arguments: JSON.stringify(input),
    },
  });
}

function createMessage(text: string): PlatformMessage {
  return {
    id: 'event-1' as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: 'group-1' as ConversationId,
    conversationType: 'group',
    senderId: 'user-1' as ParticipantId,
    senderDisplayName: '测试用户',
    message: {
      id: 'message-1' as MessageId,
      type: 'text',
      text,
      mentions: [],
    },
    receivedAt: new Date('2026-07-23T00:00:00.000Z'),
  };
}
