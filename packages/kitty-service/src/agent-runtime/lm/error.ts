/** 模型请求错误配置 */
export interface ModelRequestErrorOptions {
  /** HTTP状态码 */
  readonly statusCode?: number;
  /** Retry-After毫秒 */
  readonly retryAfterMs?: number;
  /** 可读错误摘要 */
  readonly reason?: string;
}

/**
 * 模型请求错误
 *
 * 统一承载 OpenAI 兼容服务错误，让模型池可以识别 429、
 * Retry-After 和脱敏后的失败原因。
 */
export class ModelRequestError extends Error {
  /** HTTP状态码 */
  readonly statusCode?: number;
  /** Retry-After毫秒 */
  readonly retryAfterMs?: number;
  /** 可读错误摘要 */
  readonly reason: string;

  constructor(message: string, options: ModelRequestErrorOptions = {}) {
    super(message);
    this.name = 'ModelRequestError';
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
    this.reason = options.reason ?? message;
  }
}

// 判断错误是否为模型请求错误。
export function isModelRequestError(error: unknown): error is ModelRequestError {
  return error instanceof ModelRequestError;
}
