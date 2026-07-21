/** Task 5 测试 — process-env（T5-5, T5-6） */
import { describe, it, expect, afterEach } from 'vitest';
import { platform } from 'node:os';
import { buildAgentEnv } from '@kitty/agent-runtime/lm/code-agent/process/environment';

describe('buildAgentEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = originalEnv;
  });

  it('T5-5: envAllowList 为空 → 仅保留 Windows 系统必需变量 + 印章', () => {
    process.env['MY_SECRET'] = 'secret-value';
    const env = buildAgentEnv([], 'session-abc');
    expect(env['MY_SECRET']).toBeUndefined();
    expect(env['KITTY_CODE_AGENT_SESSION']).toBe('session-abc');
    // PATH 是所有平台启动 CLI 的必需变量；SystemRoot 只在 Windows 存在。
    expect(env['PATH'] ?? env['Path']).toBeDefined();
    if (platform() === 'win32') {
      expect(env['SystemRoot'] ?? env['SYSTEMROOT']).toBeDefined();
    }
  });

  it('T5-5b: envAllowList 明确列出 → 该变量透传', () => {
    process.env['MY_TOOL_HOME'] = '/opt/tool';
    const env = buildAgentEnv(['MY_TOOL_HOME'], 'session-1');
    expect(env['MY_TOOL_HOME']).toBe('/opt/tool');
  });

  it('T5-6: Windows 大小写不敏感 — Path 和 PATH 视为同一变量', () => {
    const env = buildAgentEnv(['my_custom_var'], 'session-2');
    // PATH（大写）或 Path（混合大小写）中至少有一个被保留
    const hasPath = Object.keys(env).some((k) => k.toLowerCase() === 'path' && env[k]);
    expect(hasPath).toBe(true);
  });

  it('T5-6b: 白名单变量名大小写不敏感', () => {
    process.env['MyToolConfig'] = 'value';
    const envLower = buildAgentEnv(['mytoolconfig'], 's-1');
    expect(envLower['MyToolConfig']).toBe('value');
  });

  it('extraEnv 注入 → env 中包含额外变量', () => {
    const env = buildAgentEnv([], 's-3', { CUSTOM_VAR: 'hello' });
    expect(env['CUSTOM_VAR']).toBe('hello');
    expect(env['KITTY_CODE_AGENT_SESSION']).toBe('s-3');
  });
});
