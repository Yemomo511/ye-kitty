/**
 * Code Agent Registry Port
 *
 * 查询本地可用的 code agent 及其能力信息。
 */

import type { CodeAgentCapability } from '../infrastructure/code-agent-registry';

export type { CodeAgentCapability };

export interface CodeAgentRegistryPort {
  /** 列出所有已注册 agent 的能力信息（含可用性、版本、诊断） */
  listAgents(): Promise<readonly CodeAgentCapability[]>;

  /** 按 id 查找单个 agent 的能力信息 */
  getAgent(id: string): Promise<CodeAgentCapability | undefined>;

  /** 重新探测本地 CLI 可用性（清除缓存） */
  refresh(): Promise<void>;
}
