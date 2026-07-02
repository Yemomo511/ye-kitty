import type { QqReplyAgentPort } from '../ports/qq-reply-agent.port';
import { FallbackQqReplyAgent } from './fallback-qq-reply.agent';
import { SafeQqReplyAgent } from './safe-qq-reply.agent';
import { OpenAiQqReplyAgent } from '../infrastructure/openai-qq-reply.agent';

/**
 * QQ回复Agent运行配置
 *
 * 由环境变量读取，决定是否启用 OpenAI Agents SDK。
 */
export interface QqReplyAgentRuntimeConfig {
  /** OpenAI API Key是否存在 */
  readonly openAiApiKey?: string;
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
 * @returns 回复Agent
 */
export function createQqReplyAgent(config: QqReplyAgentRuntimeConfig): QqReplyAgentPort {
  const fallbackAgent = new FallbackQqReplyAgent();
  if (!config.openAiApiKey) return fallbackAgent;

  const openAiAgent = new OpenAiQqReplyAgent({
    agentName: config.agentName,
    model: config.agentModel,
    timeoutMs: config.replyTimeoutMs,
  });

  return new SafeQqReplyAgent(openAiAgent, fallbackAgent);
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
