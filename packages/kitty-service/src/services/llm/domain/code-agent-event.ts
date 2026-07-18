/**
 * Code Agent 事件领域对象
 *
 * 从 contracts/code-agent 的纯 DTO 衍生，增加类型守卫函数。
 */

import type { CodeAgentEventContract } from '@kitty/contracts/code-agent/code-agent-event.contract';

export type {
  CodeAgentEventContract,
  CodeAgentStatusEvent,
  CodeAgentTextDeltaEvent,
  CodeAgentThinkingStartEvent,
  CodeAgentThinkingDeltaEvent,
  CodeAgentToolUseEvent,
  CodeAgentToolInputDeltaEvent,
  CodeAgentToolResultEvent,
  CodeAgentUsageEvent,
  CodeAgentErrorEvent,
  CodeAgentRawEvent,
  CodeAgentSessionEndEvent,
  SessionEndStatus,
  CodeAgentFailureContract,
} from '@kitty/contracts/code-agent/code-agent-event.contract';

/** 判断是否为终端事件 */
export function isSessionEndEvent(
  event: CodeAgentEventContract,
): event is { type: 'session_end'; sessionId: string; status: 'succeeded' | 'failed' | 'canceled'; exitCode: number | null } {
  return event.type === 'session_end';
}

/** 判断是否为工具调用事件 */
export function isToolUseEvent(
  event: CodeAgentEventContract,
): event is { type: 'tool_use'; sessionId: string; id: string; name: string; input: unknown } {
  return event.type === 'tool_use';
}

/** 判断是否为错误事件 */
export function isErrorEvent(
  event: CodeAgentEventContract,
): event is { type: 'error'; sessionId: string; failure: import('@kitty/contracts/code-agent/code-agent-event.contract').CodeAgentFailureContract } {
  return event.type === 'error';
}
