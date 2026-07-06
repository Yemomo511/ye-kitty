import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SkillContent } from '../domain/skill';

/**
 * QQ回复Agent输入
 *
 * 保留标准聊天事件本体，调用方无需理解底层模型或提示词结构。
 */
export interface QqReplyAgentInput {
  /** QQ标准消息事件 */
  readonly event: ChatEventContract;
  /** 本轮启用Skill */
  readonly skills?: readonly SkillContent[];
}

/**
 * QQ回复Agent结果
 *
 * 第一版只返回可直接发送到 QQ 的纯文本。
 */
export interface QqReplyAgentResult {
  /** 回复文本 */
  readonly text: string;
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
   * @returns 回复文本
   */
  generateReply(input: QqReplyAgentInput): Promise<QqReplyAgentResult>;
}
