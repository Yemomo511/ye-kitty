import type { SkillContent, SkillMetadata } from '../skills';

/** 工具风险等级。 */
export type ToolRisk = 'low' | 'medium' | 'high';

/** 工具执行上下文。 */
export interface ToolContext {
  /** 单次调用ID */
  readonly callId: string;
  /** 取消信号 */
  readonly signal?: AbortSignal;
  /** 本轮允许Agent发现的Skill目录。 */
  readonly availableSkills?: readonly SkillMetadata[];
  /** 本轮已经加载到上下文的Skill正文。 */
  readonly enabledSkills?: readonly SkillContent[];
}

/** Schedule调用时提供的Agent运行上下文，调用ID由Action补充。 */
export type AgentToolContext = Omit<ToolContext, 'callId'>;

/** 工具原始执行结果。 */
export interface ToolResult {
  /** 是否成功 */
  readonly success: boolean;
  /** 可回灌模型的中文摘要 */
  readonly summary: string;
  /** 可选结构化数据 */
  readonly data?: unknown;
  /** 可选错误原因 */
  readonly error?: string;
  /** 是否建议重试 */
  readonly retryable?: boolean;
}

/**
 * Agent 工具定义
 *
 * 所有本地、平台、MCP、Skill 和 Code Agent 能力都必须实现该契约，
 * 由 Registry 发现并通过 Executor 执行。
 */
export interface Tool {
  /** 稳定工具名称 */
  readonly name: string;
  /** 中文能力说明 */
  readonly description: string;
  /** 风险等级 */
  readonly risk: ToolRisk;
  /** 输入结构说明 */
  readonly input: string;

  /**
   * 执行工具
   * @param input Agent 提供的结构化输入
   * @param context 调用上下文
   * @returns 原始工具结果
   */
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}
