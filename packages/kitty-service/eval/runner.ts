import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { z } from 'zod';
import { Agent } from '../src/agent-runtime/agent';
import { InMemoryConversationHistory } from '../src/agent-runtime/history';
import { LM } from '../src/agent-runtime/lm/lm';
import { ModelPool } from '../src/agent-runtime/lm/pool';
import { OpenAIModel } from '../src/agent-runtime/lm/openai';
import type { SkillContent } from '../src/agent-runtime/skills';
import { Tool, type ToolSource } from '../src/agent-runtime/tools';
import { loadQqReplyAgentConfig } from '../src/bootstrap/agent';
import { assertAgentResult, type AgentEvalCaseResult } from './assertions';
import { agentEvalCases, type AgentEvalCase } from './cases';
import {
  reportCaseResult,
  reportEvalStart,
  reportEvalSummary,
  reportSkipped,
  type AgentEvalSummary,
} from './reporter';

/** 运行真实模型评估。 */
export async function runAgentEval(): Promise<AgentEvalSummary> {
  loadNearestEnvFile();
  const config = loadQqReplyAgentConfig();
  if (config.modelPoolNodes.length === 0) return reportSkipped('缺少模型池配置');

  const lm = new LM(
    { agentName: config.agentName, timeoutMs: config.replyTimeoutMs },
    new ModelPool(config.modelPoolNodes, new OpenAIModel()),
  );
  reportEvalStart(agentEvalCases.length);
  const results: AgentEvalCaseResult[] = [];
  for (const evalCase of agentEvalCases) {
    const result = await runEvalCase(lm, config.agentName, evalCase);
    results.push(result);
    reportCaseResult(result);
  }
  return reportEvalSummary(results);
}

async function runEvalCase(
  lm: LM,
  agentName: string,
  evalCase: AgentEvalCase,
): Promise<AgentEvalCaseResult> {
  const calledTools: string[] = [];
  try {
    const agent = new Agent({
      lm,
      agentName,
      conversationHistory: new InMemoryConversationHistory(),
      fallbackAgent: { generateReply: async () => ({ text: 'EVAL_FALLBACK' }) },
      skillRuntime: createEvalSkillRuntime(calledTools),
      toolSources:
        evalCase.expectation.tool === 'get_custom_faces'
          ? [createCustomFaceToolSource(calledTools)]
          : [],
      config: { maxTurns: 12, maxToolCalls: 3, maxSkillReferences: 3 },
    });
    const result = await agent.run({
      event: evalCase.event,
      availableSkills: evalCase.availableSkills,
      skills: evalCase.enabledSkills,
    });
    return assertAgentResult(evalCase, result, calledTools);
  } catch (error) {
    return {
      case: evalCase,
      passed: false,
      calledTools,
      errorMessage: formatError(error),
    };
  }
}

// 评估Skill读取器记录真实工具执行事实。
function createEvalSkillRuntime(calledTools: string[]) {
  return {
    load: async (name: string): Promise<SkillContent> => {
      calledTools.push('skill');
      return {
        metadata: {
          name,
          description: '评估聊天风格',
          rootPath: `eval://skills/${name}`,
        },
        body: '使用自然、简短的中文回复。',
      };
    },
    loadReference: async (skill: SkillContent, referencePath: string) => {
      calledTools.push('skill_reference');
      return {
        skill: skill.metadata,
        referencePath,
        absolutePath: `eval://skills/${skill.metadata.name}/references/${referencePath}`,
        content: '示例：好呀，那就这么说定啦。',
      };
    },
  };
}

// 自定义表情评估工具模拟启动期缓存，不授予任何平台执行权。
function createCustomFaceToolSource(calledTools: string[]): ToolSource {
  return {
    listTools: () => ({
      get_custom_faces: Tool.make({
        description: '读取本轮可用的QQ自定义表情目录。',
        parameters: z
          .object({
            query: z.string().optional(),
            limit: z.number().int().positive().optional(),
          })
          .strict(),
        policy: {
          source: 'builtin',
          risk: 'low',
          approval: 'never',
          timeoutMs: 1000,
        },
        execute: async () => {
          calledTools.push('get_custom_faces');
          return {
            success: true,
            summary: '找到一个适合友好聊天的猫猫表情。',
            data: [{ file: 'eval://face/cat.gif', content: '友好猫猫' }],
          };
        },
      }),
    }),
  };
}

// 读取最近的.env，保持eval与本地启动命令使用同一套模型配置。
function loadNearestEnvFile(): void {
  const envPath = findNearestFile(process.cwd(), '.env');
  if (!envPath) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (entry) process.env[entry[0]] ??= entry[1];
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
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return undefined;
  const separator = trimmed.indexOf('=');
  if (separator < 1) return undefined;
  const key = trimmed.slice(0, separator).trim();
  const raw = trimmed.slice(separator + 1).trim();
  const quote = raw[0];
  const value = (quote === '"' || quote === "'") && raw.endsWith(quote) ? raw.slice(1, -1) : raw;
  return [key, value];
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
