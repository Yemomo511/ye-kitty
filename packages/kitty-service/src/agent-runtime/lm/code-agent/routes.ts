/**
 * Code Agent本地管理路由
 *
 * 路由前缀为 /admin/code-agent/*，只依赖注入的运行能力与注册表。
 * 依赖注入：runner + registry 由工厂函数创建后传入。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CodeAgentRunner } from './runner';
import type { CodeAgentRegistry } from './registry';
import type { CodeAgentTask } from '@kitty/agent-runtime/lm/code-agent/task';
import { CodeAgentGateRejectedError } from './error';
import { log } from './log';

/** SSE 断连后等待重连的超时（毫秒） */
const SSE_RECONNECT_GRACE_MS = 60_000;

/** 注册 code-agent /admin 路由 */
export function registerRoutes(
  app: FastifyInstance,
  runner: CodeAgentRunner,
  registry: CodeAgentRegistry,
): void {
  // 断连后等待 cancel 的定时器，key = sessionId
  const pendingCancelTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** 发送 SSE 事件流 */
  async function streamEvents(
    sessionId: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const session = runner.getSession(sessionId);
    if (!session) {
      reply.status(404).send({ error: '会话不存在' });
      return;
    }

    // 如果当前 sessionId 有一个待执行的 cancel 定时器 → 取消它（说明有客户端重连来了）
    const pendingTimer = pendingCancelTimers.get(sessionId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingCancelTimers.delete(sessionId);
      log.info(`SSE 重连: ${sessionId}，已取消自动清理`, { sessionId });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // SSE 断连处理：宽限 60 秒，超时无人重连则 cancel session
    req.raw.on('close', () => {
      log.info(`SSE 客户端断连: ${sessionId}`, { sessionId });
      const timer = setTimeout(() => {
        pendingCancelTimers.delete(sessionId);
        log.info(`SSE 断连超时（无人重连），取消会话: ${sessionId}`, { sessionId });
        runner.cancel(sessionId).catch(() => {});
      }, SSE_RECONNECT_GRACE_MS);
      pendingCancelTimers.set(sessionId, timer);
    });

    for await (const event of session.events()) {
      const line = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
      if (!reply.raw.write(line)) {
        await new Promise<void>((resolve) => reply.raw.once('drain', resolve));
      }

      if (event.type === 'session_end') {
        // 一次性清除该 session 所有待执行定时器
        const t = pendingCancelTimers.get(sessionId);
        if (t) {
          clearTimeout(t);
          pendingCancelTimers.delete(sessionId);
        }
        break;
      }
    }

    reply.raw.end();
  }

  // POST /admin/code-agent/runs
  app.post('/admin/code-agent/runs', { bodyLimit: 1048576 }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      reply.status(400).send({ error: '请求体不能为空' });
      return;
    }

    const task: CodeAgentTask = {
      agentId: String(body['agentId'] ?? ''),
      prompt: String(body['prompt'] ?? ''),
      workdir: body['workdir'] ? String(body['workdir']) : '',
      model: body['model'] ? String(body['model']) : undefined,
      extraInstructions: body['extraInstructions'] ? String(body['extraInstructions']) : undefined,
      timeoutOverrides: body['timeoutOverrides']
        ? {
            sessionMs: (body['timeoutOverrides'] as Record<string, unknown>)['sessionMs'] as
              number | undefined,
            inactivityMs: (body['timeoutOverrides'] as Record<string, unknown>)['inactivityMs'] as
              number | undefined,
          }
        : undefined,
      source: 'control-plane',
    };

    if (!task.agentId || !task.prompt) {
      reply.status(400).send({ error: 'agentId 和 prompt 为必填字段' });
      return;
    }

    try {
      const session = await runner.submit(task);
      log.info(`HTTP 提交: ${session.id} agent=${task.agentId}`, { sessionId: session.id });

      // 校验 spawn 是否成功（可能门禁通过但实际进程启动失败）
      if (session.status === 'running' && !session.startedAt) {
        log.warn(`会话 ${session.id} 创建成功但进程可能未启动，等待事件`, {
          sessionId: session.id,
        });
      }

      await streamEvents(session.id, request, reply);
    } catch (err) {
      if (err instanceof CodeAgentGateRejectedError) {
        reply.status(403).send({ error: err.message, reason: err.cause });
      } else {
        log.error('HTTP 提交失败', err instanceof Error ? err : new Error(String(err)));
        const msg = err instanceof Error ? err.message : '内部错误';
        reply.status(500).send({ error: msg });
      }
    }
  });

  // GET /admin/code-agent/runs/:id/events — 重连已存在的 session
  app.get('/admin/code-agent/runs/:id/events', async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) {
      reply.status(400).send({ error: '缺少 session id' });
      return;
    }
    await streamEvents(id, request, reply);
  });

  // GET /admin/code-agent/agents
  app.get('/admin/code-agent/agents', async (_request, reply) => {
    const agents = await registry.listAgents();
    reply.send({ agents });
  });

  // DELETE /admin/code-agent/runs/:id
  app.delete('/admin/code-agent/runs/:id', async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    if (!id) {
      reply.status(400).send({ error: '缺少 session id' });
      return;
    }

    // 清除待清理定时器
    const t = pendingCancelTimers.get(id);
    if (t) {
      clearTimeout(t);
      pendingCancelTimers.delete(id);
    }
    await runner.cancel(id);
    reply.send({ canceled: id });
  });
}
