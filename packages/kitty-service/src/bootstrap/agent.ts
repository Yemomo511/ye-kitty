import type { QqReplyAgentPort } from '../agent-runtime/runtime';
import type { ConversationHistoryPort } from '../agent-runtime/history-type';
import type { SkillRuntime } from '../agent-runtime/skills';
import { Agent, AgentAdapter } from '../agent-runtime/agent';
import type { CustomFaceCatalogService } from '../platforms/qq/faces';
import { FallbackQqReplyAgent } from '../agent-runtime/lm/fallback';
import { InMemoryConversationHistory } from '../agent-runtime/history';
import {
  BuiltinRuntimeToolExecutor,
  BuiltinRuntimeToolRegistry,
} from '../agent-runtime/tools/messages';
import {
  CompositeRuntimeToolExecutor,
  CompositeRuntimeToolRegistry,
  type RuntimeToolProvider,
} from '../agent-runtime/tools/composite';
import { SafeQqReplyAgent } from '../agent-runtime/safe';
import { LM } from '../agent-runtime/lm/lm';
import { ModelPool } from '../agent-runtime/lm/pool';
import { loadModelPoolConfig } from '../agent-runtime/lm/config';
import { OpenAIModel } from '../agent-runtime/lm/openai';
import type { ModelNodeConfig } from '../agent-runtime/lm/model';
import type { CodeAgentRunner } from '../agent-runtime/lm/code-agent/runner';
import { CodeTool } from '../agent-runtime/tools/code';

/** Agent 单次运行默认最大轮次 */
export const DEFAULT_AGENT_MAX_TURNS = 100;

/**
 * QQ回复Agent运行配置
 *
 * 由环境变量读取，决定是否启用 OpenAI Agents SDK。
 */
export interface QqReplyAgentRuntimeConfig {
  /** OpenAI API Key是否存在 */
  readonly openAiApiKey?: string;
  /** OpenAI兼容服务地址 */
  readonly openAiBaseUrl?: string;
  /** OpenAI模型名称 */
  readonly agentModel: string;
  /** Agent展示名称 */
  readonly agentName: string;
  /** 回复超时毫秒 */
  readonly replyTimeoutMs: number;
  /** Agent模型池节点 */
  readonly modelPoolNodes: readonly ModelNodeConfig[];
}

/** QQ回复Agent创建依赖 */
export interface QqReplyAgentRuntimeDependencies {
  /** 共享会话历史 */
  readonly conversationHistory?: ConversationHistoryPort;
  /** 自定义表情目录 */
  readonly customFaceCatalog?: CustomFaceCatalogService;
  /** 外部运行时工具来源 */
  readonly runtimeToolProviders?: readonly RuntimeToolProvider[];
  /** 可选Code Agent运行能力，注入后作为统一Tool注册。 */
  readonly codeAgent?: CodeAgentRunner;
}

/**
 * 创建QQ回复Agent
 * @param config 运行配置
 * @param skillRuntime Skill渐进读取入口
 * @returns 回复Agent
 */
export function createQqReplyAgent(
  config: QqReplyAgentRuntimeConfig,
  skillRuntime?: SkillRuntime,
  dependencies: QqReplyAgentRuntimeDependencies = {},
): QqReplyAgentPort {
  const fallbackAgent = new FallbackQqReplyAgent();
  if (config.modelPoolNodes.length === 0) return fallbackAgent;

  const conversationHistory = dependencies.conversationHistory ?? new InMemoryConversationHistory();
  const toolDependencies = { customFaceCatalog: dependencies.customFaceCatalog };
  const builtinProvider: RuntimeToolProvider = {
    registry: new BuiltinRuntimeToolRegistry(toolDependencies),
    executor: new BuiltinRuntimeToolExecutor(conversationHistory, toolDependencies),
  };
  const toolProviders = [builtinProvider, ...(dependencies.runtimeToolProviders ?? [])];
  const toolRegistry = new CompositeRuntimeToolRegistry(toolProviders);
  const toolExecutor = new CompositeRuntimeToolExecutor(toolProviders);
  const modelPool = new ModelPool(config.modelPoolNodes, new OpenAIModel());
  const lm = new LM(
    {
      agentName: config.agentName,
      timeoutMs: config.replyTimeoutMs,
    },
    modelPool,
  );
  const agent = new Agent(
    lm,
    toolRegistry,
    toolExecutor,
    conversationHistory,
    skillRuntime ? { loadSkillContent: async (name) => await skillRuntime.load(name) } : undefined,
    skillRuntime
      ? {
          loadSkillReference: async (skill, reference) =>
            await skillRuntime.loadReference(skill, reference),
        }
      : undefined,
    fallbackAgent,
    {
      maxTurns: DEFAULT_AGENT_MAX_TURNS,
      maxToolCalls: 3,
      maxSkillReferences: 3,
      tools: dependencies.codeAgent ? [new CodeTool(dependencies.codeAgent)] : [],
    },
  );

  return new SafeQqReplyAgent(new AgentAdapter(agent), fallbackAgent);
}

/**
 * 读取QQ回复Agent配置
 * @param env 环境变量
 * @returns 运行配置
 */
export function loadQqReplyAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): QqReplyAgentRuntimeConfig {
  const modelPoolNodes = loadModelPoolConfig(env);
  return {
    openAiApiKey: normalizeOptionalValue(env.OPENAI_API_KEY),
    openAiBaseUrl: normalizeOptionalValue(env.OPENAI_BASE_URL),
    agentModel: normalizeOptionalValue(env.YE_KITTY_AGENT_MODEL) ?? 'gpt-4.1-mini',
    agentName: normalizeOptionalValue(env.YE_KITTY_AGENT_NAME) ?? '叶猫猫',
    replyTimeoutMs: readPositiveInteger(env.YE_KITTY_AGENT_REPLY_TIMEOUT_MS, 30000),
    modelPoolNodes,
  };
}

// 空字符串按未配置处理。
function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

// 读取正整数配置，避免超时被配置为不可用值。
function readPositiveInteger(rawValue: string | undefined, defaultValue: number): number {
  const value = Number(rawValue ?? defaultValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('YE_KITTY_AGENT_REPLY_TIMEOUT_MS 必须是正整数');
  }

  return value;
}
