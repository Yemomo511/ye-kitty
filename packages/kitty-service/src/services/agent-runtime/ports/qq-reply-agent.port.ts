import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SkillContent, SkillMetadata } from '../domain/skill';
import type { QqReplyAction } from '../domain/qq-reply-action';

/**
 * QQ回复Agent输入
 *
 * 保留标准聊天事件本体，调用方无需理解底层模型或提示词结构。
 */
export interface QqReplyAgentInput {
  /** QQ标准消息事件 */
  readonly event: ChatEventContract;
  /** 兼容旧链路的已启用Skill正文 */
  readonly skills?: readonly SkillContent[];
  /** Harness主链路可请求的Skill目录 */
  readonly availableSkills?: readonly SkillMetadata[];
}

export type { QqReplyAction } from '../domain/qq-reply-action';

/**
 * QQ回复Agent结果
 *
 * 兼容旧的纯文本回复，也允许 Agent 返回受控互动动作。
 */
export interface QqReplyAgentResult {
  /** 回复文本 */
  readonly text?: string;
  /** 受控动作 */
  readonly actions?: readonly QqReplyAction[];
}

/**
 * QQ回复Agent端口
 *
 * Agent Runtime 对外暴露的最小能力边界。
 * 实现方可以接入 OpenAI Agents SDK、测试桩或降级策略。
 */
export interface QqReplyAgentPort {
  /**
   * 生成QQ回复
   * @param input 标准消息事件
   * @returns 回复文本或动作
   */
  generateReply(input: QqReplyAgentInput): Promise<QqReplyAgentResult>;
}
