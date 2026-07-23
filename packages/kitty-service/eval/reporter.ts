import type { AgentEvalCaseResult } from './assertions';

/** Agent评估汇总 */
export interface AgentEvalSummary {
  /** 总数 */
  readonly total: number;
  /** 通过数 */
  readonly passed: number;
  /** 失败数 */
  readonly failed: number;
  /** 是否跳过 */
  readonly skipped: boolean;
}

/** 输出跳过报告 */
export function reportSkipped(reason: string): AgentEvalSummary {
  console.warn(`⚠️ [AgentEval] Agent评估测试已跳过：${reason}`);
  return { total: 0, passed: 0, failed: 0, skipped: true };
}

/** 输出开始报告 */
export function reportEvalStart(total: number): void {
  console.info(`🚧 [AgentEval] 开始运行Agent评估测试 total=${total}`);
}

/** 输出单条用例报告 */
export function reportCaseResult(result: AgentEvalCaseResult): void {
  const expectation = JSON.stringify(result.case.expectation);
  const actual = result.result ? JSON.stringify(result.result) : '无终态';
  const tools = result.calledTools.join(',') || '无';

  if (result.passed) {
    console.info(
      `✅ [AgentEval] 用例通过 name=${result.case.name} expectation=${expectation} result=${actual} tools=${tools}`,
    );
    return;
  }

  console.warn(
    `⚠️ [AgentEval] 用例失败 name=${result.case.name} input=${result.case.inputSummary} expectation=${expectation} result=${actual} tools=${tools} reason=${result.errorMessage ?? '未知原因'}`,
  );
}

/** 输出汇总报告 */
export function reportEvalSummary(results: readonly AgentEvalCaseResult[]): AgentEvalSummary {
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;
  const summary = { total: results.length, passed, failed, skipped: false };

  if (failed > 0) {
    console.warn(`⚠️ [AgentEval] Agent评估测试未通过 total=${results.length} failed=${failed}`);
    return summary;
  }

  console.info(`✅ [AgentEval] Agent评估测试已通过 total=${results.length}`);
  return summary;
}
