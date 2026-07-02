import {
  createQqReplyAgent,
  loadQqReplyAgentConfig,
  type QqReplyAgentRuntimeConfig,
} from '@kitty/services/agent-runtime';
import {
  createQqAccountExperimentChannel,
  loadQqAccountExperimentConfig,
  type QqAccountExperimentRuntime,
  type QqAccountExperimentRuntimeConfig,
} from '@kitty/platforms/qq/application/qq-account-experiment.factory';
import { QqMessageAdapter } from './qq-message-adapter';

/**
 * 消息调度层运行配置
 *
 * 组合平台接入配置和 Agent Runtime 配置。
 */
export interface MessageAdapterRuntimeConfig
  extends QqAccountExperimentRuntimeConfig, QqReplyAgentRuntimeConfig {}

/**
 * 消息调度层运行时
 *
 * 持有 QQ runtime 和 QQ 消息适配器。
 * 启动顺序固定为先注册订阅，再启动 QQ WebSocket 服务。
 */
export interface MessageAdapterRuntime {
  /** QQ实验通道运行时 */
  readonly qqRuntime: QqAccountExperimentRuntime;
  /** QQ消息适配器 */
  readonly qqMessageAdapter: QqMessageAdapter;
  /** 启动调度层 */
  start(): Promise<void>;
  /** 停止调度层 */
  stop(): Promise<void>;
}

/**
 * 创建消息调度层运行时
 * @param config 运行配置
 * @returns 调度层运行时
 */
export function createMessageAdapterRuntime(
  config: MessageAdapterRuntimeConfig,
): MessageAdapterRuntime {
  const qqRuntime = createQqAccountExperimentChannel(config);
  const replyAgent = createQqReplyAgent(config);
  const qqMessageAdapter = new QqMessageAdapter(
    qqRuntime.eventBus,
    qqRuntime.botClient,
    replyAgent,
  );

  return {
    qqRuntime,
    qqMessageAdapter,
    async start() {
      // 1. 先注册消息订阅，避免启动瞬间的 QQ 消息丢失。
      await qqMessageAdapter.start();
      // 2. 再启动 QQ WebSocket 服务，等待 NapCat 推送事件。
      await qqRuntime.start();
    },
    async stop() {
      await qqRuntime.stop();
    },
  };
}

/**
 * 读取消息调度层配置
 * @param env 环境变量
 * @returns 运行配置
 */
export function loadMessageAdapterRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): MessageAdapterRuntimeConfig {
  return {
    ...loadQqAccountExperimentConfig(env),
    ...loadQqReplyAgentConfig(env),
  };
}
