import { Agent, OpenAIProvider, Runner, user } from '@openai/agents';
import type { QqCustomFaceResource } from '@kitty/platforms/qq/infrastructure/api';
import type { CustomFaceDescription } from '../domain/custom-face';
import type { CustomFaceVisionAgentPort } from '../ports/custom-face-vision-agent.port';

/**
 * OpenAI自定义表情视觉Agent配置
 *
 * 独立于聊天Agent配置，避免聊天模型不支持图像时影响表情理解能力。
 */
export interface OpenAiCustomFaceVisionAgentConfig {
  /** OpenAI API Key */
  readonly apiKey: string;
  /** OpenAI兼容服务地址 */
  readonly baseURL?: string;
  /** 视觉模型名称 */
  readonly model: string;
  /** 单张表情理解超时毫秒 */
  readonly timeoutMs: number;
}

/**
 * OpenAI自定义表情视觉Agent
 *
 * 使用多模态输入理解QQ自定义表情，输出聊天Agent可读取的中文结构化描述。
 */
export class OpenAiCustomFaceVisionAgent implements CustomFaceVisionAgentPort {
  private readonly runner: Runner;

  constructor(private readonly config: OpenAiCustomFaceVisionAgentConfig) {
    const modelProvider = new OpenAIProvider({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.runner = new Runner({ modelProvider });
  }

  /**
   * 理解自定义表情
   * @param face 自定义表情资源
   * @returns 中文描述
   */
  async describeFace(face: QqCustomFaceResource): Promise<CustomFaceDescription> {
    const agent = new Agent({
      name: '叶猫猫表情理解Agent',
      model: this.config.model,
      instructions: buildVisionInstructions(),
    });
    const result = await withTimeout(
      this.runner.run(agent, [
        user([
          {
            type: 'input_text',
            text: [
              '请理解这张QQ自定义表情，输出严格JSON。',
              `平台摘要：${face.summary ?? '无'}`,
              `表情名称：${face.name ?? '无'}`,
            ].join('\n'),
          },
          { type: 'input_image', image: face.file, detail: 'low' },
        ]),
      ]),
      this.config.timeoutMs,
    );

    return parseCustomFaceDescription(String(result.finalOutput ?? '').trim());
  }
}

/**
 * 读取视觉Agent配置
 * @param env 环境变量
 * @returns 视觉Agent配置
 */
export function loadCustomFaceVisionAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): OpenAiCustomFaceVisionAgentConfig | undefined {
  const model = normalizeOptionalValue(env.YE_KITTY_VISION_AGENT_MODEL);
  if (!model) return undefined;

  const apiKey =
    normalizeOptionalValue(env.YE_KITTY_VISION_AGENT_API_KEY) ??
    normalizeOptionalValue(env.OPENAI_API_KEY);
  if (!apiKey) return undefined;

  return {
    apiKey,
    baseURL:
      normalizeOptionalValue(env.YE_KITTY_VISION_AGENT_BASE_URL) ??
      normalizeOptionalValue(env.OPENAI_BASE_URL),
    model,
    timeoutMs: readPositiveInteger(
      normalizeOptionalValue(env.YE_KITTY_VISION_AGENT_TIMEOUT_MS),
      30000,
    ),
  };
}

// 构建视觉理解约束。
function buildVisionInstructions(): string {
  return [
    '你是叶猫猫的QQ自定义表情理解Agent。',
    '你只负责理解图片，不负责聊天，不调用任何工具。',
    '请用中文描述表情内容、情绪和适合使用的聊天场景。',
    '只能输出单个JSON对象，不能输出Markdown或解释文字。',
    'JSON字段：content, emotion, suitableScenes, avoidScenes, tags, confidence。',
    'suitableScenes、avoidScenes、tags 必须是中文字符串数组。',
    'confidence 是0到1之间的数字。',
  ].join('\n');
}

// 解析视觉Agent输出。
export function parseCustomFaceDescription(rawOutput: string): CustomFaceDescription {
  if (!rawOutput) throw new Error('视觉Agent返回空描述');

  const parsed = JSON.parse(stripCodeFence(rawOutput)) as unknown;
  if (!isRecord(parsed)) throw new Error('视觉Agent描述不是对象');

  const content = normalizeText(parsed.content);
  const emotion = normalizeText(parsed.emotion);
  const suitableScenes = normalizeStringArray(parsed.suitableScenes);
  const avoidScenes = normalizeStringArray(parsed.avoidScenes);
  const tags = normalizeStringArray(parsed.tags);
  const confidence = normalizeConfidence(parsed.confidence);

  if (!content || !emotion || suitableScenes.length === 0 || tags.length === 0) {
    throw new Error('视觉Agent描述字段不完整');
  }

  return {
    content,
    emotion,
    suitableScenes,
    avoidScenes,
    tags,
    confidence,
  };
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

// 读取普通文本字段。
function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

// 读取字符串数组。
function normalizeStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeText)
    .filter((item): item is string => Boolean(item))
    .slice(0, 8);
}

// 读取置信度。
function normalizeConfidence(value: unknown): number {
  const numberValue = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof numberValue !== 'number' || Number.isNaN(numberValue)) return 0.5;
  return Math.max(0, Math.min(1, numberValue));
}

// 空字符串按未配置处理。
function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

// 读取正整数配置。
function readPositiveInteger(rawValue: string | undefined, defaultValue: number): number {
  const value = Number(rawValue ?? defaultValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('YE_KITTY_VISION_AGENT_TIMEOUT_MS 必须是正整数');
  }

  return value;
}

// 判断普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

// 为单张表情理解增加超时。
async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutTask = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`视觉Agent理解表情超过 ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutTask]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
