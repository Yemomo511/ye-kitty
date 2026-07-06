import type { AgentDecision } from '../domain/agent-decision';
import type { AgentObservation } from '../domain/agent-observation';

/**
 * Agent底层推理端口
 *
 * 实现方负责调用模型并返回结构化决策，不能在这里执行工具。
 */
export interface AgentRunnerPort {
  /**
   * 输出下一步决策
   * @param observation Harness观察上下文
   * @returns 结构化决策
   */
  decide(observation: AgentObservation): Promise<AgentDecision>;
}
