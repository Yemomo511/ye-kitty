import type { RuntimeToolCall, ToolExecutionResult } from './legacy';

/**
 * 工具执行端口
 *
 * 所有工具调用必须经过该端口，避免模型直接触发外部动作。
 */
export interface RuntimeToolExecutorPort {
  /**
   * 执行工具
   * @param call 工具调用
   * @returns 工具观察结果
   */
  execute(call: RuntimeToolCall): Promise<ToolExecutionResult>;
}
