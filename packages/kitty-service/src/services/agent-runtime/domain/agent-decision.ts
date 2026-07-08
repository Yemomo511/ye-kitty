import type { QqReplyAction } from '../ports/qq-reply-agent.port';

/**
 * Agent结构化决策
 *
 * Harness 只接受这些决策类型，模型不能直接执行工具或平台动作。
 */
export type AgentDecision =
  | {
      /** 决策类型 */
      readonly type: 'tool_call';
      /** 工具名称 */
      readonly toolName: string;
      /** 工具入参 */
      readonly input: unknown;
      /** 调用原因 */
      readonly reason: string;
    }
  | {
      /** 决策类型 */
      readonly type: 'skill_call';
      /** Skill名称 */
      readonly skillName: string;
      /** Skill输入 */
      readonly input: unknown;
      /** 调用目标 */
      readonly reason: string;
    }
  | {
      /** 决策类型 */
      readonly type: 'skill_reference_call';
      /** Skill名称 */
      readonly skillName: string;
      /** 引用路径 */
      readonly referencePath: string;
      /** 调用原因 */
      readonly reason: string;
    }
  | {
      /** 决策类型 */
      readonly type: 'reply';
      /** 回复文本 */
      readonly text?: string;
      /** 受控动作 */
      readonly actions?: readonly QqReplyAction[];
      /** 决策原因 */
      readonly reason: string;
    }
  | {
      /** 决策类型 */
      readonly type: 'ignore';
      /** 静默原因 */
      readonly reason: string;
    }
  | {
      /** 决策类型 */
      readonly type: 'human_review';
      /** 审核原因 */
      readonly reason: string;
    };

/**
 * 判断模型决策是否已经结束循环
 * @param decision 模型决策
 * @returns 是否最终决策
 */
export function isFinalAgentDecision(
  decision: AgentDecision,
): decision is Exclude<
  AgentDecision,
  | { readonly type: 'tool_call' }
  | { readonly type: 'skill_call' }
  | { readonly type: 'skill_reference_call' }
> {
  return (
    decision.type === 'reply' || decision.type === 'ignore' || decision.type === 'human_review'
  );
}
