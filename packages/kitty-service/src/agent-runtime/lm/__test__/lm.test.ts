import { Usage, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import type { PlatformMessage } from '@kitty/platforms/message';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';
import { describe, expect, test, vi } from 'vitest';
import { AgentRunState } from '../../state';
import { createFinishTool } from '../../tools/finish';
import { materializeTool } from '../../tools/materialize';
import { Tool } from '../../tools/tool';
import { LM } from '../lm';

describe('LM官方Runner集成', () => {
  test('Runner读取原生function_call、执行finish并结束循环', async () => {
    const state = createState();
    state.bindToolSnapshot(['finish']);
    const requests: ModelRequest[] = [];
    const model = createModel(async (request) => {
      requests.push(request);
      return createFunctionCallResponse('finish', 'sdk-finish-1', {
        result: 'reply',
        text: '官方循环完成',
        reason: '信息充分',
      });
    });
    const lm = new LM({ agentName: '叶猫猫', timeoutMs: 1000 }, { acquireModel: () => model });

    const result = await lm.run({
      context: state.createToolContext(new AbortController().signal),
      input: '请回复',
      instructions: () => '必须使用finish结束。',
      tools: [materializeTool('finish', createFinishTool(state))],
      maxTurns: 3,
      priority: 'normal',
    });

    expect(result.interruptions).toEqual([]);
    expect(state.terminal).toMatchObject({ type: 'reply', text: '官方循环完成' });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0]?.tools)).not.toContain('approval');
    expect(JSON.stringify(requests[0]?.tools)).not.toContain('timeoutMs');
  });

  test('需要审批的FunctionTool由Runner暂停且不执行实现', async () => {
    const state = createState();
    state.bindToolSnapshot(['remote_write']);
    const execute = vi.fn();
    const tool = Tool.make({
      description: '写入远端',
      parameters: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
      policy: {
        source: 'mcp',
        risk: 'high',
        approval: 'required',
        timeoutMs: 1000,
      },
      execute,
    });
    const model = createModel(async () =>
      createFunctionCallResponse('remote_write', 'sdk-write-1', { value: 'x' }),
    );
    const lm = new LM({ agentName: '叶猫猫', timeoutMs: 1000 }, { acquireModel: () => model });

    const result = await lm.run({
      context: state.createToolContext(new AbortController().signal),
      input: '写入',
      instructions: () => '按需调用工具。',
      tools: [materializeTool('remote_write', tool)],
      maxTurns: 3,
      priority: 'normal',
    });

    expect(result.interruptions).toEqual([{ toolName: 'remote_write', callId: 'sdk-write-1' }]);
    expect(result.state).toBeDefined();
    expect(execute).not.toHaveBeenCalled();
  });
});

function createModel(getResponse: (request: ModelRequest) => Promise<ModelResponse>): Model {
  return {
    getResponse,
    getStreamedResponse: () => emptyStream(),
  };
}

// 构造测试所需的空流。
async function* emptyStream(): AsyncIterable<never> {
  yield* [];
}

function createFunctionCallResponse(name: string, callId: string, input: unknown): ModelResponse {
  return {
    usage: new Usage(),
    output: [
      {
        type: 'function_call',
        name,
        callId,
        status: 'completed',
        arguments: JSON.stringify(input),
      },
    ],
  };
}

function createState(): AgentRunState {
  return new AgentRunState({
    runId: 'run-1',
    traceId: 'trace-1',
    agentName: '叶猫猫',
    event: createMessage(),
    availableSkills: [],
    enabledSkills: [],
    replyIntent: 'normal',
    maxToolCalls: 3,
    maxSkillReferences: 3,
  });
}

function createMessage(): PlatformMessage {
  return {
    id: 'event-1' as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: 'private-1' as ConversationId,
    conversationType: 'private',
    senderId: 'user-1' as ParticipantId,
    message: {
      id: 'message-1' as MessageId,
      type: 'text',
      text: '你好',
      mentions: [],
    },
    receivedAt: new Date('2026-07-23T00:00:00.000Z'),
  };
}
