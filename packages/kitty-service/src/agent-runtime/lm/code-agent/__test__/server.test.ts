/**
 * Task 7 红灯测试 — Code Agent API 路由（6 cases with fastify.inject）
 *
 * T7-1: API key 为空 → server 不启动
 * T7-2: 无 Authorization 头 → 401
 * T7-3: 正确 Bearer → GET /admin/code-agent/agents 200
 * T7-4: POST body 缺必填字段 → 400
 * T7-5: DELETE 缺少 id → 400
 * T7-6: DELETE 有效 id → 200
 *
 * 注：SSE 端到端（T7-3 原）用 fake-agent 真实 spawn，此处仅验证 HTTP 语义。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CodeAgentRunner } from '../runner';
import { tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** 创建临时工作目录 */
function createTempWorkdir(): string {
  const dir = join(tmpdir(), `kitty-http-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const testWorkdir = createTempWorkdir();
const testKey = 'test-api-key-32-characters-long!!';

describe('Code Agent API', () => {
  it('T7-1: API key 为空 → server 不启动', async () => {
    const { startServer } = await import('@kitty/agent-runtime/lm/code-agent/server');
    const app = await startServer(undefined, () => {});
    expect(app).toBeUndefined();
  });

  describe('with server', () => {
    let runner: CodeAgentRunner;
    let app: FastifyInstance;

    beforeEach(async () => {
      // 创建最小 fastify app + 注册路由（不需要 CodeAgent，
      // 使用简化的 mock runner 测试 HTTP 语义）
      process.env['CODE_AGENT_WORKSPACE_ROOT'] = tmpdir();
      const { createCodeAgent } = await import('@kitty/agent-runtime/lm/code-agent');
      const runtime = createCodeAgent({ workspaceRoot: testWorkdir });
      runner = runtime.runner;

      const { startServer } = await import('@kitty/agent-runtime/lm/code-agent/server');
      const { registerRoutes } = await import('@kitty/agent-runtime/lm/code-agent/routes');
      const started = await startServer(testKey, (a) => {
        registerRoutes(a, runner, runtime.registry);
      });
      if (!started) throw new Error('测试服务启动失败');
      app = started;
    });

    it('T7-2: 无 Authorization 头 → 401', async () => {
      const res = await app!.inject({
        method: 'GET',
        url: '/admin/code-agent/agents',
      });
      expect(res.statusCode).toBe(401);
    });

    it('T7-3: 正确 Bearer → GET agents 返回列表', async () => {
      const res = await app!.inject({
        method: 'GET',
        url: '/admin/code-agent/agents',
        headers: { authorization: `Bearer ${testKey}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.agents).toBeDefined();
    });

    it('T7-4: POST 缺 agentId → 400', async () => {
      const res = await app!.inject({
        method: 'POST',
        url: '/admin/code-agent/runs',
        headers: { authorization: `Bearer ${testKey}` },
        payload: { prompt: 'test', workdir: testWorkdir },
      });
      expect(res.statusCode).toBe(400);
    });

    it('T7-5: DELETE 缺少 id → 400', async () => {
      const res = await app!.inject({
        method: 'DELETE',
        url: '/admin/code-agent/runs/',
        headers: { authorization: `Bearer ${testKey}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('T7-6: DELETE 有效 id → 200', async () => {
      const res = await app!.inject({
        method: 'DELETE',
        url: '/admin/code-agent/runs/fake-id-123',
        headers: { authorization: `Bearer ${testKey}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
