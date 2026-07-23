import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../registry';
import { Tool, type ToolRuntimeContext } from '../tool';

describe('规范Tool', () => {
  test('普通对象不能伪装成可注册Tool', () => {
    const registry = new ToolRegistry();

    expect(() =>
      registry.register('fake', {
        description: '伪造工具',
      } as never),
    ).toThrow('不是规范Tool');
  });

  test('创建期拒绝空说明、非法超时和未审批的中高风险策略', () => {
    const base = {
      parameters: z.object({}).strict(),
      execute: async () => ({ success: true as const, summary: '完成' }),
    };

    expect(() =>
      Tool.make({
        ...base,
        description: ' ',
        policy: { source: 'builtin', risk: 'low', approval: 'never', timeoutMs: 1000 },
      }),
    ).toThrow('说明不能为空');
    expect(() =>
      Tool.make({
        ...base,
        description: '测试',
        policy: { source: 'builtin', risk: 'low', approval: 'never', timeoutMs: 0 },
      }),
    ).toThrow('超时必须是正整数');
    expect(() =>
      Tool.make({
        ...base,
        description: '测试',
        policy: { source: 'mcp', risk: 'medium', approval: 'never', timeoutMs: 1000 },
      }),
    ).toThrow('中高风险Tool必须启用系统审批');
  });

  test('名称由Registry唯一维护并生成不可变快照', () => {
    const tool = createEchoTool();
    const registry = new ToolRegistry();

    registry.register('echo', tool);
    const snapshot = registry.snapshot();

    expect(snapshot.names()).toEqual(['echo']);
    expect(snapshot.get('echo')).toBe(tool);
    expect(() => registry.register('echo', createEchoTool())).toThrow('工具名称冲突');
    expect(() => (snapshot.entries as Map<string, unknown>).set('other', tool)).toThrow();
  });

  test('系统侧拒绝不符合Schema的输入', async () => {
    const execute = vi.fn();
    const tool = Tool.make({
      description: '回显文本',
      parameters: z.object({ text: z.string().min(1) }).strict(),
      policy: {
        source: 'builtin',
        risk: 'low',
        approval: 'never',
        timeoutMs: 1000,
      },
      execute,
    });

    const settlement = await Tool.settle('echo', tool, { text: '' }, createContext());

    expect(settlement.status).toBe('error');
    expect(settlement.error?.code).toBe('invalid_input');
    expect(execute).not.toHaveBeenCalled();
  });

  test('重复callId返回已有结算且不会重放副作用', async () => {
    const execute = vi.fn(async () => ({
      success: true as const,
      summary: '已完成',
      data: { value: 1 },
    }));
    const tool = Tool.make({
      description: '只执行一次',
      parameters: z.object({}).strict(),
      policy: {
        source: 'builtin',
        risk: 'low',
        approval: 'never',
        timeoutMs: 1000,
      },
      execute,
    });
    const context = createContext();

    const first = await Tool.settle('once', tool, {}, context);
    const second = await Tool.settle('once', tool, {}, context);

    expect(second).toBe(first);
    expect(execute).toHaveBeenCalledOnce();
  });

  test('权限拒绝时不进入工具实现', async () => {
    const execute = vi.fn();
    const tool = createEchoTool(execute);
    const context = createContext({
      authorize: async () => ({ status: 'denied', reason: '当前会话不可用' }),
    });

    const settlement = await Tool.settle('echo', tool, { text: '你好' }, context);

    expect(settlement.status).toBe('denied');
    expect(settlement.error?.message).toBe('当前会话不可用');
    expect(execute).not.toHaveBeenCalled();
  });

  test('超时和外层取消转换为稳定结算', async () => {
    const timeoutTool = Tool.make({
      description: '永不结束',
      parameters: z.object({}).strict(),
      policy: {
        source: 'builtin',
        risk: 'low',
        approval: 'never',
        timeoutMs: 5,
      },
      execute: async () => await new Promise(() => undefined),
    });
    const cancelled = new AbortController();
    cancelled.abort(new Error('外层停止'));

    await expect(
      Tool.settle('timeout', timeoutTool, {}, createContext({ callId: 'timeout-1' })),
    ).resolves.toMatchObject({ status: 'timeout', error: { code: 'timeout' } });
    await expect(
      Tool.settle(
        'cancelled',
        createEchoTool(),
        { text: '不会执行' },
        createContext({ callId: 'cancel-1', signal: cancelled.signal }),
      ),
    ).resolves.toMatchObject({ status: 'cancelled', error: { code: 'cancelled' } });
  });

  test('权限复核和实现受控失败不会泄漏为异常', async () => {
    const review = await Tool.settle(
      'echo',
      createEchoTool(),
      { text: '你好' },
      createContext({
        authorize: async () => ({ status: 'review', reason: '需要审批' }),
      }),
    );
    const failed = await Tool.settle(
      'failed',
      Tool.make({
        description: '受控失败',
        parameters: z.object({}).strict(),
        policy: {
          source: 'builtin',
          risk: 'low',
          approval: 'never',
          timeoutMs: 1000,
        },
        execute: async () => ({
          success: false,
          summary: '远端拒绝',
          error: '远端拒绝',
          retryable: true,
        }),
      }),
      {},
      createContext({ callId: 'failed-1' }),
    );

    expect(review).toMatchObject({ status: 'review', error: { code: 'approval_required' } });
    expect(failed).toMatchObject({
      status: 'error',
      error: { code: 'execution_failed', retryable: true },
    });
  });

  test('实现返回非法输出或伪造Effect时拒绝提交', async () => {
    const applyEffects = vi.fn();
    const malformed = Tool.make({
      description: '非法输出',
      parameters: z.object({}).strict(),
      policy: {
        source: 'builtin',
        risk: 'low',
        approval: 'never',
        timeoutMs: 1000,
      },
      execute: async () =>
        ({
          success: true,
          summary: '完成',
          effects: [
            {
              type: 'enable_skill',
              skill: {
                metadata: {
                  name: 'forged',
                  description: '伪造Skill',
                  rootPath: '/tmp/forged',
                },
                body: '伪造正文',
              },
            },
          ],
        }) as never,
    });

    const settlement = await Tool.settle(
      'malformed',
      malformed,
      {},
      createContext({ callId: 'malformed-1', applyEffects }),
    );

    expect(settlement).toMatchObject({
      status: 'error',
      error: { code: 'invalid_output' },
    });
    expect(applyEffects).not.toHaveBeenCalled();
  });
});

function createEchoTool(execute = vi.fn()) {
  return Tool.make({
    description: '回显文本',
    parameters: z.object({ text: z.string() }).strict(),
    policy: {
      source: 'builtin',
      risk: 'low',
      approval: 'never',
      timeoutMs: 1000,
    },
    execute: execute.mockImplementation(async (input: { text: string }) => ({
      success: true,
      summary: input.text,
    })),
  });
}

function createContext(
  overrides: Partial<ToolRuntimeContext> = {},
): ToolRuntimeContext & { readonly settlements: Map<string, unknown> } {
  const settlements = new Map<string, unknown>();
  return {
    runId: 'run-1',
    traceId: 'trace-1',
    callId: 'call-1',
    agentName: '叶猫猫',
    signal: new AbortController().signal,
    authorize: async () => ({ status: 'allowed' }),
    getSettlement: (callId) => settlements.get(callId) as never,
    recordSettlement: (settlement) => settlements.set(settlement.audit.callId, settlement),
    applyEffects: vi.fn(),
    settlements,
    ...overrides,
  };
}
