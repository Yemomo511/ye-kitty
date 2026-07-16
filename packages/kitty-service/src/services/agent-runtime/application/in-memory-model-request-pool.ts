import type {
  ModelDecisionRequest,
  ModelDecisionResult,
  ModelNodeConfig,
  ModelRequestPoolPort,
  ModelRequestPriority,
  ModelRuntimeState,
} from '../ports/model-request-pool.port';
import { isModelRequestError } from './model-request-error';

/** 模型文本客户端请求 */
export interface ModelTextClientRequest extends ModelDecisionRequest {
  /** 模型节点配置 */
  readonly node: ModelNodeConfig;
}

/** 模型文本客户端 */
export interface ModelTextClient {
  /**
   * 生成模型文本
   * @param request 模型节点和Prompt
   * @returns 模型原始文本
   */
  generateText(request: ModelTextClientRequest): Promise<string>;
}

/** 模型池时钟 */
export interface ModelRequestPoolClock {
  /** 当前毫秒时间戳 */
  readonly now: () => number;
  /** 等待指定毫秒 */
  readonly sleep: (ms: number) => Promise<void>;
}

interface PendingModelRequest {
  readonly input: ModelDecisionRequest;
  readonly createdAt: number;
  readonly resolve: (result: ModelDecisionResult) => void;
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
 * 在 Agent Runtime 内统一调度多个 OpenAI 兼容模型节点。
 * 每个模型节点拥有独立队列、并发令牌、请求间隔和 429 退避状态。
 */
export class InMemoryModelRequestPool implements ModelRequestPoolPort {
  private readonly workers: readonly ModelWorker[];

  constructor(
    nodes: readonly ModelNodeConfig[],
    client: ModelTextClient,
    private readonly clock: ModelRequestPoolClock = createRealClock(),
  ) {
    if (nodes.length === 0) throw new Error('模型请求池至少需要一个模型节点');
    this.workers = nodes.map((node) => new ModelWorker(node, client, clock));
  }

  /**
   * 执行一次模型决策
   * @param input 决策请求
   * @returns 模型文本
   */
  runDecision(input: ModelDecisionRequest): Promise<ModelDecisionResult> {
    const worker = this.selectWorker();
    console.info(
      `🚧 [AgentRuntime-ModelPool-runDecision] 模型请求已入队 source=${input.source} priority=${
        input.priority ?? DEFAULT_PRIORITY
      } modelNodeId=${worker.nodeId} queueLength=${worker.queueLength}`,
    );
    return worker.enqueue(input);
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
 * 单模型调度器
 *
 * 维护一个模型节点的等待队列和运行状态。该类只负责节流、
 * 并发和退避，不理解 Harness、QQ 消息或 Skill 语义。
 */
class ModelWorker {
  private readonly queue: PendingModelRequest[] = [];
  private activeCount = 0;
  private nextAvailableAt = 0;
  private backoffUntilValue = 0;
  private currentBackoffMs = 0;
  private draining = false;

  constructor(
    private readonly node: ModelNodeConfig,
    private readonly client: ModelTextClient,
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

  /** 请求入队 */
  enqueue(input: ModelDecisionRequest): Promise<ModelDecisionResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        input,
        createdAt: this.clock.now(),
        resolve,
        reject,
        attemptCount: 0,
      });
      void this.drain();
    });
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

  // 启动一次真实模型请求。
  private startRequest(pending: PendingModelRequest): void {
    const startedAt = this.clock.now();
    const queueWaitMs = Math.max(0, startedAt - pending.createdAt);
    const attemptNumber = pending.attemptCount + 1;
    pending.attemptCount = attemptNumber;
    this.activeCount += 1;
    this.nextAvailableAt = startedAt + this.node.minIntervalMs;
    console.info(
      `🚧 [AgentRuntime-ModelWorker-startRequest] 开始模型请求 modelNodeId=${this.node.id} attempt=${attemptNumber} queueWaitMs=${queueWaitMs}`,
    );

    void this.client
      .generateText({ ...pending.input, node: this.node })
      .then((text) => {
        this.currentBackoffMs = 0;
        this.backoffUntilValue = 0;
        pending.resolve({
          text,
          modelNodeId: this.node.id,
          queueWaitMs,
          attemptCount: attemptNumber,
          requestDurationMs: Math.max(0, this.clock.now() - startedAt),
        });
        console.info(
          `✅ [AgentRuntime-ModelWorker-startRequest] 模型请求完成 modelNodeId=${this.node.id} attempt=${attemptNumber}`,
        );
      })
      .catch((error: unknown) => this.handleRequestError(error, pending))
      .finally(() => {
        this.activeCount -= 1;
        void this.drain();
      });
  }

  // 处理429重试和不可恢复失败。
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
        `🔁 [AgentRuntime-ModelWorker-retry] 模型触发429，已进入节点退避 modelNodeId=${this.node.id} attempt=${pending.attemptCount} backoffMs=${backoffMs}`,
      );
      return;
    }

    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `⚠️ [AgentRuntime-ModelWorker-fail] 模型请求失败 modelNodeId=${this.node.id} attempt=${pending.attemptCount} reason=${reason}`,
    );
    pending.reject(error instanceof Error ? error : new Error(reason));
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
        `⚠️ [AgentRuntime-ModelWorker-expire] 模型请求队列等待超时 modelNodeId=${this.node.id} source=${pending.input.source}`,
      );
    }
  }

  // 判断请求是否超过队列存活时间。
  private isExpired(pending: PendingModelRequest): boolean {
    const priority = pending.input.priority ?? DEFAULT_PRIORITY;
    const ttlMs = pending.input.ttlMs ?? DEFAULT_TTL_BY_PRIORITY[priority];
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
