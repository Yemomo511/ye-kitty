import { describe, expect, test } from 'vitest';
import {
  InMemoryModelRequestPool,
  type ModelTextClient,
  type ModelTextClientRequest,
} from '../application/in-memory-model-request-pool';
import { ModelRequestError } from '../application/model-request-error';
import {
  DEFAULT_MODEL_BACKOFF_INITIAL_MS,
  DEFAULT_MODEL_MAX_CONCURRENCY,
  DEFAULT_MODEL_MAX_RETRIES,
  DEFAULT_MODEL_MIN_INTERVAL_MS,
  loadModelPoolConfig,
  parseModelPoolConfig,
} from '../application/model-request-pool-config';
import type { ModelDecisionRequest, ModelNodeConfig } from '../ports/model-request-pool.port';

describe('模型请求池配置', () => {
  test('解析多模型JSON数组配置', () => {
    expect(
      parseModelPoolConfig(
        JSON.stringify([
          {
            id: 'deepseek-chat-main',
            baseURL: 'https://relay.example.com/v1',
            apiKey: 'sk-deepseek',
            model: 'deepseek-chat',
            maxConcurrency: 4,
            minIntervalMs: 2000,
          },
        ]),
      ),
    ).toEqual([
      {
        id: 'deepseek-chat-main',
        baseURL: 'https://relay.example.com/v1',
        apiKey: 'sk-deepseek',
        model: 'deepseek-chat',
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

  test('解析models对象配置', () => {
    expect(
      parseModelPoolConfig(
        JSON.stringify({
          models: [
            {
              id: 'openai-gpt-main',
              apiKey: 'sk-openai',
              model: 'gpt-4.1-mini',
            },
          ],
        }),
      )[0],
    ).toMatchObject({
      id: 'openai-gpt-main',
      maxConcurrency: DEFAULT_MODEL_MAX_CONCURRENCY,
      minIntervalMs: DEFAULT_MODEL_MIN_INTERVAL_MS,
    });
  });

  test('缺字段和非法数字报中文错误', () => {
    expect(() => parseModelPoolConfig('[]')).toThrow('至少需要一个模型节点');
    expect(() => parseModelPoolConfig('[{"id":"bad","apiKey":"sk"}]')).toThrow('缺少 model');
    expect(() =>
      parseModelPoolConfig(
        JSON.stringify([{ id: 'bad', apiKey: 'sk', model: 'gpt', maxConcurrency: 0 }]),
      ),
    ).toThrow('maxConcurrency 必须是正整数');
  });

  test('旧单模型配置构造单节点模型池', () => {
    expect(
      loadModelPoolConfig({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: 'https://relay.example.com',
        YE_KITTY_AGENT_MODEL: 'gpt-4.1-mini',
      }),
    ).toEqual([
      {
        id: 'default-openai-agent',
        apiKey: 'sk-test',
        baseURL: 'https://relay.example.com',
        model: 'gpt-4.1-mini',
        maxConcurrency: DEFAULT_MODEL_MAX_CONCURRENCY,
        minIntervalMs: DEFAULT_MODEL_MIN_INTERVAL_MS,
        maxRetries: DEFAULT_MODEL_MAX_RETRIES,
        backoff: {
          initialMs: DEFAULT_MODEL_BACKOFF_INITIAL_MS,
          maxMs: 60000,
          multiplier: 2,
        },
      },
    ]);
  });
});

describe('InMemoryModelRequestPool', () => {
  test('路由选择队列和运行数最小的模型', async () => {
    const pending = createDeferred<string>();
    const client = createClient((request) => {
      if (request.node.id === 'model-a') return pending.promise;
      return Promise.resolve(`来自${request.node.id}`);
    });
    const pool = new InMemoryModelRequestPool(
      [
        createNode('model-a', { maxConcurrency: 1, minIntervalMs: 0 }),
        createNode('model-b', { maxConcurrency: 1, minIntervalMs: 0 }),
      ],
      client,
      createClock(),
    );

    void pool.runDecision(createRequest()).catch(() => undefined);
    const result = await pool.runDecision(createRequest());
    pending.resolve('来自model-a');

    expect(result.modelNodeId).toBe('model-b');
  });

  test('单模型maxConcurrency限制同时请求数', async () => {
    const first = createDeferred<string>();
    const calls: string[] = [];
    const client = createClient((request) => {
      calls.push(request.node.id);
      if (calls.length === 1) return first.promise;
      return Promise.resolve('第二次完成');
    });
    const pool = new InMemoryModelRequestPool(
      [createNode('model-a', { maxConcurrency: 1, minIntervalMs: 0 })],
      client,
      createClock(),
    );

    const firstResult = pool.runDecision(createRequest());
    const secondResult = pool.runDecision(createRequest());
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    first.resolve('第一次完成');

    await expect(firstResult).resolves.toMatchObject({ text: '第一次完成' });
    await expect(secondResult).resolves.toMatchObject({ text: '第二次完成' });
    expect(calls).toHaveLength(2);
  });

  test('单模型minIntervalMs限制请求启动间隔', async () => {
    const sleeps: number[] = [];
    let clock = createClock();
    clock = createClock({
      sleep: (ms) => {
        sleeps.push(ms);
        clock.advance(ms);
      },
    });
    const client = createClient(() => Promise.resolve('完成'));
    const pool = new InMemoryModelRequestPool(
      [createNode('model-a', { maxConcurrency: 2, minIntervalMs: 2000 })],
      client,
      clock,
    );

    await Promise.all([pool.runDecision(createRequest()), pool.runDecision(createRequest())]);

    expect(sleeps).toContain(2000);
  });

  test('429优先使用Retry-After并重试成功', async () => {
    const sleeps: number[] = [];
    let clock = createClock();
    clock = createClock({
      sleep: (ms) => {
        sleeps.push(ms);
        clock.advance(ms);
      },
    });
    let callCount = 0;
    const client = createClient(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.reject(
          new ModelRequestError('限流', { statusCode: 429, retryAfterMs: 5000 }),
        );
      }
      return Promise.resolve('重试成功');
    });
    const pool = new InMemoryModelRequestPool(
      [createNode('model-a', { minIntervalMs: 0, maxRetries: 1 })],
      client,
      clock,
    );

    await expect(pool.runDecision(createRequest())).resolves.toMatchObject({
      text: '重试成功',
      attemptCount: 2,
    });
    expect(sleeps).toEqual([5000]);
    expect(pool.getStates()[0].backoffUntil).toBe(0);
  });

  test('无Retry-After时指数退避翻倍', async () => {
    const sleeps: number[] = [];
    let clock = createClock();
    clock = createClock({
      sleep: (ms) => {
        sleeps.push(ms);
        clock.advance(ms);
      },
    });
    let callCount = 0;
    const client = createClient(() => {
      callCount += 1;
      if (callCount <= 2) {
        return Promise.reject(new ModelRequestError('限流', { statusCode: 429 }));
      }
      return Promise.resolve('退避后成功');
    });
    const pool = new InMemoryModelRequestPool(
      [
        createNode('model-a', {
          minIntervalMs: 0,
          maxRetries: 2,
          backoffInitialMs: 2000,
          backoffMultiplier: 2,
        }),
      ],
      client,
      clock,
    );

    await expect(pool.runDecision(createRequest())).resolves.toMatchObject({
      text: '退避后成功',
      attemptCount: 3,
    });
    expect(sleeps).toEqual([2000, 4000]);
  });

  test('路由跳过退避中的模型', async () => {
    const backoffSleep = createDeferred<void>();
    const clock = createClock({
      sleep: () => backoffSleep.promise,
    });
    let modelACallCount = 0;
    const client = createClient((request) => {
      if (request.node.id === 'model-a') {
        modelACallCount += 1;
        if (modelACallCount === 1) {
          return Promise.reject(
            new ModelRequestError('限流', { statusCode: 429, retryAfterMs: 10000 }),
          );
        }
        return Promise.resolve('退避后完成');
      }
      return Promise.resolve('健康模型完成');
    });
    const pool = new InMemoryModelRequestPool(
      [
        createNode('model-a', { minIntervalMs: 0, maxRetries: 1 }),
        createNode('model-b', { minIntervalMs: 0, maxRetries: 1 }),
      ],
      client,
      clock,
    );

    const firstResult = pool.runDecision(createRequest());
    await waitMicrotasks(2);

    const result = await pool.runDecision(createRequest());
    clock.advance(10000);
    backoffSleep.resolve(undefined);

    expect(result.modelNodeId).toBe('model-b');
    await expect(firstResult).resolves.toMatchObject({ modelNodeId: 'model-a' });
  });

  test('超过maxRetries后失败', async () => {
    const client = createClient(() =>
      Promise.reject(new ModelRequestError('限流', { statusCode: 429 })),
    );
    const pool = new InMemoryModelRequestPool(
      [createNode('model-a', { minIntervalMs: 0, maxRetries: 0 })],
      client,
      createClock(),
    );

    await expect(pool.runDecision(createRequest())).rejects.toThrow('限流');
  });

  test('TTL过期请求不再发给模型', async () => {
    let callCount = 0;
    const clock = createClock({
      sleep: () => {
        clock.advance(2000);
      },
    });
    const client = createClient(() => {
      callCount += 1;
      return Promise.reject(new ModelRequestError('限流', { statusCode: 429 }));
    });
    const pool = new InMemoryModelRequestPool(
      [createNode('model-a', { minIntervalMs: 0, maxRetries: 3 })],
      client,
      clock,
    );

    await expect(pool.runDecision(createRequest({ ttlMs: 100 }))).rejects.toThrow(
      '模型请求已超过队列存活时间',
    );
    expect(callCount).toBe(1);
  });
});

function createNode(
  id: string,
  overrides: Partial<
    Pick<ModelNodeConfig, 'maxConcurrency' | 'minIntervalMs' | 'maxRetries'> & {
      readonly backoffInitialMs: number;
      readonly backoffMaxMs: number;
      readonly backoffMultiplier: number;
    }
  > = {},
): ModelNodeConfig {
  return {
    id,
    apiKey: `sk-${id}`,
    model: 'gpt-4.1-mini',
    maxConcurrency: overrides.maxConcurrency ?? 3,
    minIntervalMs: overrides.minIntervalMs ?? 0,
    maxRetries: overrides.maxRetries ?? 3,
    backoff: {
      initialMs: overrides.backoffInitialMs ?? 2000,
      maxMs: overrides.backoffMaxMs ?? 60000,
      multiplier: overrides.backoffMultiplier ?? 2,
    },
  };
}

function createRequest(overrides: Partial<ModelDecisionRequest> = {}): ModelDecisionRequest {
  return {
    agentName: '测试叶猫猫',
    instructions: '只输出JSON',
    input: '你好',
    timeoutMs: 30000,
    source: 'test',
    ...overrides,
  };
}

function createClient(
  handler: (request: ModelTextClientRequest) => Promise<string>,
): ModelTextClient {
  return {
    generateText: handler,
  };
}

function createClock(
  options: {
    readonly sleep?: (ms: number) => void | Promise<void>;
  } = {},
): {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly advance: (ms: number) => void;
} {
  let currentTime = 0;
  return {
    now: () => currentTime,
    sleep: async (ms) => {
      if (options.sleep) {
        await options.sleep(ms);
        return;
      }
      currentTime += ms;
    },
    advance: (ms) => {
      currentTime += ms;
    },
  };
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolveValue: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}

async function waitMicrotasks(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
