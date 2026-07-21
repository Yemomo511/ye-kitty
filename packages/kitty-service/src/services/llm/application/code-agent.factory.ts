/**
 * Code Agent 组合根
 *
 * 对齐 qq-reply-agent.factory.ts 的手写 factory 模式。
 * 负责装配 orchestrator + gate hooks + 注册表端口，
 * 调用方（bootstrap）通过此函数获得完整运行时。
 */

import { CodeAgentOrchestrator } from './code-agent-orchestrator.service';
import { CodeAgentGateService, type CodeAgentGateHook } from './code-agent-gate.service';
import { listAgents, getAgent as getAgentFromRegistry, refreshCapabilities } from '../infrastructure/code-agent-registry';
import type { CodeAgentRunnerPort } from '../ports/code-agent-runner.port';
import type { CodeAgentRegistryPort } from '../ports/code-agent-registry.port';

/** 创建完整的 code agent 运行时 */
export function createCodeAgentRuntime(config: {
  /** CODE_AGENT_WORKSPACE_ROOT，未设则取 env 或退入 ./data/code-agent-workspaces */
  workspaceRoot?: string;
  /** 额外门禁 Hook（如 risk 服务实现） */
  extraHooks?: CodeAgentGateHook[];
}): { runner: CodeAgentRunnerPort; registry: CodeAgentRegistryPort; shutdown: () => Promise<void> } {
  const workspaceRoot = config.workspaceRoot
    ?? process.env['CODE_AGENT_WORKSPACE_ROOT']
    ?? './data/code-agent-workspaces';

  const gate = new CodeAgentGateService(workspaceRoot);

  // 注入额外 Hook
  if (config.extraHooks) {
    for (const hook of config.extraHooks) {
      gate.registerHook(hook);
    }
  }

  const orchestrator = new CodeAgentOrchestrator(gate);

  const registry: CodeAgentRegistryPort = {
    listAgents: () => listAgents(),
    getAgent: (id) => getAgentFromRegistry(id),
    refresh: () => refreshCapabilities().then(() => {}),
  };

  return {
    runner: orchestrator,
    registry,
    shutdown: () => orchestrator.shutdown(),
  };
}
