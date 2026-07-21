import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  resolvePatchedXiaohongshuMcpImage,
  resolveXiaohongshuMcpImage,
  XiaohongshuMcpDockerBootstrap,
} from './docker';

describe('小红书MCP Docker启动', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('启动Compose并等待健康检查成功', async () => {
    const runCommand = vi.fn(async () => undefined);
    const checkHealth = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const sleep = vi.fn(async () => undefined);
    const bootstrap = new XiaohongshuMcpDockerBootstrap({
      composePath: '/project/deploy/xiaohongshu/compose.yml',
      healthUrl: 'http://127.0.0.1:18060/health',
      timeoutMs: 5000,
      pollIntervalMs: 1000,
      runCommand,
      checkHealth,
      sleep,
      now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1000),
    });

    await bootstrap.start();

    expect(runCommand).toHaveBeenCalledWith('docker', [
      'compose',
      '-f',
      '/project/deploy/xiaohongshu/compose.yml',
      'up',
      '-d',
      '--build',
    ]);
    expect(checkHealth).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  test('Compose启动失败时给出Docker处理入口', async () => {
    const bootstrap = new XiaohongshuMcpDockerBootstrap({
      composePath: '/project/deploy/xiaohongshu/compose.yml',
      healthUrl: 'http://127.0.0.1:18060/health',
      runCommand: vi.fn(async () => {
        throw new Error('docker: command not found');
      }),
      checkHealth: vi.fn(async () => false),
    });

    await expect(bootstrap.start()).rejects.toThrow('Docker');
  });

  test('健康检查超时时给出日志命令', async () => {
    let now = 0;
    const bootstrap = new XiaohongshuMcpDockerBootstrap({
      composePath: '/project/deploy/xiaohongshu/compose.yml',
      healthUrl: 'http://127.0.0.1:18060/health',
      timeoutMs: 2000,
      pollIntervalMs: 1000,
      runCommand: vi.fn(async () => undefined),
      checkHealth: vi.fn(async () => false),
      sleep: vi.fn(async (milliseconds: number) => {
        now += milliseconds;
      }),
      now: () => now,
    });

    await expect(bootstrap.start()).rejects.toThrow('pnpm xiaohongshu:logs');
  });

  test('默认HTTP检查和等待能力可以在服务稍后就绪时继续启动', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('服务尚未启动'))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const bootstrap = new XiaohongshuMcpDockerBootstrap({
      composePath: '/project/deploy/xiaohongshu/compose.yml',
      healthUrl: 'http://127.0.0.1:18060/health',
      pollIntervalMs: 0,
      runCommand: vi.fn(async () => undefined),
    });

    await expect(bootstrap.start()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('Apple Silicon自动选择上游ARM64镜像并保留用户显式配置', () => {
    expect(resolveXiaohongshuMcpImage(undefined, 'arm64')).toBe(
      'xpzouying/xiaohongshu-mcp:latest-arm64',
    );
    expect(resolveXiaohongshuMcpImage(undefined, 'x64')).toBe('xpzouying/xiaohongshu-mcp');
    expect(resolveXiaohongshuMcpImage('registry.example.com/xhs:v1', 'arm64')).toBe(
      'registry.example.com/xhs:v1',
    );
  });

  test('补丁镜像使用独立默认名称并允许显式覆盖', () => {
    expect(resolvePatchedXiaohongshuMcpImage(undefined)).toBe(
      'ye-kitty/xiaohongshu-mcp-mentions:local',
    );
    expect(resolvePatchedXiaohongshuMcpImage('registry.example.com/xhs-mentions:v1')).toBe(
      'registry.example.com/xhs-mentions:v1',
    );
  });

  test('启动Compose时注入已选择的镜像环境', async () => {
    const runCommand = vi.fn(async () => undefined);
    const bootstrap = new XiaohongshuMcpDockerBootstrap({
      composePath: '/project/deploy/xiaohongshu/compose.yml',
      healthUrl: 'http://127.0.0.1:18060/health',
      environment: {
        YE_KITTY_XIAOHONGSHU_MCP_IMAGE: 'xpzouying/xiaohongshu-mcp:latest-arm64',
      },
      runCommand,
      checkHealth: vi.fn(async () => true),
    });

    await bootstrap.start();

    expect(runCommand).toHaveBeenCalledWith(
      'docker',
      ['compose', '-f', '/project/deploy/xiaohongshu/compose.yml', 'up', '-d', '--build'],
      { YE_KITTY_XIAOHONGSHU_MCP_IMAGE: 'xpzouying/xiaohongshu-mcp:latest-arm64' },
    );
  });
});
