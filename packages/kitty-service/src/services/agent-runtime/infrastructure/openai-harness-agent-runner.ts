import type { AgentDecision } from '../domain/agent-decision';
import type { AgentObservation } from '../domain/agent-observation';
import type { QqReplyAction } from '../ports/qq-reply-agent.port';
import { parseQqReplyAction } from '../domain/qq-reply-action';
import type { AgentRunnerPort } from '../ports/agent-runner.port';
import type { ModelRequestPoolPort, ModelRequestPriority } from '../ports/model-request-pool.port';
import { composeAgentPrompt } from '../../../agent-runtime/prompt/composer';
import { normalizeAgentAction, type AgentAction } from '../../../agent-runtime/action';

/**
 * OpenAI Harness Runner配置
 *
 * 控制Agent展示名称和单次决策超时。
 */
export interface OpenAiHarnessAgentRunnerConfig {
  /** Agent展示名称 */
  readonly agentName: string;
  /** 单次决策超时毫秒 */
  readonly timeoutMs: number;
}

/**
 * OpenAI Harness Agent Runner
 *
 * 只负责让模型输出下一步结构化决策，工具执行权留在 Harness。
 */
export class OpenAiHarnessAgentRunner implements AgentRunnerPort {
  constructor(
    private readonly config: OpenAiHarnessAgentRunnerConfig,
    private readonly modelPool: ModelRequestPoolPort,
  ) {}

  /**
   * 输出下一步决策
   * @param observation Harness观察上下文
   * @returns 结构化决策
   */
  async decide(observation: AgentObservation): Promise<AgentDecision> {
    const prompt = composeAgentPrompt(this.config.agentName, observation);
    const result = await this.modelPool.runDecision({
      agentName: this.config.agentName,
      instructions: prompt.instructions,
      input: prompt.input,
      timeoutMs: this.config.timeoutMs,
      priority: toModelRequestPriority(observation),
      source: 'agent-runtime-harness',
    });
    return parseAgentDecision(result.text);
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
  const decision = toAgentDecision(parsed) ?? toLegacyDecision(normalizeAgentAction(parsed));
  if (!decision) throw new Error('Agent 决策不符合协议');
  return decision;
}

// 将新 Action 临时适配给待迁移的旧循环，所有模型输出已先进入统一协议。
function toLegacyDecision(action: AgentAction): AgentDecision | undefined {
  if (action.type === 'tool') {
    if (action.name === 'skill' && isRecord(action.input)) {
      const skillName = typeof action.input.name === 'string' ? action.input.name.trim() : '';
      const referencePath =
        typeof action.input.reference === 'string' ? action.input.reference.trim() : '';
      if (!skillName) return undefined;
      if (referencePath) {
        return {
          type: 'skill_reference_call',
          skillName,
          referencePath,
          reason: action.reason,
        };
      }
      return {
        type: 'skill_call',
        skillName,
        input: action.input.input ?? {},
        reason: action.reason,
      };
    }
    return {
      type: 'tool_call',
      toolName: action.name,
      input: action.input,
      reason: action.reason,
    };
  }

  if (action.result === 'ignore') return { type: 'ignore', reason: action.reason };
  if (action.result === 'review') return { type: 'human_review', reason: action.reason };
  if (!isRecord(action.output)) return undefined;

  const text = typeof action.output.text === 'string' ? action.output.text.trim() : undefined;
  const actions = Array.isArray(action.output.actions)
    ? action.output.actions
        .map(parseQqReplyAction)
        .filter((item): item is QqReplyAction => Boolean(item))
    : undefined;
  if (!text && (!actions || actions.length === 0)) return undefined;
  return {
    type: 'reply',
    text: text || undefined,
    actions,
    reason: action.reason,
  };
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
          .map(parseQqReplyAction)
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

// 将聊天触发语义压缩为模型请求优先级。
function toModelRequestPriority(observation: AgentObservation): ModelRequestPriority {
  if (observation.event.conversationType === 'private') return 'high';
  if (observation.event.message.mentions.length > 0) return 'high';
  if (observation.replyIntent === 'required_group_reply') return 'low';
  return 'normal';
}
