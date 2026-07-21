import { describe, expect, test, vi } from 'vitest';
import { ToolRegistry } from '../tools/registry';
import { ToolExecutor } from '../tools/executor';
import type { ToolPermission } from '../tools/permission';
import type { Tool } from '../tools/tool';
import { Schedule } from './schedule';

const echoTool: Tool = {
  name: 'echo',
  description: '返回输入文本。',
  risk: 'low',
  input: '{}',
  execute: vi.fn(async (input) => ({
    success: true,
    summary: `结果：${String((input as { text?: string }).text ?? '')}`,
    data: input,
  })),
};

describe('Agent Action 调度', () => {
  test('直接返回 FinishAction', async () => {
    const schedule = createSchedule();
    const action = {
      type: 'finish',
      result: 'reply',
      output: { text: '你好' },
      reason: '完成',
    } as const;

    await expect(schedule.dispatch(action)).resolves.toEqual({ type: 'finished', action });
  });

  test('将 ToolAction 定位并执行为 Observation', async () => {
    const schedule = createSchedule();

    await expect(
      schedule.dispatch({
        type: 'tool',
        callId: 'call-1',
        name: 'echo',
        input: { text: '你好' },
        reason: '测试工具',
      }),
    ).resolves.toEqual({
      type: 'observed',
      observation: {
        callId: 'call-1',
        tool: 'echo',
        status: 'success',
        summary: '结果：你好',
        data: { text: '你好' },
      },
    });
  });

  test('把Agent运行上下文传递给工具', async () => {
    const execute = vi.fn(async () => ({ success: true, summary: '完成' }));
    const tool: Tool = { ...echoTool, name: 'context', execute };
    const schedule = new Schedule(new ToolRegistry([tool]), new ToolExecutor(), allowAllTools());
    const availableSkills = [
      { name: 'chat-style', description: '聊天风格', rootPath: '/tmp/skills/chat-style' },
    ];

    await schedule.dispatch(
      {
        type: 'tool',
        callId: 'call-context',
        name: 'context',
        input: {},
        reason: '测试上下文',
      },
      { availableSkills },
    );

    expect(execute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ callId: 'call-context', availableSkills }),
    );
  });

  test('未知工具返回错误 Observation', async () => {
    const schedule = createSchedule();

    const result = await schedule.dispatch({
      type: 'tool',
      callId: 'call-missing',
      name: 'missing',
      input: {},
      reason: '测试未知工具',
    });

    expect(result).toEqual({
      type: 'observed',
      observation: {
        callId: 'call-missing',
        tool: 'missing',
        status: 'error',
        summary: '工具 missing 未注册，不能执行。',
        error: '工具未注册',
      },
    });
  });

  test.each([
    ['denied', '工具执行已被权限规则拒绝。'],
    ['review', '工具执行需要人工确认。'],
  ] as const)('权限结果 %s 不会调用工具', async (permissionStatus, summary) => {
    const permission: ToolPermission = {
      check: vi.fn(async () => ({ status: permissionStatus, reason: summary })),
    };
    const schedule = createSchedule(permission);

    const result = await schedule.dispatch({
      type: 'tool',
      callId: 'call-risk',
      name: 'echo',
      input: {},
      reason: '测试权限',
    });

    expect(result).toEqual({
      type: 'observed',
      observation: {
        callId: 'call-risk',
        tool: 'echo',
        status: permissionStatus,
        summary,
      },
    });
  });
});

function createSchedule(permission: ToolPermission = allowAllTools()): Schedule {
  return new Schedule(new ToolRegistry([echoTool]), new ToolExecutor(), permission);
}

function allowAllTools(): ToolPermission {
  return {
    check: vi.fn(async () => ({ status: 'allowed' as const })),
  };
}
