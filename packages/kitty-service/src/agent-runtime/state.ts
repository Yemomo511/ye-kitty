import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { AgentMessage } from './message';
import type { PromptState } from './prompt/state';
import type { SkillContent, SkillMetadata } from './skills';
import type { Tool } from './tools';
import type { ToolExecutionResult } from '../services/agent-runtime/domain/tool';

/**
 * Agent观察上下文
 *
 * Agent 每一轮都用它约束模型只能基于当前事件、Skill、工具和工具结果做决策。
 */
export interface AgentContext {
  /** QQ标准消息 */
  readonly event: ChatEventContract;
  /** 本轮可请求的Skill目录 */
  readonly availableSkills: readonly SkillMetadata[];
  /** 已注入正文的Skill */
  readonly enabledSkills: readonly SkillContent[];
  /** 可见工具 */
  readonly tools: readonly Tool[];
  /** 工具结果 */
  readonly toolResults: readonly ToolExecutionResult[];
  /** 对话观察消息 */
  readonly conversationMessages: readonly AgentMessage[];
  /** Agent Prompt显式状态 */
  readonly promptState: PromptState;
  /** 本轮回复意图 */
  readonly replyIntent?: 'normal' | 'required_group_reply';
  /** 本轮必须调用的工具 */
  readonly requiredToolCalls?: readonly string[];
  /** 最近消息窗口提示 */
  readonly recentMessageLimitHint?: 100;
  /** 当前轮次 */
  readonly turnIndex: number;
  /** 最大轮次 */
  readonly maxTurns: number;
  /** 已调用工具次数 */
  readonly toolCallCount: number;
  /** 最大工具次数 */
  readonly maxToolCalls: number;
}
