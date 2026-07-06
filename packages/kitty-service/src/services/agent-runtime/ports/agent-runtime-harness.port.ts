import type { QqReplyAction } from './qq-reply-agent.port';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SkillContent } from '../domain/skill';

/**
 * Harness运行输入
 *
 * 调用方只提供平台事件和已命中的 Skill，循环细节由 Harness 接管。
 */
export interface AgentRuntimeRunInput {
  /** QQ标准消息 */
  readonly event: ChatEventContract;
  /** 本轮启用Skill */
  readonly skills?: readonly SkillContent[];
}

/**
 * Harness运行结果
 *
 * MVP 结果仍可适配旧 QQ 回复端口。
 */
export type AgentRuntimeRunResult =
  | {
      /** 结果类型 */
      readonly type: 'reply';
      /** 回复文本 */
      readonly text?: string;
      /** 受控动作 */
      readonly actions?: readonly QqReplyAction[];
      /** 运行追踪ID */
      readonly traceId: string;
    }
  | {
      /** 结果类型 */
      readonly type: 'ignore';
      /** 静默原因 */
      readonly reason: string;
      /** 运行追踪ID */
      readonly traceId: string;
    }
  | {
      /** 结果类型 */
      readonly type: 'human_review';
      /** 审核原因 */
      readonly reason: string;
      /** 运行追踪ID */
      readonly traceId: string;
    };

/**
 * Agent Runtime Harness端口
 *
 * 对外暴露一次可审计 Agent 循环，不暴露底层模型或工具实现。
 */
export interface AgentRuntimeHarnessPort {
  /**
   * 运行Harness循环
   * @param input 平台事件和Skill
   * @returns 最终决策
   */
  run(input: AgentRuntimeRunInput): Promise<AgentRuntimeRunResult>;
}
