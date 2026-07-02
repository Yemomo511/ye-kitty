import { RxjsEventBus } from '@kitty/shared/infrastructure/rxjs-event-bus';
import type { QqBotClientPort } from '../ports/qq-bot-client.port';
import { OneBotQqBotClient } from '../infrastructure/onebot-qq-bot.client';
import {
  OneBotFastifyReverseWsServer,
  type OneBotReverseWebSocketConfig,
} from '../infrastructure/onebot-fastify-reverse-ws.server';
import {
  QqAccountExperimentChannel,
  type QqAccountExperimentChannelConfig,
} from './qq-account-experiment-channel';

/**
 * QQ账号实验通道运行配置
 *
 * 同时包含 WebSocket 监听配置和 QQ 消息来源白名单。
 */
export interface QqAccountExperimentRuntimeConfig
  extends OneBotReverseWebSocketConfig, QqAccountExperimentChannelConfig {}

/**
 * QQ账号实验通道运行时
 *
 * 暴露通道实例、事件总线、QQ 发送端口和生命周期方法。
 * 调用 start 后会占用本地 WebSocket 端口。
 */
export interface QqAccountExperimentRuntime {
  /** 实验通道实例 */
  readonly channel: QqAccountExperimentChannel;
  /** 消息事件总线 */
  readonly eventBus: RxjsEventBus;
  /** QQ消息发送端口 */
  readonly botClient: QqBotClientPort;
  /** 启动通道 */
  start(): Promise<void>;
  /** 停止通道 */
  stop(): Promise<void>;
}

/**
 * 创建QQ账号实验通道
 * @param config 运行配置
 * @returns 通道运行时
 */
export function createQqAccountExperimentChannel(
  config: QqAccountExperimentRuntimeConfig,
): QqAccountExperimentRuntime {
  const eventBus = new RxjsEventBus();
  const server = new OneBotFastifyReverseWsServer(config);
  const botClient = new OneBotQqBotClient(server);
  const channel = new QqAccountExperimentChannel(config, server, eventBus);

  return {
    channel,
    eventBus,
    botClient,
    async start() {
      await channel.start();
    },
    async stop() {
      await channel.stop();
    },
  };
}

/**
 * 读取QQ账号实验配置
 * @param env 环境变量
 * @returns 运行配置
 */
export function loadQqAccountExperimentConfig(
  env: NodeJS.ProcessEnv = process.env,
): QqAccountExperimentRuntimeConfig {
  const accessToken = env.YE_KITTY_ONEBOT_ACCESS_TOKEN;
  const selfQqId = env.YE_KITTY_QQ_SELF_ID;
  const groupAllowlist = env.YE_KITTY_QQ_GROUP_ALLOWLIST ?? '';
  const friendAllowlist = env.YE_KITTY_QQ_FRIEND_ALLOWLIST ?? '';

  if (!accessToken) throw new Error('缺少 YE_KITTY_ONEBOT_ACCESS_TOKEN');
  if (!selfQqId) throw new Error('缺少 YE_KITTY_QQ_SELF_ID');

  return {
    host: env.YE_KITTY_ONEBOT_WS_HOST ?? '0.0.0.0',
    port: readPort(env.YE_KITTY_ONEBOT_WS_PORT),
    path: env.YE_KITTY_ONEBOT_WS_PATH ?? '/onebot/v11',
    accessToken,
    selfQqId,
    allowedGroupIds: parseIdList(groupAllowlist),
    allowedFriendIds: parseIdList(friendAllowlist),
  };
}

// 读取 WebSocket 监听端口
function readPort(rawPort: string | undefined): number {
  const port = Number(rawPort ?? '3001');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('YE_KITTY_ONEBOT_WS_PORT 必须是 0 到 65535 之间的整数');
  }

  return port;
}

// 解析 [123, 456] 或逗号分隔ID
function parseIdList(rawList: string): readonly string[] {
  const trimmedList = rawList.trim();
  if (trimmedList.length === 0) return [];

  const normalizedList =
    trimmedList.startsWith('[') && trimmedList.endsWith(']')
      ? trimmedList.slice(1, -1)
      : trimmedList;

  return normalizedList
    .split(',')
    .map((item) => item.trim())
    .map((item) => item.replace(/^['"]|['"]$/g, ''))
    .filter((item) => item.length > 0);
}
