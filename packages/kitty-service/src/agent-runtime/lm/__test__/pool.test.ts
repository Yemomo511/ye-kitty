import type { Model, ModelRequest, ModelResponse, StreamEvent } from '@openai/agents';
import { describe, expect, test, vi } from 'vitest';
import { ModelRequestError } from '../error';
import type { ModelFactory, ModelNodeConfig } from '../model';
import { ModelPool, type ModelRequestPoolClock } from '../pool';
import {
  DEFAULT_MODEL_BACKOFF_INITIAL_MS,
  DEFAULT_MODEL_MAX_CONCURRENCY,
  DEFAULT_MODEL_MAX_RETRIES,
  DEFAULT_MODEL_MIN_INTERVAL_MS,
  loadModelPoolConfig,
  parseModelPoolConfig,
} from '../config';

describe('模型请求池配置', () => {
  test('解析多模型配置并补齐系统默认值', () => {
    expect(
      parseModelPoolConfig(
        JSON.stringify([
          {
            id: 'main',
            apiKey: 'sk-test',
            model: 'gpt-test',
            maxConcurrency: 4,
            minIntervalMs: 2000,
          },
        ]),
      ),
    ).toEqual([
      {
        id: 'main',
        apiKey: 'sk-test',
        model: 'gpt-test',
        maxConcurrency: 4,
        minIntervalMs: 2000,
        maxRetries: DEFAULT_MODEL_MAX_RETRIES,
        backoff: {
          initialMs: DEFAULT_MODEL_BACKOFF_INITIAL_MS,
          maxMs: 60000,
          multiplier: 2,
        },
      },
    ]);
  });

  test('旧单模型环境变量仍构造单节点', () => {
    expect(
      loadModelPoolConfig({
        OPENAI_API_KEY: 'sk-test',
        YE_KITTY_AGENT_MODEL: 'gpt-test',
      })[0],
    ).toMatchObject({
      id: 'default-openai-agent',
      maxConcurrency: DEFAULT_MODEL_MAX_CONCURRENCY,
      minIntervalMs: DEFAULT_MODEL_MIN_INTERVAL_MS,
    });
  });
});

describe('ModelPool官方Model代理', () => {
  test('每次Agent运行固定节点，后续运行选择压力更低的节点', async () => {
    const first = deferred<ModelResponse>();
    const calls: string[] = [];
    const factory = createFactory((node) =>
      createModel(async () => {
        calls.push(node.id);
        return node.id === 'model-a' ? await first.promise : createResponse(node.id);
      }),
    );
    const pool = new ModelPool(
      [createNode('model-a'), createNode('model-b')],
      factory,
      createClock(),
    );

    const runA = pool.acquireModel({ source: 'test' });
    const firstRequest = runA.getResponse({} as ModelRequest);
    await Promise.resolve();
    const runB = pool.acquireModel({ source: 'test' });
    const secondResponse = await runB.getResponse({} as ModelRequest);
    first.resolve(createResponse('model-a'));
    await firstRequest;

    expect(readResponseId(secondResponse)).toBe('model-b');
    expect(calls).toEqual(['model-a', 'model-b']);
  });

  test('并发上限作用于Runner发出的每次模型请求', async () => {
    const first = deferred<ModelResponse>();
    const handler = vi
      .fn<() => Promise<ModelResponse>>()
      .mockImplementationOnce(async () => await first.promise)
      .mockResolvedValue(createResponse('second'));
    const pool = new ModelPool(
      [createNode('model-a', { maxConcurrency: 1 })],
      createFactory(() => createModel(handler)),
      createClock(),
    );
    const model = pool.acquireModel({ source: 'test' });

    const firstRequest = model.getResponse({} as ModelRequest);
    const secondRequest = model.getResponse({} as ModelRequest);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledOnce();

    first.resolve(createResponse('first'));
    await Promise.all([firstRequest, secondRequest]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('429只重试当前模型请求并遵守Retry-After', async () => {
    const sleeps: number[] = [];
    const clock = createClock((ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    });
    const handler = vi
      .fn<() => Promise<ModelResponse>>()
      .mockRejectedValueOnce(
        new ModelRequestError('限流', {
          statusCode: 429,
          retryAfterMs: 2500,
          reason: '限流',
        }),
      )
      .mockResolvedValue(createResponse('ok'));
    const pool = new ModelPool(
      [createNode('model-a')],
      createFactory(() => createModel(handler)),
      clock,
    );

    const response = await pool.acquireModel({ source: 'test' }).getResponse({} as ModelRequest);

    expect(readResponseId(response)).toBe('ok');
    expect(handler).toHaveBeenCalledTimes(2);
    expect(sleeps).toContain(2500);
  });

  test('流式响应在节点边界完整缓冲后再交给Runner', async () => {
    const events = [{ type: 'response_started' }, { type: 'response_done' }] as StreamEvent[];
    const model: Model = {
      getResponse: async () => createResponse('unused'),
      async *getStreamedResponse() {
        for (const event of events) yield event;
      },
    };
    const pool = new ModelPool(
      [createNode('model-a')],
      createFactory(() => model),
      createClock(),
    );

    const actual: StreamEvent[] = [];
    for await (const event of pool
      .acquireModel({ source: 'test' })
      .getStreamedResponse({} as ModelRequest)) {
      actual.push(event);
    }

    expect(actual).toEqual(events);
  });
});

function createFactory(factory: (node: ModelNodeConfig) => Model): ModelFactory {
  return { getModel: async (node) => factory(node) };
}

function createModel(getResponse: () => Promise<ModelResponse>): Model {
  return {
    getResponse,
    getStreamedResponse: () => emptyStream(),
  };
}

// 构造测试所需的空流。
async function* emptyStream(): AsyncIterable<never> {
  yield* [];
}

function createNode(id: string, overrides: Partial<ModelNodeConfig> = {}): ModelNodeConfig {
  return {
    id,
    apiKey: 'sk-test',
    model: 'gpt-test',
    maxConcurrency: 1,
    minIntervalMs: 0,
    maxRetries: 1,
    backoff: { initialMs: 1000, maxMs: 60000, multiplier: 2 },
    ...overrides,
  };
}

function createResponse(id: string): ModelResponse {
  return { responseId: id, output: [], usage: {} as ModelResponse['usage'] };
}

function readResponseId(response: ModelResponse): string | undefined {
  return response.responseId;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createClock(onSleep?: (ms: number) => void): ModelRequestPoolClock & {
  advance(ms: number): void;
} {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms) => {
      onSleep?.(ms);
      if (!onSleep) now += ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}
