/**
 * Code Agent 任务提交契约
 *
 * 调用方（control-plane / agent-runtime）通过此结构向 LM 提交 Code Agent 任务。
 * prompt 恒经子进程 stdin 传递，不进入 argv（规避 Windows 32KB 预算限制）。
 */

/** 任务来源（门禁 Hook 的准入判断依据） */
export type CodeAgentTaskSource = 'control-plane' | 'agent-runtime';

/** 超时覆盖（优先级：task > AgentDef > env） */
export interface CodeAgentTimeoutOverrides {
  readonly sessionMs?: number;
  readonly inactivityMs?: number;
}

/** 任务提交契约 */
export interface CodeAgentTask {
  /** 目标 agent 标识（调用方显式指定，不自动路由） */
  readonly agentId: string;
  /** 任务提示词（恒经 stdin 传递） */
  readonly prompt: string;
  /** 工作目录（调用方负责创建和清理；llm 校验存在性且必须位于 CODE_AGENT_WORKSPACE_ROOT 下） */
  readonly workdir: string;
  /** 透传给 CLI 的模型名称 */
  readonly model?: string;
  /** 附加约束指令（拼接到 prompt 尾部） */
  readonly extraInstructions?: string;
  /** 超时覆盖（不设则走 AgentDef 默认，再不设走 env 全局） */
  readonly timeoutOverrides?: CodeAgentTimeoutOverrides;
  /** 调用来源 */
  readonly source: CodeAgentTaskSource;
}
