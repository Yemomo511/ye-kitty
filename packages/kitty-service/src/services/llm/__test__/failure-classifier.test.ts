/** Task 4 红灯测试 — failure-classifier（核心 5 cases） */
import { describe, it, expect } from 'vitest';

describe('classifyFailure', () => {
  it('T4-13 spawn 失败 → spawn_failure', async () => {
    const { classifyFailure } = await import('../infrastructure/failure-classifier');
    const f = classifyFailure({
      exitCode: 1, killed: false, cancelRequested: false,
      stderrTail: '', phase: 'spawning',
    });
    expect(f.code).toBe('spawn_failure');
    expect(f.retryable).toBe(false);
  });

  it('T4-14 auth 失败（stderr 含 invalid api key）→ auth_failure', async () => {
    const { classifyFailure } = await import('../infrastructure/failure-classifier');
    const f = classifyFailure({
      exitCode: 1, killed: false, cancelRequested: false,
      stderrTail: 'Error: invalid api key', phase: 'running',
    });
    expect(f.code).toBe('auth_failure');
    expect(f.retryable).toBe(false);
  });

  it('T4-15 inactivity → inactivity_timeout', async () => {
    const { classifyFailure } = await import('../infrastructure/failure-classifier');
    const f = classifyFailure({
      exitCode: null, killed: true, cancelRequested: false,
      stderrTail: '', phase: 'running', timedOutKind: 'inactivity',
    });
    expect(f.code).toBe('inactivity_timeout');
    expect(f.retryable).toBe(true);
  });

  it('T4-17 exit 非零 + 普通 stderr → process_exit', async () => {
    const { classifyFailure } = await import('../infrastructure/failure-classifier');
    const f = classifyFailure({
      exitCode: 1, killed: false, cancelRequested: false,
      stderrTail: 'something went wrong', phase: 'running',
    });
    expect(f.code).toBe('process_exit');
    expect(f.retryable).toBe(false);
  });

  it('T4-21 queue timeout → queue_timeout', async () => {
    const { classifyFailure } = await import('../infrastructure/failure-classifier');
    const f = classifyFailure({
      exitCode: null, killed: false, cancelRequested: false,
      stderrTail: '', phase: 'running', timedOutKind: 'queue',
    });
    expect(f.code).toBe('queue_timeout');
    expect(f.retryable).toBe(true);
  });
});
