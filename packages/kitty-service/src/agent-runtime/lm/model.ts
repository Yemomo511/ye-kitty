import type { Model } from '@openai/agents';

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

/** 单次Agent运行的模型调度元数据。 */
export interface ModelRunMetadata {
  /** 请求优先级 */
  readonly priority?: ModelRequestPriority;
  /** 每次模型请求的队列存活毫秒 */
  readonly ttlMs?: number;
  /** 调用来源 */
  readonly source: string;
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

/** 模型节点工厂。 */
export interface ModelFactory {
  /**
   * 获取节点对应的官方SDK Model
   * @param node 模型节点
   * @returns 官方模型
   */
  getModel(node: ModelNodeConfig): Promise<Model>;
}

/** 模型请求池公开能力。 */
export interface ModelPoolRunner {
  /**
   * 为一次Agent运行固定模型节点
   * @param metadata 系统调度元数据
   * @returns 受队列、并发和退避治理的官方Model
   */
  acquireModel(metadata: ModelRunMetadata): Model;
}
