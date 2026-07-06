/**
 * 工具风险等级
 *
 * MVP 只执行 low 风险只读工具，保留等级字段用于后续治理。
 */
export type RuntimeToolRiskLevel = 'low' | 'medium' | 'high';

/**
 * 运行时工具定义
 *
 * 工具定义只描述能力，真实执行必须走 ToolExecutor。
 */
export interface RuntimeTool {
  /** 工具名称 */
  readonly name: string;
  /** 中文说明 */
  readonly description: string;
  /** 风险等级 */
  readonly riskLevel: RuntimeToolRiskLevel;
  /** 输入说明 */
  readonly inputSchemaDescription: string;
}

/**
 * 工具执行请求
 *
 * Harness 只把已通过基础治理的请求交给执行器。
 */
export interface RuntimeToolCall {
  /** 触发事件 */
  readonly event: ChatEventContract;
  /** 工具名称 */
  readonly toolName: string;
  /** 工具入参 */
  readonly input: unknown;
}

/**
 * 工具执行结果
 *
 * observation 是回灌给模型的中文摘要，避免暴露完整内部对象。
 */
export interface ToolExecutionResult {
  /** 工具名称 */
  readonly toolName: string;
  /** 是否成功 */
  readonly success: boolean;
  /** 中文观察摘要 */
  readonly observation: string;
  /** 结构化数据 */
  readonly structuredData?: unknown;
  /** 错误原因 */
  readonly errorMessage?: string;
}
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
