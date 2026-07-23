import type { AgentResult } from '../src/agent-runtime';
import type { AgentEvalCase } from './cases';

/** 单条评估结果。 */
export interface AgentEvalCaseResult {
  /** 用例 */
  readonly case: AgentEvalCase;
  /** 是否通过 */
  readonly passed: boolean;
  /** 系统终态 */
  readonly result?: AgentResult;
  /** 已执行工具 */
  readonly calledTools: readonly string[];
  /** 失败原因 */
  readonly errorMessage?: string;
}

/** 校验Agent系统终态和必要工具事实。 */
export function assertAgentResult(
  evalCase: AgentEvalCase,
  result: AgentResult,
  calledTools: readonly string[],
): AgentEvalCaseResult {
  const errorMessage = findMismatch(evalCase, result, calledTools);
  return {
    case: evalCase,
    passed: !errorMessage,
    result,
    calledTools,
    errorMessage,
  };
}

function findMismatch(
  evalCase: AgentEvalCase,
  result: AgentResult,
  calledTools: readonly string[],
): string | undefined {
  if (result.type !== evalCase.expectation.result) {
    return `期望 result=${evalCase.expectation.result}，实际 result=${result.type}`;
  }
  if (result.type === 'reply' && result.text === 'EVAL_FALLBACK') {
    return '主Agent进入了降级路径';
  }
  const expectedTool = evalCase.expectation.tool;
  if (expectedTool && !calledTools.includes(expectedTool)) {
    return `期望调用 tool=${expectedTool}，实际调用=${calledTools.join(',') || '无'}`;
  }
  return undefined;
}
