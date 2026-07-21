import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type {
  SkillContent,
  SkillMetadata,
  SkillReferenceContent,
} from '../../../agent-runtime/skills';
import type { ToolExecutionResult } from './tool';

/**
 * Agent对话消息
 *
 * Harness 用平台无关的消息列表承载运行观察，避免把 Skill 正文提升到系统指令层。
 */
export type AgentConversationMessage =
  | {
      /** 消息类型 */
      readonly type: 'user_event';
      /** 标准事件 */
      readonly event: ChatEventContract;
    }
  | {
      /** 消息类型 */
      readonly type: 'skill_catalog';
      /** 可见Skill目录 */
      readonly skills: readonly SkillMetadata[];
    }
  | {
      /** 消息类型 */
      readonly type: 'skill_content';
      /** 已启用Skill */
      readonly skill: SkillContent;
    }
  | {
      /** 消息类型 */
      readonly type: 'skill_reference';
      /** 引用内容 */
      readonly reference: SkillReferenceContent;
    }
  | {
      /** 消息类型 */
      readonly type: 'tool_result';
      /** 工具观察 */
      readonly result: ToolExecutionResult;
    }
  | {
      /** 消息类型 */
      readonly type: 'decision_error';
      /** 错误观察 */
      readonly observation: string;
      /** 错误原因 */
      readonly errorMessage?: string;
    };
