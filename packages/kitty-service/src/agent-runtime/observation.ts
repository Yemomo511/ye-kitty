/** 工具调用回灌给 Agent 的统一状态。 */
export type ObservationStatus = 'success' | 'error' | 'denied' | 'review';

/**
 * Agent 工具观察
 *
 * Schedule 将工具成功、失败和权限结果统一为该结构，Agent 不读取具体
 * Tool、MCP、Skill 或 Code Agent 的内部返回类型。
 */
export interface Observation {
  /** 单次调用ID */
  readonly callId: string;
  /** 工具名称 */
  readonly tool: string;
  /** 观察状态 */
  readonly status: ObservationStatus;
  /** 可回灌模型的中文摘要 */
  readonly summary: string;
  /** 可选结构化数据 */
  readonly data?: unknown;
  /** 可选错误原因 */
  readonly error?: string;
  /** 是否建议重试 */
  readonly retryable?: boolean;
}
