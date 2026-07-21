/** 模型请求优先级 */
export type ModelRequestPriority = 'high' | 'normal' | 'low';

/** 模型节点退避配置 */
export interface ModelBackoffConfig {
  /** 初始退避毫秒 */
  readonly initialMs: number;
  /** 最大退避毫秒 */
  readonly maxMs: number;
  /** 退避倍数 */
  readonly multiplier: number;
}

/** 模型节点配置 */
export interface ModelNodeConfig {
  /** 节点唯一标识 */
  readonly id: string;
  /** OpenAI API Key */
  readonly apiKey: string;
  /** OpenAI兼容地址 */
  readonly baseURL?: string;
  /** 模型名称 */
  readonly model: string;
  /** 最大并发数 */
  readonly maxConcurrency: number;
  /** 请求间隔毫秒 */
  readonly minIntervalMs: number;
  /** 最大重试次数 */
  readonly maxRetries: number;
  /** 429退避配置 */
  readonly backoff: ModelBackoffConfig;
}

/** 模型决策请求 */
export interface ModelDecisionRequest {
  /** Agent名称 */
  readonly agentName: string;
  /** 模型指令 */
  readonly instructions: string;
  /** 单次输入 */
  readonly input: string;
  /** 请求超时毫秒 */
  readonly timeoutMs: number;
  /** 请求优先级 */
  readonly priority?: ModelRequestPriority;
  /** 队列存活毫秒 */
  readonly ttlMs?: number;
  /** 调用来源 */
  readonly source: string;
}

/** 模型决策结果 */
export interface ModelDecisionResult {
  /** 模型文本 */
  readonly text: string;
  /** 命中模型节点 */
  readonly modelNodeId: string;
  /** 排队耗时毫秒 */
  readonly queueWaitMs: number;
  /** 实际请求次数 */
  readonly attemptCount: number;
  /** 请求耗时毫秒 */
  readonly requestDurationMs: number;
}

/** 模型运行状态 */
export interface ModelRuntimeState {
  /** 节点唯一标识 */
  readonly id: string;
  /** 等待队列长度 */
  readonly queueLength: number;
  /** 运行中请求数 */
  readonly activeCount: number;
  /** 下次可请求时间 */
  readonly nextAvailableAt: number;
  /** 退避截止时间 */
  readonly backoffUntil: number;
}

/** 模型请求池公开能力 */
export interface ModelPoolRunner {
  /**
   * 执行一次模型决策
   * @param input 决策请求
   * @returns 模型文本和调度摘要
   */
  runDecision(input: ModelDecisionRequest): Promise<ModelDecisionResult>;
}
