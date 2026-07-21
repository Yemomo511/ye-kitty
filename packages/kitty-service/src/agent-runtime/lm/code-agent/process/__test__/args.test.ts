/** Task 5 测试 — argv-budget（T5-4） */
import { describe, it, expect } from 'vitest';
import { assertArgvBudget } from '@kitty/agent-runtime/lm/code-agent/process/args';

describe('assertArgvBudget', () => {
  it('T5-4: 正常长度 → 不抛错', () => {
    expect(() => assertArgvBudget(['--flag', 'value'])).not.toThrow();
  });

  it('T5-4b: 超 30KB → 抛错，提示 prompt 不应进 argv', () => {
    // 构造超过 30KB 的 args 数组
    const longArg = 'x'.repeat(31 * 1024);
    expect(() => assertArgvBudget([longArg])).toThrow('超过 Windows 预算');
    expect(() => assertArgvBudget([longArg])).toThrow('prompt 必须经 stdin 传递');
  });
});
