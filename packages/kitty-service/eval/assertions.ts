import type { AgentAction } from '../src/agent-runtime';
import type { AgentEvalCase, AgentEvalExpectation } from './cases';

/** 单条评估结果 */
export interface AgentEvalCaseResult {
  /** 用例 */
  readonly case: AgentEvalCase;
  /** 是否通过 */
  readonly passed: boolean;
  /** 实际Action */
  readonly action?: AgentAction;
  /** 失败原因 */
  readonly errorMessage?: string;
}

/** 校验模型Action */
export function assertAgentAction(
  evalCase: AgentEvalCase,
  action: AgentAction,
): AgentEvalCaseResult {
  const errorMessage = findActionMismatch(evalCase.expectation, action);
  return {
    case: evalCase,
    passed: !errorMessage,
    action,
    errorMessage,
  };
}

function findActionMismatch(
  expectation: AgentEvalExpectation,
  action: AgentAction,
): string | undefined {
  if (action.type !== expectation.type) {
    return `期望 type=${expectation.type}，实际 type=${action.type}`;
  }

  if (expectation.type === 'finish') {
    if (action.type !== 'finish') return undefined;
    return action.result === expectation.result
      ? undefined
      : `期望 result=${expectation.result}，实际 result=${action.result}`;
  }

  if (action.type !== 'tool') return undefined;
  if (action.name !== expectation.name) {
    return `期望 name=${expectation.name}，实际 name=${action.name}`;
  }

  if (expectation.skillName || expectation.reference) {
    const input = isRecord(action.input) ? action.input : {};
    if (expectation.skillName && input.name !== expectation.skillName) {
      return `期望 skillName=${expectation.skillName}，实际 skillName=${String(input.name)}`;
    }
    if (expectation.reference && input.reference !== expectation.reference) {
      return `期望 reference=${expectation.reference}，实际 reference=${String(input.reference)}`;
    }
  }

  return undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
