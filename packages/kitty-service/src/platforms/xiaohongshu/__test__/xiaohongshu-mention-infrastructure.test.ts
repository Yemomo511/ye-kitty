import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createXiaohongshuMentionSource } from '../application/xiaohongshu-mention.factory';
import { JsonXiaohongshuMentionCheckpointRepository } from '../infrastructure/json-xiaohongshu-mention-checkpoint.repository';

describe('小红书被提及基础设施', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  test('JSON仓库首次返回空并可原子保存、恢复检查点', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, 'nested', 'mention-state.json');
    const repository = new JsonXiaohongshuMentionCheckpointRepository(filePath);

    await expect(repository.load()).resolves.toBeUndefined();
    await repository.save({ initialized: true, recentMentionIds: ['mention-1'] });

    await expect(repository.load()).resolves.toEqual({
      initialized: true,
      recentMentionIds: ['mention-1'],
    });
    await expect(readFile(filePath, 'utf8')).resolves.toContain('mention-1');
  });

  test('JSON仓库拒绝损坏的检查点', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, 'invalid.json');
    await writeFile(filePath, '{"initialized":false,"recentMentionIds":[]}');
    const repository = new JsonXiaohongshuMentionCheckpointRepository(filePath);

    await expect(repository.load()).rejects.toThrow('检查点结构无效');
  });

  test('工厂读取轮询、退避和状态路径配置', async () => {
    const caller = { hasTool: vi.fn(() => true), callToolRaw: vi.fn() };
    const source = createXiaohongshuMentionSource({
      caller,
      serverName: 'xhs-local',
      deployDirectory: '/project/deploy',
      env: {
        YE_KITTY_XIAOHONGSHU_MENTION_POLL_INTERVAL_MS: '15000',
        YE_KITTY_XIAOHONGSHU_MENTION_MAX_BACKOFF_MS: '60000',
        YE_KITTY_XIAOHONGSHU_MENTION_STATE_PATH: '/tmp/xhs-state.json',
      },
    });

    expect(source).toBeDefined();
    expect(() =>
      createXiaohongshuMentionSource({
        caller,
        serverName: 'xhs-local',
        deployDirectory: '/project/deploy',
        env: { YE_KITTY_XIAOHONGSHU_MENTION_POLL_INTERVAL_MS: '0' },
      }),
    ).toThrow('YE_KITTY_XIAOHONGSHU_MENTION_POLL_INTERVAL_MS 必须是正整数');
  });

  async function createTemporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'ye-kitty-xhs-mention-'));
    temporaryDirectories.push(directory);
    return directory;
  }
});
