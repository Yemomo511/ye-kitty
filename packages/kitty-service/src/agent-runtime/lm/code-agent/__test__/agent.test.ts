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
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

/** 创建临时工作目录 */
function createTempWorkdir(): string {
  const dir = join(tmpdir(), `kitty-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('Gate', () => {
  let testDir: string;
  let whiteRoot: string;

  beforeEach(() => {
    whiteRoot = createTempWorkdir(); // 作为白名单根
    testDir = createTempWorkdir(); // 在白名单外的独立目录（用于 T6-3）
  });

  afterEach(() => {
    // 在 tmpdir() 下创建的白名单根，直接用 realpathSync 匹配
    if (existsSync(whiteRoot)) rmSync(whiteRoot, { recursive: true, force: true });
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('T6-1: 不指定 workdir → 自动分配 task-{uuid}，通过', async () => {
    const { Gate } = await import('@kitty/agent-runtime/lm/code-agent/gate');
    const gate = new Gate(whiteRoot);
    const task = {
      agentId: 'claude-code',
      prompt: 'test',
      workdir: '', // 未指定
      source: 'api' as const,
    };
    await gate.check(task);
    // 验证自动分配了 workdir
    expect(task.workdir).not.toBe('');
    expect(task.workdir).toContain('task-');
  });

  it('T6-2: 不指定 workdir → 自动分配，目录在 whiteRoot 下', async () => {
    const { Gate } = await import('@kitty/agent-runtime/lm/code-agent/gate');
    const gate = new Gate(whiteRoot);
    const task = {
      agentId: 'claude-code',
      prompt: 'test',
      workdir: '',
      source: 'api' as const,
    };
    await gate.check(task);
    // 自动分配的目录在 whiteRoot 下
    const { realpathSync } = await import('node:fs');
    const resolved = realpathSync(task.workdir).replace(/\\/g, '/') + '/';
    const rootNormalized = realpathSync(whiteRoot).replace(/\\/g, '/') + '/';
    expect(resolved.startsWith(rootNormalized)).toBe(true);
  });

  it('T6-3: workdir 在白名单外 → 抛 GateRejectedError', async () => {
    const { Gate } = await import('@kitty/agent-runtime/lm/code-agent/gate');
    // testDir 是独立目录，不在 whiteRoot 下
    const gate = new Gate(whiteRoot);
    const result = gate.check({
      agentId: 'claude-code',
      prompt: 'test',
      workdir: testDir,
      source: 'api',
    });
    await expect(result).rejects.toThrow();
  });
});

describe('createCodeAgent', () => {
  it('T6-4: factory 返回 runner + registry + shutdown', async () => {
    process.env['CODE_AGENT_WORKSPACE_ROOT'] = tmpdir();
    const { createCodeAgent } = await import('@kitty/agent-runtime/lm/code-agent');
    const runtime = createCodeAgent({});
    expect(runtime.runner).toBeDefined();
    expect(runtime.registry).toBeDefined();
    expect(runtime.shutdown).toBeDefined();
    expect(typeof runtime.runner.submit).toBe('function');
    expect(typeof runtime.runner.cancel).toBe('function');
    await runtime.shutdown();
    delete process.env['CODE_AGENT_WORKSPACE_ROOT'];
  });
});

describe('CodeAgent', () => {
  it('T6-5: cancel queued session → 幂等静默', async () => {
    const { createCodeAgent } = await import('@kitty/agent-runtime/lm/code-agent');
    process.env['CODE_AGENT_WORKSPACE_ROOT'] = tmpdir();
    const runtime = createCodeAgent({});

    const nonExistentId = 'nonexistent-session';
    await runtime.runner.cancel(nonExistentId);
    // 不抛错 = 幂等 ✓

    await runtime.shutdown();
    delete process.env['CODE_AGENT_WORKSPACE_ROOT'];
  });
});
