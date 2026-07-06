import type { AgentDecision } from '../src/services/agent-runtime';
import type { AgentEvalCase, AgentEvalExpectation } from './cases';

/** 单条评估结果 */
export interface AgentEvalCaseResult {
  /** 用例 */
  readonly case: AgentEvalCase;
  /** 是否通过 */
  readonly passed: boolean;
  /** 实际决策 */
  readonly decision?: AgentDecision;
  /** 失败原因 */
  readonly errorMessage?: string;
}

/** 校验模型决策 */
export function assertAgentDecision(
  evalCase: AgentEvalCase,
  decision: AgentDecision,
): AgentEvalCaseResult {
  const errorMessage = findDecisionMismatch(evalCase.expectation, decision);
  return {
    case: evalCase,
    passed: !errorMessage,
    decision,
    errorMessage,
  };
}

function findDecisionMismatch(
  expectation: AgentEvalExpectation,
  decision: AgentDecision,
): string | undefined {
  if (decision.type !== expectation.type) {
    return `期望 type=${expectation.type}，实际 type=${decision.type}`;
  }

  if (expectation.type === 'tool_call') {
    if (decision.type !== 'tool_call') return undefined;
    return decision.toolName === expectation.toolName
      ? undefined
      : `期望 toolName=${expectation.toolName}，实际 toolName=${decision.toolName}`;
  }

  if (expectation.type === 'skill_call') {
    if (decision.type !== 'skill_call') return undefined;
    return decision.skillName === expectation.skillName
      ? undefined
      : `期望 skillName=${expectation.skillName}，实际 skillName=${decision.skillName}`;
  }

  if (expectation.type === 'skill_reference_call') {
    if (decision.type !== 'skill_reference_call') return undefined;
    if (decision.skillName !== expectation.skillName) {
      return `期望 skillName=${expectation.skillName}，实际 skillName=${decision.skillName}`;
    }
    return decision.referencePath === expectation.referencePath
      ? undefined
      : `期望 referencePath=${expectation.referencePath}，实际 referencePath=${decision.referencePath}`;
  }

  return undefined;
}
