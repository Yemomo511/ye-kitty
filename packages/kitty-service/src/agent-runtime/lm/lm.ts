import type { AgentContext } from '../state';
import type { QqReplyAction } from '../runtime';
import { parseQqReplyAction } from '../../platforms/qq/reply-action';
import type { ModelPoolRunner, ModelRequestPriority } from './model';
import { composeAgentPrompt } from '../prompt/composer';
import { normalizeAgentAction, type AgentAction, type FinishAction } from '../action';

/**
 * LM运行配置
 *
 * 控制Agent展示名称和单次决策超时。
 */
export interface LMConfig {
  /** Agent展示名称 */
  readonly agentName: string;
  /** 单次决策超时毫秒 */
  readonly timeoutMs: number;
}

/** Agent 只依赖这一项最小语言模型能力。 */
export interface LMRunner {
  /** 根据当前上下文生成下一步 Action。 */
  run(observation: AgentContext): Promise<AgentAction>;
}

/**
 * Agent语言模型入口
 *
 * 持有模型池，只负责组织模型请求并输出下一步 Action，工具执行权留在 Agent Runtime。
 */
export class LM implements LMRunner {
  constructor(
    private readonly config: LMConfig,
    private readonly modelPool: ModelPoolRunner,
  ) {}

  /**
   * 输出下一步决策
   * @param observation Agent观察上下文
   * @returns 结构化决策
   */
  async run(observation: AgentContext): Promise<AgentAction> {
    const prompt = composeAgentPrompt(this.config.agentName, observation);
    const result = await this.modelPool.runDecision({
      agentName: this.config.agentName,
      instructions: prompt.instructions,
      input: prompt.input,
      timeoutMs: this.config.timeoutMs,
      priority: toModelRequestPriority(observation),
      source: 'agent-runtime',
    });
    return parseAgentAction(result.text);
  }
}

/**
 * 解析Agent决策
 * @param rawOutput 模型输出
 * @returns 结构化决策
 */
export function parseAgentAction(rawOutput: string): AgentAction {
  if (!rawOutput) throw new Error('Agent 返回空决策');

  const parsed = JSON.parse(stripCodeFence(rawOutput)) as unknown;
  return sanitizeFinishAction(normalizeAgentAction(parsed));
}

// 最终回复只保留平台执行层支持的受控动作。
function sanitizeFinishAction(action: AgentAction): AgentAction {
  if (action.type !== 'finish' || action.result !== 'reply' || !isRecord(action.output)) {
    return action;
  }
  const text = typeof action.output.text === 'string' ? action.output.text.trim() : undefined;
  const actions = Array.isArray(action.output.actions)
    ? action.output.actions
        .map(parseQqReplyAction)
        .filter((item): item is QqReplyAction => Boolean(item))
    : undefined;
  if (!text && (!actions || actions.length === 0)) throw new Error('Agent 回复内容为空');
  return {
    ...action,
    output: {
      ...(text ? { text } : {}),
      ...(actions && actions.length > 0 ? { actions } : {}),
    },
  } satisfies FinishAction;
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

// 判断普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

// 将聊天触发语义压缩为模型请求优先级。
function toModelRequestPriority(observation: AgentContext): ModelRequestPriority {
  if (observation.event.conversationType === 'private') return 'high';
  if (observation.event.message.mentions.length > 0) return 'high';
  if (observation.replyIntent === 'required_group_reply') return 'low';
  return 'normal';
}
