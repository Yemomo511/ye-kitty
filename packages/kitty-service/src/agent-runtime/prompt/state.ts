import type { AgentAction } from '../action';

/**
 * Prompt状态阶段
 *
 * 用显式阶段约束模型下一步行动，避免把状态隐含在对话消息列表中。
 */
export type PromptPhase =
  | 'initial_observe'
  | 'skill_loaded'
  | 'reference_loaded'
  | 'tool_observing'
  | 'ready_to_decide'
  | 'finalized'
  | 'fallback'
  | 'human_review';

/** Agent预算状态 */
export interface PromptBudgetState {
  /** 当前轮次 */
  readonly turnIndex: number;
  /** 最大轮次 */
  readonly maxTurns: number;
  /** 已调用工具次数 */
  readonly toolCallCount: number;
  /** 最大工具次数 */
  readonly maxToolCalls: number;
  /** 已读取Skill引用数 */
  readonly skillReferenceCount: number;
  /** 最大Skill引用数 */
  readonly maxSkillReferences: number;
  /** 模型决策错误次数 */
  readonly decisionErrorCount: number;
}

/** Agent上下文状态 */
export interface PromptContextState {
  /** 可请求Skill名称 */
  readonly availableSkillNames: readonly string[];
  /** 已注入Skill名称 */
  readonly enabledSkillNames: readonly string[];
  /** 已读取引用键 */
  readonly loadedReferenceKeys: readonly string[];
  /** 当前可见工具 */
  readonly visibleToolNames: readonly string[];
  /** 最近观察摘要 */
  readonly latestObservation: string;
}

/** Agent历史Action */
export interface PromptHistoryItem {
  /** 发生轮次 */
  readonly turnIndex: number;
  /** 决策类型 */
  readonly actionType: AgentAction['type'];
  /** 决策目标 */
  readonly target?: string;
  /** 是否成功 */
  readonly success?: boolean;
  /** 决策原因 */
  readonly reason: string;
}

/**
 * Prompt显式状态
 *
 * Agent负责维护真实状态，Prompt只渲染这个快照给模型参考。
 */
export interface PromptState {
  /** 追踪ID */
  readonly traceId: string;
  /** 当前阶段 */
  readonly phase: PromptPhase;
  /** 预算状态 */
  readonly budget: PromptBudgetState;
  /** 上下文状态 */
  readonly context: PromptContextState;
  /** 决策历史 */
  readonly actionHistory: readonly PromptHistoryItem[];
}
