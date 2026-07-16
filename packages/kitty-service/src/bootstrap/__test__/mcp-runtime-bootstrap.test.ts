import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { bootstrapMcpRuntime, type BootstrappedMcpRuntime } from '../mcp-runtime-bootstrap';
import { McpRuntimeService } from '../../services/agent-runtime/application/mcp-runtime.service';
import { XiaohongshuMcpDockerBootstrap } from '../xiaohongshu-mcp-docker-bootstrap';

describe('MCP启动编排', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  test('选择小红书时按Docker、Runtime、登录顺序启动', async () => {
    const order: string[] = [];
    const runtime = createRuntimeStub(order);
    const runtimeFactory = vi.fn(() => runtime);
    const loginService = {
      ensureLoggedIn: vi.fn(async () => {
        order.push('login');
        return { status: 'logged_in' as const };
      }),
    };

    const result = await bootstrapMcpRuntime({
      startDirectory: '/project',
      env: {},
      includeXiaohongshu: true,
      loadConfig: vi.fn(async () => ({ servers: [] })),
      createRuntime: runtimeFactory,
      dockerBootstrap: {
        start: vi.fn(async () => {
          order.push('docker');
        }),
      },
      createLoginService: vi.fn(() => loginService),
    });

    expect(result).toBe(runtime);
    expect(order).toEqual(['docker', 'runtime', 'login']);
    expect(runtimeFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        servers: [
          expect.objectContaining({
            name: 'xiaohongshu',
            url: 'http://127.0.0.1:18060/mcp',
          }),
        ],
      }),
    );
  });

  test('普通启动没有MCP配置时不创建运行时', async () => {
    const createRuntime = vi.fn();

    await expect(
      bootstrapMcpRuntime({
        startDirectory: '/project',
        env: {},
        includeXiaohongshu: false,
        loadConfig: vi.fn(async () => ({ servers: [] })),
        createRuntime,
      }),
    ).resolves.toBeUndefined();
    expect(createRuntime).not.toHaveBeenCalled();
  });

  test('远端自定义模式可以跳过本地Docker', async () => {
    const order: string[] = [];
    const runtime = createRuntimeStub(order);
    const dockerBootstrap = { start: vi.fn(async () => undefined) };

    await bootstrapMcpRuntime({
      startDirectory: '/project',
      env: { YE_KITTY_XIAOHONGSHU_MCP_DOCKER: 'false' },
      includeXiaohongshu: true,
      loadConfig: vi.fn(async () => ({ servers: [] })),
      createRuntime: vi.fn(() => runtime),
      dockerBootstrap,
      createLoginService: vi.fn(() => ({
        ensureLoggedIn: vi.fn(async () => ({ status: 'already_logged_in' as const })),
      })),
    });

    expect(dockerBootstrap.start).not.toHaveBeenCalled();
  });

  test('登录失败时关闭已经连接的MCP运行时', async () => {
    const runtime = createRuntimeStub([]);

    await expect(
      bootstrapMcpRuntime({
        startDirectory: '/project',
        env: {},
        includeXiaohongshu: true,
        loadConfig: vi.fn(async () => ({ servers: [] })),
        createRuntime: vi.fn(() => runtime),
        dockerBootstrap: { start: vi.fn(async () => undefined) },
        createLoginService: vi.fn(() => ({
          ensureLoggedIn: vi.fn(async () => {
            throw new Error('扫码失败');
          }),
        })),
      }),
    ).rejects.toThrow('扫码失败');
    expect(runtime.stop).toHaveBeenCalledOnce();
  });

  test('默认配置加载器在没有配置文件时跳过Runtime', async () => {
    const directory = await createTemporaryDirectory();

    await expect(
      bootstrapMcpRuntime({
        startDirectory: directory,
        env: {},
        includeXiaohongshu: false,
      }),
    ).resolves.toBeUndefined();
  });

  test('默认Runtime工厂可以启动通用MCP配置', async () => {
    vi.spyOn(McpRuntimeService.prototype, 'start').mockResolvedValue(undefined);
    const runtime = await bootstrapMcpRuntime({
      startDirectory: '/project',
      env: {},
      includeXiaohongshu: false,
      loadConfig: vi.fn(async () => ({
        servers: [
          {
            name: 'remote',
            transport: 'http' as const,
            url: 'https://example.com/mcp',
            headers: {},
            timeoutMs: 1000,
            allowedTools: [],
            defaultRiskLevel: 'medium' as const,
            toolRiskLevels: {},
          },
        ],
      })),
    });

    expect(runtime).toBeInstanceOf(McpRuntimeService);
    expect(McpRuntimeService.prototype.start).toHaveBeenCalledOnce();
  });

  test('默认登录服务读取环境参数并确认已登录账号', async () => {
    const runtime = createRuntimeStub([]);
    vi.spyOn(runtime, 'callToolRaw').mockResolvedValue({
      content: [{ type: 'text', text: '✅ 已登录\n用户名: 叶猫猫' }],
    });

    await expect(
      bootstrapMcpRuntime({
        startDirectory: '/project',
        env: {
          YE_KITTY_XIAOHONGSHU_LOGIN_TIMEOUT_MS: '1000',
          YE_KITTY_XIAOHONGSHU_LOGIN_POLL_INTERVAL_MS: '100',
        },
        includeXiaohongshu: true,
        loadConfig: vi.fn(async () => ({ servers: [] })),
        createRuntime: vi.fn(() => runtime),
        dockerBootstrap: { start: vi.fn(async () => undefined) },
      }),
    ).resolves.toBe(runtime);
    expect(runtime.callToolRaw).toHaveBeenCalledWith('xiaohongshu_check_login_status', null);
  });

  test('默认Docker工厂向上查找Compose并读取启动超时', async () => {
    const start = vi
      .spyOn(XiaohongshuMcpDockerBootstrap.prototype, 'start')
      .mockResolvedValue(undefined);
    const runtime = createRuntimeStub([]);

    await bootstrapMcpRuntime({
      startDirectory: process.cwd(),
      env: { YE_KITTY_XIAOHONGSHU_DOCKER_TIMEOUT_MS: '1000' },
      includeXiaohongshu: true,
      loadConfig: vi.fn(async () => ({ servers: [] })),
      createRuntime: vi.fn(() => runtime),
      createLoginService: vi.fn(() => ({
        ensureLoggedIn: vi.fn(async () => ({ status: 'already_logged_in' })),
      })),
    });

    expect(start).toHaveBeenCalledOnce();
  });

  test('默认Docker工厂在找不到Compose时中断', async () => {
    const directory = await createTemporaryDirectory();

    await expect(
      bootstrapMcpRuntime({
        startDirectory: directory,
        env: {},
        includeXiaohongshu: true,
        loadConfig: vi.fn(async () => ({ servers: [] })),
      }),
    ).rejects.toThrow('未找到 deploy/xiaohongshu/compose.yml');
  });

  test('非法登录超时会关闭已经启动的Runtime', async () => {
    const runtime = createRuntimeStub([]);

    await expect(
      bootstrapMcpRuntime({
        startDirectory: '/project',
        env: { YE_KITTY_XIAOHONGSHU_LOGIN_TIMEOUT_MS: '0' },
        includeXiaohongshu: true,
        loadConfig: vi.fn(async () => ({ servers: [] })),
        createRuntime: vi.fn(() => runtime),
        dockerBootstrap: { start: vi.fn(async () => undefined) },
      }),
    ).rejects.toThrow('YE_KITTY_XIAOHONGSHU_LOGIN_TIMEOUT_MS 必须是正整数');
    expect(runtime.stop).toHaveBeenCalledOnce();
  });

  async function createTemporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'ye-kitty-mcp-bootstrap-'));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, 'nested'));
    return join(directory, 'nested');
  }
});

function createRuntimeStub(order: string[]): BootstrappedMcpRuntime & {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    start: vi.fn(async () => {
      order.push('runtime');
    }),
    stop: vi.fn(async () => undefined),
    listTools: vi.fn(() => []),
    getTool: vi.fn(() => undefined),
    execute: vi.fn(async (call) => ({
      toolName: call.toolName,
      success: true,
      observation: '成功',
    })),
    hasTool: vi.fn(() => true),
    callToolRaw: vi.fn(async () => ({ content: [] })),
  };
}
