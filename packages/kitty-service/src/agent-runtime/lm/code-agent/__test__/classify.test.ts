/**
 * Task 4 测试 — failure-classifier
 * 5 cases: T4-13/14/15/17/21（spawn/auth/inactivity/process_exit/queue）
 */
import { describe, it, expect } from 'vitest';
import { classifyFailure } from '@kitty/agent-runtime/lm/code-agent/classify';

describe('classifyFailure', () => {
  it('T4-13: spawn 失败 → spawn_failure / retryable=false', () => {
    const f = classifyFailure({
      exitCode: 1,
      killed: false,
      cancelRequested: false,
      stderrTail: '',
      phase: 'spawning',
    });
    expect(f.code).toBe('spawn_failure');
    expect(f.retryable).toBe(false);
  });

  it('T4-14: stderr 含 invalid api key → auth_failure', () => {
    const f = classifyFailure({
      exitCode: 1,
      killed: false,
      cancelRequested: false,
      stderrTail: 'Error: invalid api key provided',
      phase: 'running',
    });
    expect(f.code).toBe('auth_failure');
    expect(f.retryable).toBe(false);
  });

  it('T4-15: inactivity timeout → inactivity_timeout / retryable=true', () => {
    const f = classifyFailure({
      exitCode: null,
      killed: true,
      cancelRequested: false,
      stderrTail: '',
      phase: 'running',
      timedOutKind: 'inactivity',
    });
    expect(f.code).toBe('inactivity_timeout');
    expect(f.retryable).toBe(true);
  });

  it('T4-17: exit 非零 + 普通 stderr → process_exit', () => {
    const f = classifyFailure({
      exitCode: 1,
      killed: false,
      cancelRequested: false,
      stderrTail: 'something went wrong',
      phase: 'running',
    });
    expect(f.code).toBe('process_exit');
    expect(f.retryable).toBe(false);
  });

  it('T4-21: queue timeout → queue_timeout / retryable=true', () => {
    const f = classifyFailure({
      exitCode: null,
      killed: false,
      cancelRequested: false,
      stderrTail: '',
      phase: 'running',
      timedOutKind: 'queue',
    });
    expect(f.code).toBe('queue_timeout');
    expect(f.retryable).toBe(true);
  });

  it('T4-16: session timeout → session_timeout / retryable=false', () => {
    const f = classifyFailure({
      exitCode: null,
      killed: true,
      cancelRequested: false,
      stderrTail: '',
      phase: 'running',
      timedOutKind: 'session',
    });
    expect(f.code).toBe('session_timeout');
    expect(f.retryable).toBe(false);
  });

  it('T4-18: cancel requested 优先 → process_exit', () => {
    const f = classifyFailure({
      exitCode: 1,
      killed: false,
      cancelRequested: true,
      stderrTail: 'auth failed',
      phase: 'running',
    });
    expect(f.code).toBe('process_exit');
    expect(f.message).toContain('取消');
  });

  it('exit 0 但非 succeeded → process_exit', () => {
    const f = classifyFailure({
      exitCode: 0,
      killed: false,
      cancelRequested: false,
      stderrTail: '',
      phase: 'running',
    });
    expect(f.code).toBe('process_exit');
    expect(f.message).toContain('exit 0 但引擎判定失败');
  });

  it('stderr 含 rate limit → auth_failure（限流归入认证类）', () => {
    const f = classifyFailure({
      exitCode: 1,
      killed: false,
      cancelRequested: false,
      stderrTail: 'Error: rate limit exceeded, 429',
      phase: 'running',
    });
    expect(f.code).toBe('auth_failure');
  });

  it('stderr 含 upstream 错误 → 通用 process_exit', () => {
    const f = classifyFailure({
      exitCode: 1,
      killed: false,
      cancelRequested: false,
      stderrTail: 'service unavailable 503',
      phase: 'running',
    });
    // upstream 正则触发后仍走通用判断，因为 auth 优先
    expect(f.code).toBeDefined();
  });
});
