import { RunContext } from '@openai/agents';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { formatSdkToolError, materializeTool } from '../materialize';
import { Tool, type ToolRuntimeContext } from '../tool';

describe('官方FunctionTool投影', () => {
  test('只投影模型定义并使用SDK真实callId执行', async () => {
    const execute = vi.fn(async (input: { text: string }) => ({
      success: true as const,
      summary: `结果：${input.text}`,
      data: { token: '不能进入模型', value: input.text },
    }));
    const tool = Tool.make({
      description: '回显文本',
      parameters: z.object({ text: z.string() }).strict(),
      policy: {
        source: 'builtin',
        risk: 'low',
        approval: 'never',
        timeoutMs: 1000,
      },
      execute,
    });
    const runtimeContext = createContext();
    const projected = materializeTool('echo', tool);

    const output = await projected.invoke(
      new RunContext(runtimeContext),
      JSON.stringify({ text: '你好' }),
      {
        toolCall: {
          type: 'function_call',
          name: 'echo',
          callId: 'sdk-call-9',
          arguments: '{"text":"你好"}',
        },
      },
    );

    expect(projected).toMatchObject({
      type: 'function',
      name: 'echo',
      description: '回显文本',
      strict: true,
    });
    expect(runtimeContext.recordedCallIds).toEqual(['sdk-call-9']);
    expect(output).toEqual({
      status: 'success',
      summary: '结果：你好',
      data: { token: '[已脱敏]', value: '你好' },
    });
  });

  test('需要审批的工具由SDK暂停且不会提前执行', async () => {
    const execute = vi.fn();
    const tool = Tool.make({
      description: '写入远端',
      parameters: z.object({ value: z.string() }).strict(),
      policy: {
        source: 'mcp',
        risk: 'high',
        approval: 'required',
        timeoutMs: 1000,
      },
      execute,
    });
    const projected = materializeTool('remote_write', tool);

    await expect(
      projected.needsApproval(
        new RunContext(createContext()),
        JSON.stringify({ value: 'x' }),
        'sdk-call-1',
      ),
    ).resolves.toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  test('系统错误转换为稳定的模型可见结果', async () => {
    const tool = Tool.make({
      description: '失败工具',
      parameters: z.object({}).strict(),
      policy: {
        source: 'builtin',
        risk: 'low',
        approval: 'never',
        timeoutMs: 1000,
      },
      execute: async () => {
        throw new Error('内部地址 https://private.example token=secret');
      },
    });
    const projected = materializeTool('failure', tool);

    const output = await projected.invoke(new RunContext(createContext()), '{}', {
      toolCall: {
        type: 'function_call',
        name: 'failure',
        callId: 'sdk-call-2',
        arguments: '{}',
      },
    });

    expect(output).toEqual({
      status: 'error',
      summary: '工具执行失败，请根据当前信息调整方案。',
      retryable: false,
    });
  });

  test('原始JSON Schema以非严格模式投影并继续执行', async () => {
    const tool = Tool.make({
      description: '读取远端数据',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      strict: false,
      policy: {
        source: 'mcp',
        risk: 'low',
        approval: 'never',
        timeoutMs: 1000,
      },
      execute: async (input) => ({
        success: true,
        summary: String((input as { query: string }).query),
      }),
    });
    const projected = materializeTool('remote_read', tool);

    const output = await projected.invoke(
      new RunContext(createContext()),
      JSON.stringify({ query: '文档' }),
      {
        toolCall: {
          type: 'function_call',
          name: 'remote_read',
          callId: 'sdk-call-3',
          arguments: '{"query":"文档"}',
        },
      },
    );

    expect(projected.strict).toBe(false);
    expect(output).toMatchObject({ status: 'success', summary: '文档' });
  });

  test('缺少SDK上下文或callId时拒绝执行', async () => {
    const execute = vi.fn();
    const projected = materializeTool(
      'incomplete',
      Tool.make({
        description: '上下文测试',
        parameters: z.object({}).strict(),
        policy: {
          source: 'builtin',
          risk: 'low',
          approval: 'never',
          timeoutMs: 1000,
        },
        execute,
      }),
    );

    const output = await projected.invoke(undefined as never, '{}', {
      toolCall: {
        type: 'function_call',
        name: 'incomplete',
        callId: '',
        arguments: '{}',
      },
    });

    expect(output).toMatchObject({ status: 'error', retryable: false });
    expect(execute).not.toHaveBeenCalled();
    expect(formatSdkToolError()).toBe('工具执行失败，请根据当前信息调整方案。');
  });
});

function createContext(): ToolRuntimeContext & { readonly recordedCallIds: string[] } {
  const settlements = new Map<string, unknown>();
  const recordedCallIds: string[] = [];
  return {
    runId: 'run-1',
    traceId: 'trace-1',
    callId: 'placeholder',
    agentName: '叶猫猫',
    signal: new AbortController().signal,
    authorize: async () => ({ status: 'allowed' }),
    getSettlement: (callId) => settlements.get(callId) as never,
    recordSettlement: (settlement) => {
      recordedCallIds.push(settlement.audit.callId);
      settlements.set(settlement.audit.callId, settlement);
    },
    applyEffects: vi.fn(),
    recordedCallIds,
  };
}
