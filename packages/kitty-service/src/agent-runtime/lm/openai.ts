import { OpenAIProvider, type Model } from '@openai/agents';
import { ModelRequestError } from './error';
import type { ModelFactory, ModelNodeConfig } from './model';

/**
 * OpenAI兼容Model工厂
 *
 * 只负责创建官方SDK Model并归一化远端错误。并发、节流、重试和节点选择
 * 由ModelPool维护，避免把系统治理交给模型或Prompt。
 */
export class OpenAIModel implements ModelFactory {
  private readonly models = new Map<string, Promise<Model>>();

  /**
   * 获取节点官方Model
   * @param node 模型节点
   * @returns 带错误归一化的Model
   */
  getModel(node: ModelNodeConfig): Promise<Model> {
    const existing = this.models.get(node.id);
    if (existing) return existing;

    const provider = new OpenAIProvider({
      apiKey: node.apiKey,
      baseURL: node.baseURL,
    });
    const created = provider.getModel(node.model).then((model) => wrapModel(model, node));
    this.models.set(node.id, created);
    return created;
  }
}

// 在官方Model边界统一转换远端错误。
function wrapModel(model: Model, node: ModelNodeConfig): Model {
  return {
    getResponse: async (request) => {
      try {
        return await model.getResponse(request);
      } catch (error) {
        throw toModelRequestError(error, node);
      }
    },
    async *getStreamedResponse(request) {
      try {
        for await (const event of model.getStreamedResponse(request)) yield event;
      } catch (error) {
        throw toModelRequestError(error, node);
      }
    },
    ...(model.getRetryAdvice
      ? {
          getRetryAdvice: model.getRetryAdvice.bind(model),
        }
      : {}),
  };
}

// 转换远端错误。
function toModelRequestError(error: unknown, node: ModelNodeConfig): ModelRequestError {
  if (error instanceof ModelRequestError) return error;

  const statusCode = readStatusCode(error);
  const retryAfterMs = readRetryAfterMs(error);
  const reason = sanitizeErrorReason(error, node.apiKey);
  return new ModelRequestError(`模型请求失败 status=${statusCode ?? 'unknown'} reason=${reason}`, {
    statusCode,
    retryAfterMs,
    reason,
  });
}

// 读取HTTP状态码。
function readStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error.status ?? error.statusCode;
  if (typeof status === 'number') return status;
  const response = error.response;
  if (isRecord(response) && typeof response.status === 'number') return response.status;
  return undefined;
}

// 读取Retry-After。
function readRetryAfterMs(error: unknown): number | undefined {
  const header = readHeader(error, 'retry-after');
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const retryAt = Date.parse(header);
  if (Number.isNaN(retryAt)) return undefined;
  return Math.max(0, retryAt - Date.now());
}

// 读取错误响应头。
function readHeader(error: unknown, name: string): string | undefined {
  if (!isRecord(error)) return undefined;
  return (
    readHeaderFrom(error.headers, name) ??
    readHeaderFrom(isRecord(error.response) ? error.response.headers : undefined, name)
  );
}

// 兼容Headers、普通对象和SDK自定义Header容器。
function readHeaderFrom(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get: (key: string) => unknown }).get(name);
    return typeof value === 'string' ? value : undefined;
  }
  if (!isRecord(headers)) return undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return typeof direct === 'string' ? direct : undefined;
}

// 脱敏错误摘要。
function sanitizeErrorReason(error: unknown, apiKey: string): string {
  const rawText = error instanceof Error ? error.message : JSON.stringify(error);
  const text = (rawText ?? '未知错误').trim().slice(0, 500);
  return apiKey ? text.split(apiKey).join('****') : text;
}

// 判断普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
