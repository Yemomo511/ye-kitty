import type { QqReplyAgentPort } from '../ports/qq-reply-agent.port';
import type { SkillContentLoaderPort } from '../ports/skill-content-loader.port';
import type { SkillReferenceLoaderPort } from '../ports/skill-reference-loader.port';
import { AgentRuntimeHarness, HarnessQqReplyAgentAdapter } from './agent-runtime-harness';
import { FallbackQqReplyAgent } from './fallback-qq-reply.agent';
import { InMemoryConversationHistory } from './in-memory-conversation-history';
import { BuiltinRuntimeToolExecutor, BuiltinRuntimeToolRegistry } from './runtime-tools';
import { SafeQqReplyAgent } from './safe-qq-reply.agent';
import { OpenAiHarnessAgentRunner } from '../infrastructure/openai-harness-agent-runner';

/** Harness 单次运行默认最大轮次 */
export const DEFAULT_HARNESS_MAX_TURNS = 100;

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
}

/**
 * 创建QQ回复Agent
 * @param config 运行配置
 * @param skillContentLoader Skill正文加载器
 * @returns 回复Agent
 */
export function createQqReplyAgent(
  config: QqReplyAgentRuntimeConfig,
  skillContentLoader?: SkillContentLoaderPort & Partial<SkillReferenceLoaderPort>,
): QqReplyAgentPort {
  const fallbackAgent = new FallbackQqReplyAgent();
  if (!config.openAiApiKey) return fallbackAgent;

  const conversationHistory = new InMemoryConversationHistory();
  const toolRegistry = new BuiltinRuntimeToolRegistry();
  const toolExecutor = new BuiltinRuntimeToolExecutor(conversationHistory);
  const runner = new OpenAiHarnessAgentRunner({
    apiKey: config.openAiApiKey,
    baseURL: config.openAiBaseUrl,
    agentName: config.agentName,
    model: config.agentModel,
    timeoutMs: config.replyTimeoutMs,
  });
  const harness = new AgentRuntimeHarness(
    runner,
    toolRegistry,
    toolExecutor,
    conversationHistory,
    skillContentLoader,
    skillContentLoader?.loadSkillReference
      ? (skillContentLoader as SkillReferenceLoaderPort)
      : undefined,
    fallbackAgent,
    {
      maxTurns: DEFAULT_HARNESS_MAX_TURNS,
      maxToolCalls: 3,
      maxSkillReferences: 3,
    },
  );

  return new SafeQqReplyAgent(new HarnessQqReplyAgentAdapter(harness), fallbackAgent);
}

/**
 * 读取QQ回复Agent配置
 * @param env 环境变量
 * @returns 运行配置
 */
export function loadQqReplyAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): QqReplyAgentRuntimeConfig {
  return {
    openAiApiKey: normalizeOptionalValue(env.OPENAI_API_KEY),
    openAiBaseUrl: normalizeOptionalValue(env.OPENAI_BASE_URL),
    agentModel: normalizeOptionalValue(env.YE_KITTY_AGENT_MODEL) ?? 'gpt-4.1-mini',
    agentName: normalizeOptionalValue(env.YE_KITTY_AGENT_NAME) ?? '叶猫猫',
    replyTimeoutMs: readPositiveInteger(env.YE_KITTY_AGENT_REPLY_TIMEOUT_MS, 30000),
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
