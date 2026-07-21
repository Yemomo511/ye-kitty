/**
 * Control-Plane HTTP Server（最小）
 *
 * CODE_AGENT_API_KEY 为空则不启动。
 * 仅监听 127.0.0.1，Bearer 鉴权，服务 code-agent 调试与管理。
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { log } from './log';

/** 启动 control-plane HTTP 服务 */
export async function startServer(
  apiKey: string | undefined,
  registerRoutes: (app: FastifyInstance) => void,
): Promise<FastifyInstance | undefined> {
  if (!apiKey) {
    log.info('CODE_AGENT_API_KEY 未设置，control-plane HTTP 不启动');
    return undefined;
  }

  if (apiKey.length < 32) {
    log.warn('CODE_AGENT_API_KEY 过短（建议 ≥32 字符），control-plane 拒绝启动');
    return undefined;
  }

  const app = Fastify({ logger: false });

  // Bearer 鉴权中间件
  app.addHook('onRequest', async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== apiKey) {
      reply.status(401).send({ error: '未授权' });
    }
  });

  // 注册路由
  registerRoutes(app);

  // 仅监听 127.0.0.1
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as { port: number }).port;
  log.info(`control-plane HTTP 已启动 http://127.0.0.1:${port}`);

  return app;
}
