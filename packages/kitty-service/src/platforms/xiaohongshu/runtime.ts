import { join } from 'node:path';
import { XiaohongshuMentionSource } from './source';
import { JsonXiaohongshuMentionCheckpointRepository } from './checkpoint';
import { McpXiaohongshuMentionReader } from './reader';
import type { McpRawToolCaller } from '@kitty/shared/mcp';

/** 小红书被提及信息源工厂参数 */
export interface CreateXiaohongshuMentionSourceOptions {
  readonly caller: McpRawToolCaller;
  readonly serverName: string;
  readonly deployDirectory: string;
  readonly env: NodeJS.ProcessEnv;
}

/** 按运行环境装配MCP读取器、检查点与轮询信息源 */
export function createXiaohongshuMentionSource(
  options: CreateXiaohongshuMentionSourceOptions,
): XiaohongshuMentionSource {
  const statePath =
    options.env.YE_KITTY_XIAOHONGSHU_MENTION_STATE_PATH?.trim() ||
    join(options.deployDirectory, 'xiaohongshu', 'data', 'mention-watcher-state.json');
  return new XiaohongshuMentionSource({
    reader: new McpXiaohongshuMentionReader(options.caller, options.serverName),
    checkpointRepository: new JsonXiaohongshuMentionCheckpointRepository(statePath),
    pollIntervalMs: readPositiveInteger(
      options.env.YE_KITTY_XIAOHONGSHU_MENTION_POLL_INTERVAL_MS,
      30_000,
      'YE_KITTY_XIAOHONGSHU_MENTION_POLL_INTERVAL_MS',
    ),
    maxBackoffMs: readPositiveInteger(
      options.env.YE_KITTY_XIAOHONGSHU_MENTION_MAX_BACKOFF_MS,
      120_000,
      'YE_KITTY_XIAOHONGSHU_MENTION_MAX_BACKOFF_MS',
    ),
  });
}

function readPositiveInteger(
  input: string | undefined,
  defaultValue: number,
  name: string,
): number {
  if (input === undefined || input.trim() === '') return defaultValue;
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  return value;
}
