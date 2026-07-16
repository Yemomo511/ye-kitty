/**
 * Task 2 红灯测试 — code-agent 错误类
 *
 * 测试 3 个错误类的构造与属性（TDD 红灯先行）。
 */

import { describe, it, expect } from 'vitest';

// 红灯阶段：import 会失败（文件尚未提交）——这正是 TDD 的预期。
// vitest 在 typecheck 阶段会报错，确认测试先行。

describe('CodeAgentGateRejectedError', () => {
  it('应正确设置 name、message 和 cause', async () => {
    const { CodeAgentGateRejectedError } = await import(
      '../domain/code-agent-errors'
    );
    const err = new CodeAgentGateRejectedError('workdir 不在白名单内');
    expect(err.name).toBe('CodeAgentGateRejectedError');
    expect(err.message).toContain('workdir 不在白名单内');
    expect(err.cause).toBe('workdir 不在白名单内');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('CodeAgentSessionClosedError', () => {
  it('应正确设置 sessionId 和 currentStatus', async () => {
    const { CodeAgentSessionClosedError } = await import(
      '../domain/code-agent-errors'
    );
    const err = new CodeAgentSessionClosedError('session-1', 'canceled');
    expect(err.name).toBe('CodeAgentSessionClosedError');
    expect(err.sessionId).toBe('session-1');
    expect(err.currentStatus).toBe('canceled');
  });
});

describe('CodeAgentPipeBrokenError', () => {
  it('应正确设置 sessionId，可选 cause', async () => {
    const { CodeAgentPipeBrokenError } = await import(
      '../domain/code-agent-errors'
    );
    const err = new CodeAgentPipeBrokenError('session-2');
    expect(err.name).toBe('CodeAgentPipeBrokenError');
    expect(err.sessionId).toBe('session-2');
    expect(err.message).toContain('session-2');
    expect(err.message).toContain('stdin 管道已断开');
  });
});
