/**
 * Task 4 测试 — failure-classifier
 * 5 cases: T4-13/14/15/17/21（spawn/auth/inactivity/process_exit/queue）
 */
import { describe, it, expect } from 'vitest';
import { classifyFailure } from '@kitty/services/llm/infrastructure/failure-classifier';

describe('classifyFailure', () => {
  it('T4-13: spawn 失败 → spawn_failure / retryable=false', () => {
    const f = classifyFailure({
      exitCode: 1, killed: false, cancelRequested: false,
      stderrTail: '', phase: 'spawning',
    });
    expect(f.code).toBe('spawn_failure');
    expect(f.retryable).toBe(false);
  });

  it('T4-14: stderr 含 invalid api key → auth_failure', () => {
    const f = classifyFailure({
      exitCode: 1, killed: false, cancelRequested: false,
      stderrTail: 'Error: invalid api key provided', phase: 'running',
    });
    expect(f.code).toBe('auth_failure');
    expect(f.retryable).toBe(false);
  });

  it('T4-15: inactivity timeout → inactivity_timeout / retryable=true', () => {
    const f = classifyFailure({
      exitCode: null, killed: true, cancelRequested: false,
      stderrTail: '', phase: 'running', timedOutKind: 'inactivity',
    });
    expect(f.code).toBe('inactivity_timeout');
    expect(f.retryable).toBe(true);
  });

  it('T4-17: exit 非零 + 普通 stderr → process_exit', () => {
    const f = classifyFailure({
      exitCode: 1, killed: false, cancelRequested: false,
      stderrTail: 'something went wrong', phase: 'running',
    });
    expect(f.code).toBe('process_exit');
    expect(f.retryable).toBe(false);
  });

  it('T4-21: queue timeout → queue_timeout / retryable=true', () => {
    const f = classifyFailure({
      exitCode: null, killed: false, cancelRequested: false,
      stderrTail: '', phase: 'running', timedOutKind: 'queue',
    });
    expect(f.code).toBe('queue_timeout');
    expect(f.retryable).toBe(true);
  });
});
