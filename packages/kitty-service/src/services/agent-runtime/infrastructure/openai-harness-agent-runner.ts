import { Agent, OpenAIProvider, Runner } from '@openai/agents';
import type { AgentDecision } from '../domain/agent-decision';
import type { AgentObservation } from '../domain/agent-observation';
import type { QqReplyAction } from '../ports/qq-reply-agent.port';
import type { AgentRunnerPort } from '../ports/agent-runner.port';
import { composeHarnessPrompt } from './prompt/harness.prompt';

/**
 * OpenAI Harness Runner配置
 *
 * 控制底层模型、兼容服务地址和单次决策超时。
 */
export interface OpenAiHarnessAgentRunnerConfig {
  /** OpenAI API Key */
  readonly apiKey: string;
  /** OpenAI兼容服务地址 */
  readonly baseURL?: string;
  /** Agent展示名称 */
  readonly agentName: string;
  /** OpenAI模型名称 */
  readonly model: string;
  /** 单次决策超时毫秒 */
  readonly timeoutMs: number;
}

/**
 * OpenAI Harness Agent Runner
 *
 * 只负责让模型输出下一步结构化决策，工具执行权留在 Harness。
 */
export class OpenAiHarnessAgentRunner implements AgentRunnerPort {
  private readonly runner: Runner;

  constructor(private readonly config: OpenAiHarnessAgentRunnerConfig) {
    const modelProvider = new OpenAIProvider({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.runner = new Runner({ modelProvider });
  }

  /**
   * 输出下一步决策
   * @param observation Harness观察上下文
   * @returns 结构化决策
   */
  async decide(observation: AgentObservation): Promise<AgentDecision> {
    const prompt = composeHarnessPrompt(this.config.agentName, observation);
    const agent = new Agent({
      name: this.config.agentName,
      model: this.config.model,
      instructions: prompt.instructions,
    });
    const result = await withTimeout(this.runner.run(agent, prompt.input), this.config.timeoutMs);
    return parseAgentDecision(String(result.finalOutput ?? '').trim());
  }
}

/**
 * 解析Agent决策
 * @param rawOutput 模型输出
 * @returns 结构化决策
 */
export function parseAgentDecision(rawOutput: string): AgentDecision {
  if (!rawOutput) throw new Error('Agent 返回空决策');

  const parsed = JSON.parse(stripCodeFence(rawOutput)) as unknown;
  const decision = toAgentDecision(parsed);
  if (!decision) throw new Error('Agent 决策不符合协议');
  return decision;
}

// 将未知 JSON 收敛为决策。
function toAgentDecision(input: unknown): AgentDecision | undefined {
  if (!isRecord(input) || typeof input.type !== 'string') return undefined;

  if (input.type === 'tool_call') {
    const toolName = typeof input.toolName === 'string' ? input.toolName.trim() : '';
    if (!toolName) return undefined;
    return {
      type: 'tool_call',
      toolName,
      input: isRecord(input.input) ? input.input : {},
      reason: readReason(input.reason),
    };
  }

  if (input.type === 'skill_call') {
    const skillName = typeof input.skillName === 'string' ? input.skillName.trim() : '';
    if (!skillName) return undefined;
    return {
      type: 'skill_call',
      skillName,
      input: isRecord(input.input) ? input.input : {},
      reason: readReason(input.reason),
    };
  }

  if (input.type === 'skill_reference_call') {
    const skillName = typeof input.skillName === 'string' ? input.skillName.trim() : '';
    const referencePath = typeof input.referencePath === 'string' ? input.referencePath.trim() : '';
    if (!skillName || !referencePath) return undefined;
    return {
      type: 'skill_reference_call',
      skillName,
      referencePath,
      reason: readReason(input.reason),
    };
  }

  if (input.type === 'reply') {
    const text = typeof input.text === 'string' ? input.text.trim() : undefined;
    const actions = Array.isArray(input.actions)
      ? input.actions
          .map(toQqReplyAction)
          .filter((action): action is QqReplyAction => Boolean(action))
      : undefined;
    if (!text && (!actions || actions.length === 0)) return undefined;
    return {
      type: 'reply',
      text: text || undefined,
      actions,
      reason: readReason(input.reason),
    };
  }

  if (input.type === 'ignore') {
    return { type: 'ignore', reason: readReason(input.reason) };
  }

  if (input.type === 'human_review') {
    return { type: 'human_review', reason: readReason(input.reason) };
  }

  return undefined;
}

// 校验QQ受控动作。
function toQqReplyAction(input: unknown): QqReplyAction | undefined {
  if (!isRecord(input) || typeof input.type !== 'string') return undefined;

  if (input.type === 'send_text' && typeof input.text === 'string' && input.text.trim()) {
    return { type: 'send_text', text: input.text.trim() };
  }

  if (input.type === 'send_face' && typeof input.faceId === 'string' && input.faceId.trim()) {
    return { type: 'send_face', faceId: input.faceId.trim() };
  }

  if (input.type === 'send_custom_image' && typeof input.file === 'string' && input.file.trim()) {
    return { type: 'send_custom_image', file: input.file.trim() };
  }

  if (input.type === 'poke_sender') {
    return { type: 'poke_sender' };
  }

  if (
    input.type === 'react_to_message' &&
    typeof input.emojiId === 'string' &&
    input.emojiId.trim()
  ) {
    return { type: 'react_to_message', emojiId: input.emojiId.trim() };
  }

  return undefined;
}

// 兼容模型偶尔包裹的代码块。
function stripCodeFence(rawOutput: string): string {
  const trimmed = rawOutput.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

// 读取决策原因。
function readReason(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '未说明';
}

// 判断普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

// 为单次模型决策增加超时。
async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutTask = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`OpenAI Agent 决策超过 ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutTask]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
