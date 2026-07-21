import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { findNearestDirectory, loadNearestEnvFile } from './environment';

describe('启动环境查找', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  test('向上读取最近.env并保留进程已有变量', async () => {
    const root = await createTemporaryDirectory();
    const nested = join(root, 'packages', 'service');
    await mkdir(nested, { recursive: true });
    await writeFile(
      join(root, '.env'),
      ['# 注释', 'EXISTING=来自文件', 'DOUBLE="双引号"', "SINGLE='单引号'", 'INVALID'].join('\n'),
    );
    const env: NodeJS.ProcessEnv = { EXISTING: '来自进程' };

    loadNearestEnvFile(nested, env);

    expect(env).toMatchObject({
      EXISTING: '来自进程',
      DOUBLE: '双引号',
      SINGLE: '单引号',
    });
    expect(env.INVALID).toBeUndefined();
  });

  test('向上查找最近的项目目录', async () => {
    const root = await createTemporaryDirectory();
    const skills = join(root, 'skills');
    const nested = join(root, 'packages', 'service');
    await mkdir(skills);
    await mkdir(nested, { recursive: true });

    expect(findNearestDirectory(nested, 'skills')).toBe(skills);
  });

  test('不存在环境文件或目录时安全返回', async () => {
    const root = await createTemporaryDirectory();
    const env: NodeJS.ProcessEnv = {};

    loadNearestEnvFile(root, env);

    expect(env).toEqual({});
    expect(findNearestDirectory(root, 'skills')).toBeUndefined();
  });

  async function createTemporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'ye-kitty-runtime-environment-'));
    temporaryDirectories.push(directory);
    return directory;
  }
});
