import { describe, expect, test, vi } from 'vitest';
import type { CodeAgentEvent } from '../../lm/code-agent/event';
import type { CodeAgentRunner } from '../../lm/code-agent/runner';
import type { CodeAgentSession } from '../../lm/code-agent/session';
import { createCodeTool } from '../code';
import { Tool } from '../tool';
import { createToolTestContext } from './runtime-context';

describe('Code Agent Tool', () => {
  test('提交任务并收集文本输出', async () => {
    const runner = createRunner([
      { type: 'text_delta', sessionId: 'session-1', delta: '完成' },
      { type: 'session_end', sessionId: 'session-1', status: 'succeeded', exitCode: 0 },
    ]);

    const settlement = await Tool.settle(
      'code_agent',
      createCodeTool(runner),
      { agentId: 'codex', prompt: '检查代码', workdir: '/tmp/workspace' },
      createToolTestContext({ approvalGranted: true }),
    );

    expect(settlement).toMatchObject({
      status: 'success',
      output: {
        summary: '完成',
        data: { sessionId: 'session-1', output: '完成' },
      },
    });
  });

  test('Code Agent请求外部工具时取消会话', async () => {
    const runner = createRunner([
      {
        type: 'tool_use',
        sessionId: 'session-1',
        id: 'tool-1',
        name: 'read_file',
        input: { path: 'README.md' },
      },
    ]);

    const settlement = await Tool.settle(
      'code_agent',
      createCodeTool(runner),
      { agentId: 'codex', prompt: '读取文件', workdir: '/tmp/workspace' },
      createToolTestContext({ approvalGranted: true }),
    );

    expect(settlement.output?.error).toBe('Code Agent请求外部工具');
    expect(runner.cancel).toHaveBeenCalledWith('session-1');
  });
});

function createRunner(events: readonly CodeAgentEvent[]): CodeAgentRunner {
  const session: CodeAgentSession = {
    id: 'session-1',
    agentDefId: 'codex',
    status: 'succeeded',
    async *events() {
      yield* events;
    },
  };
  return {
    submit: vi.fn(async () => session),
    getSession: vi.fn(() => session),
    cancel: vi.fn(async () => undefined),
    injectToolResult: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  };
}
