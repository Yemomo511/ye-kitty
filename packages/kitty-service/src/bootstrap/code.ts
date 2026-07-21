/**
 * Code Agent Bootstrap
 *
 * 装配入口：读 env → 孤儿清理 → factory → http-server → 返回 shutdown 钩子。
 * 由 scripts/start.ts 在 CODE_AGENT_API_KEY 存在时并行启动。
 */

import { loadNearestEnvFile } from './environment';
import { createCodeAgent } from '../agent-runtime/lm/code-agent';
import { startServer } from '../agent-runtime/lm/code-agent/server';
import { registerRoutes } from '../agent-runtime/lm/code-agent/routes';
import type { FastifyInstance } from 'fastify';
import { cleanupOrphans } from '../agent-runtime/lm/code-agent/process/session';
import { log } from '../agent-runtime/lm/code-agent/log';

/** 启动结果 */
export interface CodeAgentRuntime {
  /** 优雅关闭 */
  stop(): Promise<void>;
}

/**
 * 启动 code agent 运行时。
 *
 * 返回 undefined 表示未启动（API key 未配置或过短）。
 */
export async function startCodeAgentRuntime(): Promise<CodeAgentRuntime | undefined> {
  // 加载 .env（start.ts 中 code-agent 在平台脚本之前启动，.env 尚未加载）
  loadNearestEnvFile(process.cwd(), process.env);

  // 孤儿清理
  cleanupOrphans();

  const apiKey = process.env['CODE_AGENT_API_KEY']?.trim();
  if (!apiKey) {
    log.info('CODE_AGENT_API_KEY 未设置，code agent 运行时跳过');
    return undefined;
  }

  const { runner, registry, shutdown } = createCodeAgent({});

  let httpApp: FastifyInstance | undefined;
  try {
    httpApp = await startServer(apiKey, (app) => {
      registerRoutes(app, runner, registry);
    });
  } catch (err) {
    log.error('Code Agent API 启动失败', err instanceof Error ? err : new Error(String(err)));
    // http 启动失败不阻止整体启动（runner 仍可用 in-process）
  }

  return {
    async stop() {
      if (httpApp) {
        await httpApp.close();
        log.info('Code Agent API 已关闭');
      }
      await shutdown();
    },
  };
}
