import { Agent, OpenAIProvider, Runner } from '@openai/agents';
import type {
  QqReplyAction,
  QqReplyAgentInput,
  QqReplyAgentPort,
  QqReplyAgentResult,
} from '../runtime';
import { parseQqReplyAction } from '../../platforms/qq/reply-action';
import { composeQqReplyPrompt } from '../prompt/reply';

/**
 * OpenAI QQ回复Agent配置
 *
 * 控制 Agents SDK 的展示名称、模型和单次回复超时时间。
 */
export interface OpenAiQqReplyAgentConfig {
  /** OpenAI API Key */
  readonly apiKey: string;
  /** OpenAI兼容服务地址 */
  readonly baseURL?: string;
  /** Agent展示名称 */
  readonly agentName: string;
  /** OpenAI模型名称 */
  readonly model: string;
  /** 回复超时毫秒 */
  readonly timeoutMs: number;
}

/**
 * OpenAI QQ回复Agent
 *
 * 使用 OpenAI Agents SDK 生成叶猫猫身份回复。
 * 通过结构化 JSON 接收受控 QQ 动作，不允许模型直接调用 NapCat。
 */
export class OpenAiQqReplyAgent implements QqReplyAgentPort {
  private readonly runner: Runner;

  constructor(private readonly config: OpenAiQqReplyAgentConfig) {
    const modelProvider = new OpenAIProvider({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.runner = new Runner({ modelProvider });
  }

  /**
   * 调用OpenAI Agent生成回复
   * @param input 标准消息事件
   * @returns 模型回复文本
   */
  async generateReply(input: QqReplyAgentInput): Promise<QqReplyAgentResult> {
    const prompt = composeQqReplyPrompt({
      agentName: this.config.agentName,
      event: input.event,
      skills: input.skills,
    });
    const agent = new Agent({
      name: this.config.agentName,
      model: this.config.model,
      instructions: prompt.instructions,
    });
    const result = await withTimeout(this.runner.run(agent, prompt.input), this.config.timeoutMs);
    const text = String(result.finalOutput ?? '').trim();
    if (text.length === 0) throw new Error('OpenAI Agent 返回空回复');

    return parseQqReplyAgentResult(text);
  }
}

// 优先解析结构化动作，解析失败时兼容旧纯文本回复。
export function parseQqReplyAgentResult(rawOutput: string): QqReplyAgentResult {
  try {
    const parsed = JSON.parse(rawOutput) as unknown;
    const result = toQqReplyAgentResult(parsed);
    if (result) return result;
  } catch {
    return { text: rawOutput };
  }

  return { text: rawOutput };
}

// 将模型 JSON 收敛为受控结果。
function toQqReplyAgentResult(input: unknown): QqReplyAgentResult | undefined {
  if (!isRecord(input)) return undefined;

  const text = typeof input.text === 'string' ? input.text.trim() : undefined;
  const actions = Array.isArray(input.actions)
    ? input.actions
        .map(parseQqReplyAction)
        .filter((action): action is QqReplyAction => Boolean(action))
    : undefined;

  if (!text && (!actions || actions.length === 0)) return undefined;
  return { text: text || undefined, actions };
}

// 判断普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

// 为 Agent 调用增加外层超时，超时后由 Safe Agent 接管降级。
async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutTask = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`OpenAI Agent 回复超过 ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutTask]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
