import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { loadMcpRuntimeConfig } from '../loader';

describe('MCP配置文件加载', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  test('从启动目录向上发现项目级.mcp.json', async () => {
    const root = await createTemporaryDirectory();
    const nested = join(root, 'packages', 'service');
    await mkdir(nested, { recursive: true });
    await mkdir(join(root, '.git'));
    await writeFile(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { docs: { url: 'https://docs.example.com/mcp' } } }),
      'utf8',
    );

    const loaded = await loadMcpRuntimeConfig({ startDirectory: nested, env: {} });

    expect(loaded.sourcePath).toBe(join(root, '.mcp.json'));
    expect(loaded.config.servers[0]).toMatchObject({ name: 'docs', transport: 'http' });
  });

  test('显式配置路径优先于自动发现', async () => {
    const root = await createTemporaryDirectory();
    const explicitPath = join(root, 'custom-mcp.json');
    await writeFile(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { auto: { command: 'node' } } }),
      'utf8',
    );
    await writeFile(
      explicitPath,
      JSON.stringify({ mcpServers: { explicit: { command: 'node' } } }),
      'utf8',
    );

    const loaded = await loadMcpRuntimeConfig({
      startDirectory: root,
      env: { YE_KITTY_MCP_CONFIG_PATH: explicitPath },
    });

    expect(loaded.sourcePath).toBe(explicitPath);
    expect(loaded.config.servers.map((server) => server.name)).toEqual(['explicit']);
  });

  test('没有配置文件时返回空配置', async () => {
    const root = await createTemporaryDirectory();

    await expect(loadMcpRuntimeConfig({ startDirectory: root, env: {} })).resolves.toEqual({
      config: { servers: [] },
      sourcePath: undefined,
    });
  });

  test('配置文件损坏时保留原始错误链', async () => {
    const root = await createTemporaryDirectory();
    await writeFile(join(root, '.mcp.json'), '{invalid-json', 'utf8');

    await expect(loadMcpRuntimeConfig({ startDirectory: root, env: {} })).rejects.toMatchObject({
      message: expect.stringContaining('MCP配置文件读取失败'),
      cause: expect.any(SyntaxError),
    });
  });

  async function createTemporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'ye-kitty-mcp-'));
    temporaryDirectories.push(directory);
    return directory;
  }
});
