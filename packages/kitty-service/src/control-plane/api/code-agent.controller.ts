/**
 * Code Agent Controller
 *
 * 路由前缀 /admin/code-agent/*（对齐 control-plane/api/README.md 既有约定）。
 * 依赖注入：runner + registry 由工厂函数创建后传入。
 */

import type { FastifyInstance } from 'fastify';
import type { CodeAgentRunnerPort } from '../../services/llm/ports/code-agent-runner.port';
import type { CodeAgentRegistryPort } from '../../services/llm/ports/code-agent-registry.port';
import type { CodeAgentTaskContract } from '@kitty/contracts/code-agent/code-agent-task.contract';
import { CodeAgentGateRejectedError } from '../../services/llm/domain/code-agent-errors';
import { codeAgentLogger } from '../../services/llm/infrastructure/code-agent-logger';

/** 注册 code-agent /admin 路由 */
export function registerCodeAgentRoutes(
  app: FastifyInstance,
  runner: CodeAgentRunnerPort,
  registry: CodeAgentRegistryPort,
): void {
  // POST /admin/code-agent/runs
  app.post('/admin/code-agent/runs', { bodyLimit: 1048576 }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      reply.status(400).send({ error: '请求体不能为空' });
      return;
    }

    const task: CodeAgentTaskContract = {
      agentId: String(body['agentId'] ?? ''),
      prompt: String(body['prompt'] ?? ''),
      workdir: body['workdir'] ? String(body['workdir']) : '',  // 空 = gate 自动创建
      model: body['model'] ? String(body['model']) : undefined,
      extraInstructions: body['extraInstructions'] ? String(body['extraInstructions']) : undefined,
      timeoutOverrides: body['timeoutOverrides']
        ? {
            sessionMs: (body['timeoutOverrides'] as Record<string, unknown>)['sessionMs'] as number | undefined,
            inactivityMs: (body['timeoutOverrides'] as Record<string, unknown>)['inactivityMs'] as number | undefined,
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
      codeAgentLogger.info(`HTTP 提交: ${session.id} agent=${task.agentId}`, { sessionId: session.id });

      // SSE 响应
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // 客户端断连时不取消 session（T7-7）
      request.raw.on('close', () => {
        codeAgentLogger.info(`SSE 客户端断连: ${session.id}`, { sessionId: session.id });
      });

      for await (const event of session.events()) {
        const line = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        if (!reply.raw.write(line)) {
          // 背压：等待 drain
          await new Promise<void>((resolve) => reply.raw.once('drain', resolve));
        }

        if (event.type === 'session_end') {
          break;
        }
      }

      reply.raw.end();
    } catch (err) {
      if (err instanceof CodeAgentGateRejectedError) {
        reply.status(403).send({ error: err.message, reason: err.cause });
      } else {
        codeAgentLogger.error('HTTP 提交失败', err instanceof Error ? err : new Error(String(err)));
        reply.status(500).send({ error: '内部错误' });
      }
    }
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

    await runner.cancel(id);
    reply.send({ canceled: id });
  });
}
