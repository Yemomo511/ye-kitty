import { Agent, OpenAIProvider, Runner } from '@openai/agents';
import { ModelRequestError } from '../application/model-request-error';
import type {
  ModelTextClient,
  ModelTextClientRequest,
} from '../application/in-memory-model-request-pool';
import type { ModelNodeConfig } from '../ports/model-request-pool.port';

/**
 * OpenAI兼容模型客户端
 *
 * 只负责对单个模型节点发起真实请求，并把远端错误转换为模型池可识别的错误。
 */
export class OpenAiCompatibleModelClient implements ModelTextClient {
  private readonly runners = new Map<string, Runner>();

  /**
   * 生成模型文本
   * @param request 模型节点和Prompt
   * @returns 模型文本
   */
  async generateText(request: ModelTextClientRequest): Promise<string> {
    const runner = this.getRunner(request.node);
    const agent = new Agent({
      name: request.agentName,
      model: request.node.model,
      instructions: request.instructions,
    });

    try {
      const result = await withTimeout(runner.run(agent, request.input), request.timeoutMs);
      return String(result.finalOutput ?? '').trim();
    } catch (error) {
      throw toModelRequestError(error, request.node);
    }
  }

  // 按节点缓存Runner，避免每次请求重复创建Provider。
  private getRunner(node: ModelNodeConfig): Runner {
    const existing = this.runners.get(node.id);
    if (existing) return existing;

    const modelProvider = new OpenAIProvider({
      apiKey: node.apiKey,
      baseURL: node.baseURL,
    });
    const runner = new Runner({ modelProvider });
    this.runners.set(node.id, runner);
    return runner;
  }
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

// 兼容 Headers、普通对象和SDK自定义Header容器。
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
  return text.split(apiKey).join('****');
}

// 为单次模型决策增加超时。
async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutTask = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new ModelRequestError(`OpenAI Agent 决策超过 ${timeoutMs}ms`, { reason: '请求超时' }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutTask]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// 判断普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
