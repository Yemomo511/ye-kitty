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
 * QQ回复动作
 *
 * Agent 只能声明这些安全动作，真正的 NapCat 调用由 QQ 平台动作层执行。
 */
export type QqReplyAction =
  | {
      /** 动作类型 */
      readonly type: 'send_text';
      /** 回复文本 */
      readonly text: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'send_face';
      /** QQ商城表情ID */
      readonly faceId: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'send_custom_image';
      /** 图片文件或URL */
      readonly file: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'poke_sender';
    }
  | {
      /** 动作类型 */
      readonly type: 'react_to_message';
      /** 表情ID */
      readonly emojiId: string;
    };

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
