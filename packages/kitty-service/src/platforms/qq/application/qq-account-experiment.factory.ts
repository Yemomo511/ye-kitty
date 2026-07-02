import { RxjsEventBus } from '@kitty/shared/infrastructure/rxjs-event-bus';
import { OneBotQqBotClient } from '../infrastructure/onebot-qq-bot.client';
import {
  OneBotFastifyReverseWsServer,
  type OneBotReverseWebSocketConfig,
} from '../infrastructure/onebot-fastify-reverse-ws.server';
import {
  QqAccountExperimentChannel,
  type QqAccountExperimentChannelConfig,
} from './qq-account-experiment-channel';

export interface QqAccountExperimentRuntimeConfig
  extends OneBotReverseWebSocketConfig,
    QqAccountExperimentChannelConfig {}

export interface QqAccountExperimentRuntime {
  readonly channel: QqAccountExperimentChannel;
  readonly eventBus: RxjsEventBus;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createQqAccountExperimentChannel(
  config: QqAccountExperimentRuntimeConfig,
): QqAccountExperimentRuntime {
  const eventBus = new RxjsEventBus();
  const server = new OneBotFastifyReverseWsServer(config);
  const botClient = new OneBotQqBotClient(server);
  const channel = new QqAccountExperimentChannel(config, server, eventBus, botClient);

  return {
    channel,
    eventBus,
    async start() {
      await channel.start();
    },
    async stop() {
      await channel.stop();
    },
  };
}

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

function readPort(rawPort: string | undefined): number {
  const port = Number(rawPort ?? '3001');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('YE_KITTY_ONEBOT_WS_PORT 必须是 0 到 65535 之间的整数');
  }

  return port;
}

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
