/**
 * Code Agent 组合根
 *
 * 负责装配 CodeAgent、Gate Hooks 与注册表，
 * 调用方（bootstrap）通过此函数获得完整运行时。
 */

import { CodeAgent } from './agent';
import { Gate, type GateHook } from './gate';
import { listAgents, getAgent as getAgentFromRegistry, refreshCapabilities } from './registry';
import type { CodeAgentRunner } from './runner';
import type { CodeAgentRegistry } from './registry';

/** 创建完整的 code agent 运行时 */
export function createCodeAgent(config: {
  /** CODE_AGENT_WORKSPACE_ROOT，未设则取 env 或退入 ./data/code-agent-workspaces */
  workspaceRoot?: string;
  /** 额外门禁 Hook（如 risk 服务实现） */
  extraHooks?: GateHook[];
}): { runner: CodeAgentRunner; registry: CodeAgentRegistry; shutdown: () => Promise<void> } {
  const workspaceRoot =
    config.workspaceRoot ??
    process.env['CODE_AGENT_WORKSPACE_ROOT'] ??
    './data/code-agent-workspaces';

  const gate = new Gate(workspaceRoot);

  // 注入额外 Hook
  if (config.extraHooks) {
    for (const hook of config.extraHooks) {
      gate.registerHook(hook);
    }
  }

  const orchestrator = new CodeAgent(gate);

  const registry: CodeAgentRegistry = {
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

export type { CodeAgentDefinition, StreamFormat } from './definition';
export * from './error';
export * from './event';
export { Gate, type GateHook } from './gate';
export { log } from './log';
export type { CodeAgentCapability, CodeAgentRegistry } from './registry';
export type { CodeAgentRunner } from './runner';
export type { CodeAgentSession, CodeAgentSessionStatus } from './session';
export type { CodeAgentTask, CodeAgentTaskSource, CodeAgentTimeoutOverrides } from './task';
