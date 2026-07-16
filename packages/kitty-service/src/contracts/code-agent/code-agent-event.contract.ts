/**
 * Code Agent 统一事件契约
 *
 * 所有 agent CLI（Claude Code / Codex 等）的输出经 adapter 映射后，统一为此 11 种事件类型。
 * 消费方只依赖此 union，不感知具体 CLI 协议。
 */

/** 会话终端状态 */
export type SessionEndStatus = 'succeeded' | 'failed' | 'canceled';

/** 失败分类码 */
export type FailureCode =
  | 'spawn_failure'
  | 'auth_failure'
  | 'inactivity_timeout'
  | 'session_timeout'
  | 'process_exit'
  | 'protocol_mismatch'
  | 'workspace_failure'
  | 'pipe_broken'
  | 'queue_timeout';

/** 结构化失败信息 */
export interface CodeAgentFailureContract {
  readonly code: FailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly detail?: string;
}

/** 会话状态事件 */
export interface CodeAgentStatusEvent {
  readonly type: 'status';
  readonly sessionId: string;
  readonly label: string;
  readonly model?: string;
}

/** 文本增量事件 */
export interface CodeAgentTextDeltaEvent {
  readonly type: 'text_delta';
  readonly sessionId: string;
  readonly delta: string;
}

/** 思考开始事件 */
export interface CodeAgentThinkingStartEvent {
  readonly type: 'thinking_start';
  readonly sessionId: string;
}

/** 思考增量事件 */
export interface CodeAgentThinkingDeltaEvent {
  readonly type: 'thinking_delta';
  readonly sessionId: string;
  readonly delta: string;
}

/** 工具调用事件 */
export interface CodeAgentToolUseEvent {
  readonly type: 'tool_use';
  readonly sessionId: string;
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** 工具调用参数增量事件 */
export interface CodeAgentToolInputDeltaEvent {
  readonly type: 'tool_input_delta';
  readonly sessionId: string;
  readonly id: string;
  readonly name: string;
  readonly delta: string;
}

/** 工具调用结果事件 */
export interface CodeAgentToolResultEvent {
  readonly type: 'tool_result';
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly content: string;
  readonly isError?: boolean;
}

/** 用量统计事件 */
export interface CodeAgentUsageEvent {
  readonly type: 'usage';
  readonly sessionId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd?: number;
  readonly durationMs: number;
}

/** 错误事件 */
export interface CodeAgentErrorEvent {
  readonly type: 'error';
  readonly sessionId: string;
  readonly failure: CodeAgentFailureContract;
}

/** 原始行兜底事件（adapter 无法解析的输出行不丢弃，走此类型透出） */
export interface CodeAgentRawEvent {
  readonly type: 'raw';
  readonly sessionId: string;
  readonly line: string;
}

/** 会话终止事件（消费者以此判断流结束） */
export interface CodeAgentSessionEndEvent {
  readonly type: 'session_end';
  readonly sessionId: string;
  readonly status: SessionEndStatus;
  readonly exitCode: number | null;
}

/** 统一事件联合（11 种） */
export type CodeAgentEventContract =
  | CodeAgentStatusEvent
  | CodeAgentTextDeltaEvent
  | CodeAgentThinkingStartEvent
  | CodeAgentThinkingDeltaEvent
  | CodeAgentToolUseEvent
  | CodeAgentToolInputDeltaEvent
  | CodeAgentToolResultEvent
  | CodeAgentUsageEvent
  | CodeAgentErrorEvent
  | CodeAgentRawEvent
  | CodeAgentSessionEndEvent;
