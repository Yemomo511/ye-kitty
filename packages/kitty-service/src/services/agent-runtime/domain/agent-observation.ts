import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SkillContent } from './skill';
import type { RuntimeTool, ToolExecutionResult } from './tool';

/**
 * Agent观察上下文
 *
 * Harness 每一轮都用它约束模型只能基于当前事件、Skill、工具和工具结果做决策。
 */
export interface AgentObservation {
  /** QQ标准消息 */
  readonly event: ChatEventContract;
  /** 本轮启用Skill */
  readonly skills: readonly SkillContent[];
  /** 可见工具 */
  readonly tools: readonly RuntimeTool[];
  /** 工具结果 */
  readonly toolResults: readonly ToolExecutionResult[];
  /** 当前轮次 */
  readonly turnIndex: number;
  /** 最大轮次 */
  readonly maxTurns: number;
  /** 已调用工具次数 */
  readonly toolCallCount: number;
  /** 最大工具次数 */
  readonly maxToolCalls: number;
}
