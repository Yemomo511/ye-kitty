import type { Model, ModelRequest, ModelResponse, StreamEvent } from '@openai/agents';
import { isModelRequestError } from './error';
import type {
  ModelFactory,
  ModelNodeConfig,
  ModelPoolRunner,
  ModelRequestPriority,
  ModelRunMetadata,
  ModelRuntimeState,
} from './model';

/** 模型池时钟 */
export interface ModelRequestPoolClock {
  /** 当前毫秒时间戳 */
  readonly now: () => number;
  /** 等待指定毫秒 */
  readonly sleep: (ms: number) => Promise<void>;
}

interface PendingModelRequest<T = unknown> {
  readonly metadata: ModelRunMetadata;
  readonly createdAt: number;
  readonly run: (model: Model) => Promise<T>;
  readonly resolve: (result: T) => void;
  readonly reject: (error: Error) => void;
  attemptCount: number;
}

const DEFAULT_PRIORITY: ModelRequestPriority = 'normal';
const DEFAULT_TTL_BY_PRIORITY: Record<ModelRequestPriority, number> = {
  high: 60000,
  normal: 30000,
  low: 15000,
};

/**
 * 进程内模型请求池
 *
 * Agent一次运行固定选择一个节点，但Runner每一轮真实模型请求仍分别进入
 * 节点队列。429只重放尚未向Runner返回结果的单次模型请求，不重放已结算工具。
 */
export class ModelPool implements ModelPoolRunner {
  private readonly workers: readonly ModelWorker[];

  constructor(
    nodes: readonly ModelNodeConfig[],
    factory: ModelFactory,
    private readonly clock: ModelRequestPoolClock = createRealClock(),
  ) {
    if (nodes.length === 0) throw new Error('模型请求池至少需要一个模型节点');
    this.workers = nodes.map((node) => new ModelWorker(node, factory, clock));
  }

  /**
   * 为一次Agent运行固定模型节点
   * @param metadata 调度元数据
   * @returns 官方Model代理
   */
  acquireModel(metadata: ModelRunMetadata): Model {
    const worker = this.selectWorker();
    console.info(
      `🚧 [AgentRuntime-ModelPool-acquire] Agent运行已绑定模型节点 source=${metadata.source} priority=${metadata.priority ?? DEFAULT_PRIORITY} modelNodeId=${worker.nodeId} queueLength=${worker.queueLength}`,
    );
    return worker.createModel(metadata);
  }

  /** 读取模型节点状态 */
  getStates(): readonly ModelRuntimeState[] {
    return this.workers.map((worker) => worker.getState());
  }

  // 选择健康且压力最低的节点，全部退避时选择最早恢复的节点。
  private selectWorker(): ModelWorker {
    const now = this.clock.now();
    const healthyWorkers = this.workers.filter((worker) => worker.backoffUntil <= now);
    const candidates = healthyWorkers.length > 0 ? healthyWorkers : this.workers;

    return [...candidates].sort((left, right) => {
      if (healthyWorkers.length === 0 && left.backoffUntil !== right.backoffUntil) {
        return left.backoffUntil - right.backoffUntil;
      }
      return left.loadScore - right.loadScore;
    })[0];
  }
}

/**
 * 单模型节点调度器
 *
 * 只维护并发、间隔、队列和429退避，不理解Agent消息、工具或终态语义。
 */
class ModelWorker {
  private readonly queue: PendingModelRequest[] = [];
  private activeCount = 0;
  private nextAvailableAt = 0;
  private backoffUntilValue = 0;
  private currentBackoffMs = 0;
  private draining = false;
  private modelPromise: Promise<Model> | undefined;

  constructor(
    private readonly node: ModelNodeConfig,
    private readonly factory: ModelFactory,
    private readonly clock: ModelRequestPoolClock,
  ) {}

  get nodeId(): string {
    return this.node.id;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get loadScore(): number {
    return this.queue.length + this.activeCount;
  }

  get backoffUntil(): number {
    return this.backoffUntilValue;
  }

  /** 创建固定绑定当前节点的Model代理。 */
  createModel(metadata: ModelRunMetadata): Model {
    return {
      getResponse: async (request: ModelRequest): Promise<ModelResponse> =>
        await this.enqueue(metadata, async (model) => await model.getResponse(request)),
      getStreamedResponse: (request: ModelRequest): AsyncIterable<StreamEvent> =>
        this.streamResponse(metadata, request),
    };
  }

  // 先在节点队列内完整消费流，失败时才能安全重试且不会向Runner重复输出事件。
  private async *streamResponse(
    metadata: ModelRunMetadata,
    request: ModelRequest,
  ): AsyncIterable<StreamEvent> {
    const events = await this.enqueue(metadata, async (model) => {
      const buffered: StreamEvent[] = [];
      for await (const event of model.getStreamedResponse(request)) buffered.push(event);
      return buffered;
    });
    for (const event of events) yield event;
  }

  /** 读取运行状态 */
  getState(): ModelRuntimeState {
    return {
      id: this.node.id,
      queueLength: this.queue.length,
      activeCount: this.activeCount,
      nextAvailableAt: this.nextAvailableAt,
      backoffUntil: this.backoffUntilValue,
    };
  }

  // 将一个SDK模型请求加入节点队列。
  private enqueue<T>(metadata: ModelRunMetadata, run: (model: Model) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        metadata,
        createdAt: this.clock.now(),
        run,
        resolve,
        reject,
        attemptCount: 0,
      } as PendingModelRequest);
      void this.drain();
    });
  }

  // 持续尝试启动请求，直到并发、间隔或退避条件阻塞。
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length > 0) {
        this.dropExpiredHead();
        if (this.queue.length === 0) return;

        const waitMs = this.getWaitMs();
        if (waitMs > 0) {
          await this.clock.sleep(waitMs);
          continue;
        }
        if (this.activeCount >= this.node.maxConcurrency) return;

        const pending = this.queue.shift();
        if (!pending) return;
        if (this.isExpired(pending)) {
          pending.reject(new Error('模型请求已超过队列存活时间'));
          continue;
        }
        this.startRequest(pending);
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0 && this.activeCount < this.node.maxConcurrency) {
        void this.drain();
      }
    }
  }

  // 启动一次真实SDK模型请求。
  private startRequest(pending: PendingModelRequest): void {
    const startedAt = this.clock.now();
    const attemptNumber = pending.attemptCount + 1;
    pending.attemptCount = attemptNumber;
    this.activeCount += 1;
    this.nextAvailableAt = startedAt + this.node.minIntervalMs;
    console.info(
      `🚧 [AgentRuntime-ModelWorker-start] 开始模型请求 modelNodeId=${this.node.id} attempt=${attemptNumber} queueWaitMs=${Math.max(0, startedAt - pending.createdAt)}`,
    );

    void this.getModel()
      .then(async (model) => await pending.run(model))
      .then((result) => {
        this.currentBackoffMs = 0;
        this.backoffUntilValue = 0;
        pending.resolve(result);
        console.info(
          `✅ [AgentRuntime-ModelWorker-complete] 模型请求完成 modelNodeId=${this.node.id} attempt=${attemptNumber}`,
        );
      })
      .catch((error: unknown) => this.handleRequestError(error, pending))
      .finally(() => {
        this.activeCount -= 1;
        void this.drain();
      });
  }

  // 只重试当前尚未返回Runner的模型请求。
  private handleRequestError(error: unknown, pending: PendingModelRequest): void {
    if (
      isModelRequestError(error) &&
      error.statusCode === 429 &&
      pending.attemptCount <= this.node.maxRetries &&
      !this.isExpired(pending)
    ) {
      const backoffMs = this.applyBackoff(error.retryAfterMs);
      this.queue.unshift(pending);
      console.warn(
        `🔁 [AgentRuntime-ModelWorker-retry] 模型触发429，节点进入退避 modelNodeId=${this.node.id} attempt=${pending.attemptCount} backoffMs=${backoffMs}`,
      );
      return;
    }

    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `⚠️ [AgentRuntime-ModelWorker-fail] 模型请求失败 modelNodeId=${this.node.id} attempt=${pending.attemptCount} reason=${reason}`,
    );
    pending.reject(error instanceof Error ? error : new Error(reason));
  }

  // 延迟创建并缓存节点Model。
  private getModel(): Promise<Model> {
    this.modelPromise ??= this.factory.getModel(this.node);
    return this.modelPromise;
  }

  // 计算节点退避时间。
  private applyBackoff(retryAfterMs: number | undefined): number {
    const fallbackBackoff =
      this.currentBackoffMs > 0
        ? Math.min(this.currentBackoffMs * this.node.backoff.multiplier, this.node.backoff.maxMs)
        : this.node.backoff.initialMs;
    const backoffMs = retryAfterMs ?? fallbackBackoff;
    this.currentBackoffMs = Math.min(backoffMs, this.node.backoff.maxMs);
    this.backoffUntilValue = this.clock.now() + this.currentBackoffMs;
    return this.currentBackoffMs;
  }

  // 读取当前阻塞等待时间。
  private getWaitMs(): number {
    if (this.activeCount >= this.node.maxConcurrency) return 0;
    const now = this.clock.now();
    return Math.max(0, this.nextAvailableAt - now, this.backoffUntilValue - now);
  }

  // 清理队首过期请求。
  private dropExpiredHead(): void {
    while (this.queue.length > 0) {
      const pending = this.queue[0];
      if (!this.isExpired(pending)) return;
      this.queue.shift();
      pending.reject(new Error('模型请求已超过队列存活时间'));
      console.warn(
        `⚠️ [AgentRuntime-ModelWorker-expire] 模型请求队列等待超时 modelNodeId=${this.node.id} source=${pending.metadata.source}`,
      );
    }
  }

  // 判断请求是否超过队列存活时间。
  private isExpired(pending: PendingModelRequest): boolean {
    const priority = pending.metadata.priority ?? DEFAULT_PRIORITY;
    const ttlMs = pending.metadata.ttlMs ?? DEFAULT_TTL_BY_PRIORITY[priority];
    return this.clock.now() - pending.createdAt > ttlMs;
  }
}

// 创建真实时间依赖。
function createRealClock(): ModelRequestPoolClock {
  return {
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}
