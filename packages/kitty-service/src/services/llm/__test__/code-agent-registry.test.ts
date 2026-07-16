/**
 * Task 5 红灯测试 — registry + logger + 专项分类器
 *
 * 3 cases（不依赖真实 CLI）：
 * T5-1: AGENT_DEFS 有至少一个条目 + getAgentDef 按 id 查找
 * T5-2: LoggerPort 实现存在且符合接口
 * T5-3: classifyProtocolMismatch / WorkspaceFailure / PipeBroken 三项专项分类器
 */
import { describe, it, expect } from 'vitest';

describe('code-agent-registry', () => {
  it('T5-1: AGENT_DEFS 含 claude-code + getAgentDef 查找', async () => {
    const { AGENT_DEFS, getAgentDef } = await import(
      '@kitty/services/llm/infrastructure/code-agent-registry'
    );
    expect(AGENT_DEFS.length).toBeGreaterThanOrEqual(1);
    const claude = getAgentDef('claude-code');
    expect(claude).toBeDefined();
    expect(claude!.id).toBe('claude-code');
    expect(claude!.streamFormat).toBe('claude-stream-json');
    expect(claude!.promptViaStdin).toBe(true);
  });
});

describe('code-agent-logger', () => {
  it('T5-2: LoggerPort 实现存在且符合接口（info/warn/error 三方法）', async () => {
    const { codeAgentLogger } = await import(
      '@kitty/services/llm/infrastructure/code-agent-logger'
    );
    expect(typeof codeAgentLogger.info).toBe('function');
    expect(typeof codeAgentLogger.warn).toBe('function');
    expect(typeof codeAgentLogger.error).toBe('function');
    // 不抛错即通过
    codeAgentLogger.info('test', { sessionId: 'test-1' });
  });
});

describe('failure-classifier 专项', () => {
  it('T5-3: classifyProtocolMismatch / WorkspaceFailure / PipeBroken', async () => {
    const {
      classifyProtocolMismatch,
      classifyWorkspaceFailure,
      classifyPipeBroken,
    } = await import('@kitty/services/llm/infrastructure/failure-classifier');

    expect(classifyProtocolMismatch(5).code).toBe('protocol_mismatch');
    expect(classifyProtocolMismatch(5).retryable).toBe(false);

    expect(classifyWorkspaceFailure('权限不足').code).toBe('workspace_failure');
    expect(classifyWorkspaceFailure('权限不足').retryable).toBe(false);

    expect(classifyPipeBroken('s-1').code).toBe('pipe_broken');
    expect(classifyPipeBroken('s-1').retryable).toBe(false);
  });
});
