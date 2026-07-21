import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { agentEvalCases } from './cases';
import { assertAgentAction, type AgentEvalCaseResult } from './assertions';
import { loadQqReplyAgentConfig } from '../src/services/agent-runtime';
import { LM } from '../src/agent-runtime/lm/lm';
import { ModelPool } from '../src/agent-runtime/lm/pool';
import { OpenAIModel } from '../src/agent-runtime/lm/openai';
import {
  reportCaseResult,
  reportEvalStart,
  reportEvalSummary,
  reportSkipped,
  type AgentEvalSummary,
} from './reporter';

/** 运行真实模型评估 */
export async function runAgentEval(): Promise<AgentEvalSummary> {
  loadNearestEnvFile();
  const config = loadQqReplyAgentConfig();

  if (config.modelPoolNodes.length === 0) {
    return reportSkipped('缺少模型池配置');
  }

  const lm = new LM(
    {
      agentName: config.agentName,
      timeoutMs: config.replyTimeoutMs,
    },
    new ModelPool(config.modelPoolNodes, new OpenAIModel()),
  );

  reportEvalStart(agentEvalCases.length);
  const results: AgentEvalCaseResult[] = [];
  for (const evalCase of agentEvalCases) {
    const result = await runEvalCase(lm, evalCase);
    results.push(result);
    reportCaseResult(result);
  }

  return reportEvalSummary(results);
}

async function runEvalCase(
  lm: LM,
  evalCase: (typeof agentEvalCases)[number],
): Promise<AgentEvalCaseResult> {
  try {
    const action = await lm.run(evalCase.observation);
    return assertAgentAction(evalCase, action);
  } catch (error) {
    return {
      case: evalCase,
      passed: false,
      errorMessage: formatError(error),
    };
  }
}

// 读取最近的 .env，保持 eval 与本地启动命令使用同一套模型配置。
function loadNearestEnvFile(): void {
  const envPath = findNearestFile(process.cwd(), '.env');
  if (!envPath) return;

  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) continue;

    const [key, value] = entry;
    process.env[key] ??= value;
  }
}

function findNearestFile(startDirectory: string, fileName: string): string | undefined {
  let currentDirectory = startDirectory;
  const rootDirectory = parse(startDirectory).root;

  while (true) {
    const candidate = join(currentDirectory, fileName);
    if (existsSync(candidate)) return candidate;
    if (currentDirectory === rootDirectory) return undefined;

    currentDirectory = dirname(currentDirectory);
  }
}

function parseEnvLine(line: string): readonly [string, string] | undefined {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) return undefined;

  const separatorIndex = trimmedLine.indexOf('=');
  if (separatorIndex < 1) return undefined;

  const key = trimmedLine.slice(0, separatorIndex).trim();
  const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
  return [key, unwrapEnvValue(rawValue)];
}

function unwrapEnvValue(rawValue: string): string {
  const quote = rawValue[0];
  const shouldUnwrap = (quote === '"' || quote === "'") && rawValue.endsWith(quote);
  if (!shouldUnwrap) return rawValue;
  return rawValue.slice(1, -1);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
