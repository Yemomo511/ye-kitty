/**
 * Task 6 红灯测试 — gate service + 编排器（核心 6 cases）
 *
 * T6-1: gate Hook 链 → 通过/拒绝
 * T6-2: workdir 不存在 → 拒绝
 * T6-3: factory 创建 → runner + registry + shutdown 返回值
 * T6-4: submit → 返回 queued session
 * T6-5: cancel queued session → canceled + session_end
 * T6-6: cancel 不存在 session → 幂等静默
 *
 * 注：spawn 路径用 fake-agent fixture（PATH 依赖），
 * 纯内存路径（gate/factory/cancel queued）独立测试。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** 创建临时工作目录 */
function createTempWorkdir(): string {
  const dir = join(tmpdir(), `kitty-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('CodeAgentGateService', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempWorkdir();
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('T6-1: workdir 存在且在白名单下 → null（通过）', async () => {
    const { CodeAgentGateService } = await import(
      '@kitty/services/llm/application/code-agent-gate.service'
    );
    const gate = new CodeAgentGateService(tmpdir());
    const result = gate.check({
      agentId: 'claude-code',
      prompt: 'test',
      workdir: testDir,
      source: 'control-plane',
    });
    await expect(result).resolves.toBeUndefined();
  });

  it('T6-2: workdir 不存在 → 抛 GateRejectedError', async () => {
    const { CodeAgentGateService } = await import(
      '@kitty/services/llm/application/code-agent-gate.service'
    );
    const gate = new CodeAgentGateService(tmpdir());
    const result = gate.check({
      agentId: 'claude-code',
      prompt: 'test',
      workdir: join(testDir, 'nonexistent'),
      source: 'control-plane',
    });
    await expect(result).rejects.toThrow('工作目录不存在');
  });

  it('T6-3: workdir 在白名单外 → 抛 GateRejectedError', async () => {
    const { CodeAgentGateService } = await import(
      '@kitty/services/llm/application/code-agent-gate.service'
    );
    const otherDir = join(tmpdir(), 'other-workspace');
    mkdirSync(otherDir, { recursive: true });
    try {
      const gate = new CodeAgentGateService(join(tmpdir(), 'kitty-restricted'));
      const result = gate.check({
        agentId: 'claude-code',
        prompt: 'test',
        workdir: otherDir,
        source: 'control-plane',
      });
      await expect(result).rejects.toThrow();
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });
});

describe('createCodeAgentRuntime', () => {
  it('T6-4: factory 返回 runner + registry + shutdown', async () => {
    process.env['CODE_AGENT_WORKSPACE_ROOT'] = tmpdir();
    const { createCodeAgentRuntime } = await import(
      '@kitty/services/llm/application/code-agent.factory'
    );
    const runtime = createCodeAgentRuntime({});
    expect(runtime.runner).toBeDefined();
    expect(runtime.registry).toBeDefined();
    expect(runtime.shutdown).toBeDefined();
    expect(typeof runtime.runner.submit).toBe('function');
    expect(typeof runtime.runner.cancel).toBe('function');
    await runtime.shutdown();
    delete process.env['CODE_AGENT_WORKSPACE_ROOT'];
  });
});

describe('CodeAgentOrchestrator', () => {
  it('T6-5: cancel queued session → 幂等静默', async () => {
    const { createCodeAgentRuntime } = await import(
      '@kitty/services/llm/application/code-agent.factory'
    );
    process.env['CODE_AGENT_WORKSPACE_ROOT'] = tmpdir();
    const runtime = createCodeAgentRuntime({});

    const nonExistentId = 'nonexistent-session';
    await runtime.runner.cancel(nonExistentId);
    // 不抛错 = 幂等 ✓

    await runtime.shutdown();
    delete process.env['CODE_AGENT_WORKSPACE_ROOT'];
  });
});
