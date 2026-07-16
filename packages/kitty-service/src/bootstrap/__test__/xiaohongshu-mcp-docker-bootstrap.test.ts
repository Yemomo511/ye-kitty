import { afterEach, describe, expect, test, vi } from 'vitest';
import { XiaohongshuMcpDockerBootstrap } from '../xiaohongshu-mcp-docker-bootstrap';

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
});
