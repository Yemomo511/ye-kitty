import { runAgentEval } from './runner';

try {
  const summary = await runAgentEval();
  if (!summary.skipped && summary.failed > 0) {
    console.warn(`⚠️ [AgentEval-Warn] Agent评估测试存在失败 caseCount=${summary.failed}`);
  }
} catch (error) {
  console.warn(`⚠️ [AgentEval-Warn] Agent评估测试运行异常 reason=${formatError(error)}`);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
