import { runAgentEval } from './runner';

const summary = await runAgentEval();
if (!summary.skipped && summary.failed > 0) {
  process.exitCode = 1;
}
