import type { ModelNodeConfig } from '../ports/model-request-pool.port';

/** 默认模型节点并发数 */
export const DEFAULT_MODEL_MAX_CONCURRENCY = 3;
/** 默认模型请求间隔毫秒 */
export const DEFAULT_MODEL_MIN_INTERVAL_MS = 2000;
/** 默认模型最大重试次数 */
export const DEFAULT_MODEL_MAX_RETRIES = 3;
/** 默认模型初始退避毫秒 */
export const DEFAULT_MODEL_BACKOFF_INITIAL_MS = 2000;
/** 默认模型最大退避毫秒 */
export const DEFAULT_MODEL_BACKOFF_MAX_MS = 60000;
/** 默认模型退避倍数 */
export const DEFAULT_MODEL_BACKOFF_MULTIPLIER = 2;

/**
 * 读取模型池配置
 * @param env 环境变量
 * @returns 模型节点列表
 */
export function loadModelPoolConfig(
  env: NodeJS.ProcessEnv = process.env,
): readonly ModelNodeConfig[] {
  const poolJson = normalizeOptionalValue(env.YE_KITTY_MODEL_POOL);
  if (poolJson) return parseModelPoolConfig(poolJson);

  const apiKey = normalizeOptionalValue(env.OPENAI_API_KEY);
  if (!apiKey) return [];

  return [
    normalizeModelNodeConfig(
      {
        id: 'default-openai-agent',
        apiKey,
        baseURL: normalizeOptionalValue(env.OPENAI_BASE_URL),
        model: normalizeOptionalValue(env.YE_KITTY_AGENT_MODEL) ?? 'gpt-4.1-mini',
      },
      0,
    ),
  ];
}

/**
 * 解析模型池JSON配置
 * @param rawValue JSON字符串
 * @returns 模型节点列表
 */
export function parseModelPoolConfig(rawValue: string): readonly ModelNodeConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue) as unknown;
  } catch {
    throw new Error('YE_KITTY_MODEL_POOL 必须是合法JSON');
  }

  const models = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.models)
      ? parsed.models
      : undefined;
  if (!models || models.length === 0) {
    throw new Error('YE_KITTY_MODEL_POOL 至少需要一个模型节点');
  }

  const ids = new Set<string>();
  return models.map((item, index) => {
    const node = normalizeModelNodeConfig(item, index);
    if (ids.has(node.id)) throw new Error(`YE_KITTY_MODEL_POOL 存在重复模型节点 id=${node.id}`);
    ids.add(node.id);
    return node;
  });
}

// 归一化单个模型节点配置。
function normalizeModelNodeConfig(input: unknown, index: number): ModelNodeConfig {
  if (!isRecord(input)) throw new Error(`YE_KITTY_MODEL_POOL 第${index + 1}个模型节点必须是对象`);

  const id = readRequiredString(input.id, `YE_KITTY_MODEL_POOL 第${index + 1}个模型节点缺少 id`);
  const apiKey = readRequiredString(input.apiKey, `YE_KITTY_MODEL_POOL 模型节点 ${id} 缺少 apiKey`);
  const model = readRequiredString(input.model, `YE_KITTY_MODEL_POOL 模型节点 ${id} 缺少 model`);
  const baseURL = normalizeOptionalValue(
    typeof input.baseURL === 'string' ? input.baseURL : undefined,
  );

  return {
    id,
    apiKey,
    baseURL,
    model,
    maxConcurrency: readPositiveInteger(
      input.maxConcurrency,
      DEFAULT_MODEL_MAX_CONCURRENCY,
      `YE_KITTY_MODEL_POOL 模型节点 ${id} 的 maxConcurrency 必须是正整数`,
    ),
    minIntervalMs: readPositiveInteger(
      input.minIntervalMs,
      DEFAULT_MODEL_MIN_INTERVAL_MS,
      `YE_KITTY_MODEL_POOL 模型节点 ${id} 的 minIntervalMs 必须是正整数`,
    ),
    maxRetries: readNonNegativeInteger(
      input.maxRetries,
      DEFAULT_MODEL_MAX_RETRIES,
      `YE_KITTY_MODEL_POOL 模型节点 ${id} 的 maxRetries 必须是非负整数`,
    ),
    backoff: {
      initialMs: readPositiveInteger(
        input.backoffInitialMs,
        DEFAULT_MODEL_BACKOFF_INITIAL_MS,
        `YE_KITTY_MODEL_POOL 模型节点 ${id} 的 backoffInitialMs 必须是正整数`,
      ),
      maxMs: readPositiveInteger(
        input.backoffMaxMs,
        DEFAULT_MODEL_BACKOFF_MAX_MS,
        `YE_KITTY_MODEL_POOL 模型节点 ${id} 的 backoffMaxMs 必须是正整数`,
      ),
      multiplier: readPositiveNumber(
        input.backoffMultiplier,
        DEFAULT_MODEL_BACKOFF_MULTIPLIER,
        `YE_KITTY_MODEL_POOL 模型节点 ${id} 的 backoffMultiplier 必须大于1`,
      ),
    },
  };
}

// 读取必填字符串。
function readRequiredString(value: unknown, errorMessage: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(errorMessage);
  return value.trim();
}

// 读取正整数。
function readPositiveInteger(value: unknown, defaultValue: number, errorMessage: string): number {
  const numberValue = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) throw new Error(errorMessage);
  return numberValue;
}

// 读取非负整数。
function readNonNegativeInteger(
  value: unknown,
  defaultValue: number,
  errorMessage: string,
): number {
  const numberValue = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) throw new Error(errorMessage);
  return numberValue;
}

// 读取大于1的数字。
function readPositiveNumber(value: unknown, defaultValue: number, errorMessage: string): number {
  const numberValue = value === undefined ? defaultValue : Number(value);
  if (typeof numberValue !== 'number' || Number.isNaN(numberValue) || numberValue <= 1) {
    throw new Error(errorMessage);
  }
  return numberValue;
}

// 空字符串按未配置处理。
function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : undefined;
}

// 判断普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
