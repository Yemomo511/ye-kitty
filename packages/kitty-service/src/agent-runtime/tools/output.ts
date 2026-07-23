import type { ToolModelOutput, ToolSettlement } from './result';

const MAX_MODEL_OUTPUT_LENGTH = 12000;
const MAX_MODEL_OUTPUT_DEPTH = 6;
const MAX_MODEL_ARRAY_ITEMS = 50;
const SENSITIVE_KEY = /token|password|secret|api[-_]?key|cookie|authorization|credential/i;
const SENSITIVE_TEXT_PATTERNS: readonly [RegExp, string][] = [
  [/Bearer\s+[^\s,;]+/gi, 'Bearer ***'],
  [/((?:token|password|secret|api[-_]?key|cookie|credential)\s*[=:]\s*)[^\s,;]+/gi, '$1***'],
];

/**
 * 投影通用模型观察
 * @param settlement 完整系统结算
 * @returns 脱敏有界结果
 */
export function projectToolSettlement(settlement: ToolSettlement): ToolModelOutput {
  if (settlement.status === 'success' && settlement.output) {
    const data = sanitizeModelValue(settlement.output.data);
    return {
      status: 'success',
      summary: limitText(settlement.output.summary),
      ...(data === undefined ? {} : { data }),
      ...(settlement.output.retryable === undefined
        ? {}
        : { retryable: settlement.output.retryable }),
    };
  }

  return {
    status: settlement.status,
    summary: toSafeErrorSummary(settlement),
    ...(settlement.error ? { retryable: settlement.error.retryable } : {}),
  };
}

// 生成不泄漏内部信息的错误摘要。
function toSafeErrorSummary(settlement: ToolSettlement): string {
  if (settlement.status === 'denied') return '工具调用未通过系统权限校验。';
  if (settlement.status === 'review') return '工具调用需要人工审核，当前没有执行。';
  if (settlement.status === 'timeout') return '工具执行超时，请根据当前信息调整方案。';
  if (settlement.status === 'cancelled') return '工具调用已取消。';
  if (settlement.error?.code === 'invalid_input') {
    return `工具输入无效：${limitText(settlement.error.message)}`;
  }
  if (settlement.error?.code === 'execution_failed' && settlement.output) {
    return limitText(settlement.output.summary);
  }
  return '工具执行失败，请根据当前信息调整方案。';
}

// 脱敏并限制模型可见数据。
function sanitizeModelValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const sanitized = sanitizeValue(value, 0, new WeakSet<object>());
  const serialized = safeStringify(sanitized);
  if (serialized.length <= MAX_MODEL_OUTPUT_LENGTH) return sanitized;
  return {
    truncated: true,
    preview: serialized.slice(0, MAX_MODEL_OUTPUT_LENGTH),
  };
}

// 递归清洗结构化值。
function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return limitText(redactText(value));
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_MODEL_OUTPUT_DEPTH) return '[层级已截断]';
  if (seen.has(value)) return '[循环引用]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_MODEL_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[已脱敏]' : sanitizeValue(item, depth + 1, seen);
  }
  return output;
}

// 限制单段文本。
function limitText(value: string): string {
  const redacted = redactText(value);
  return redacted.length <= MAX_MODEL_OUTPUT_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_MODEL_OUTPUT_LENGTH)}…[已截断]`;
}

// 清理自由文本中的常见凭证形态。
function redactText(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

// 安全序列化清洗结果。
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[无法序列化]"';
  }
}
