import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import type { McpRuntimeConfig } from '../services/agent-runtime/domain/mcp';
import type { RuntimeToolExecutorPort } from '../services/agent-runtime/ports/tool-executor.port';
import type { RuntimeToolRegistryPort } from '../services/agent-runtime/ports/tool-registry.port';
import type { McpRawToolCallerPort } from '../services/agent-runtime/ports/mcp-raw-tool-caller.port';
import { McpRuntimeService } from '../services/agent-runtime/application/mcp-runtime.service';
import {
  createXiaohongshuMcpServerConfig,
  withXiaohongshuMcpServer,
} from '../services/agent-runtime/application/xiaohongshu-mcp-config';
import { XiaohongshuMcpLoginService } from '../services/agent-runtime/application/xiaohongshu-mcp-login.service';
import { loadMcpRuntimeConfig } from '../services/agent-runtime/infrastructure/mcp/mcp-config-loader';
import { OpenAiMcpClientFactory } from '../services/agent-runtime/infrastructure/mcp/openai-mcp-client.factory';
import { LocalXiaohongshuQrcodePresenter } from '../services/agent-runtime/infrastructure/mcp/xiaohongshu-qrcode.presenter';
import {
  resolveXiaohongshuMcpImage,
  XiaohongshuMcpDockerBootstrap,
} from './xiaohongshu-mcp-docker-bootstrap';

/** 已启动MCP运行时能力 */
export interface BootstrappedMcpRuntime
  extends RuntimeToolRegistryPort, RuntimeToolExecutorPort, McpRawToolCallerPort {
  /** 建立全部Server连接 */
  start(): Promise<void>;
  /** 关闭全部Server连接 */
  stop(): Promise<void>;
}

/** 小红书MCP容器启动能力 */
export interface XiaohongshuMcpDockerStarter {
  /** 启动并等待服务就绪 */
  start(): Promise<void>;
}

/** 小红书登录检查能力 */
export interface XiaohongshuMcpLoginChecker {
  /** 确保账号已登录 */
  ensureLoggedIn(): Promise<unknown>;
}

/** MCP启动编排参数 */
export interface McpRuntimeBootstrapOptions {
  /** 项目启动目录 */
  readonly startDirectory: string;
  /** 运行环境变量 */
  readonly env: NodeJS.ProcessEnv;
  /** 是否启用小红书 */
  readonly includeXiaohongshu: boolean;
  /** 配置加载能力 */
  readonly loadConfig?: () => Promise<McpRuntimeConfig>;
  /** Runtime创建能力 */
  readonly createRuntime?: (config: McpRuntimeConfig) => BootstrappedMcpRuntime;
  /** Docker启动能力 */
  readonly dockerBootstrap?: XiaohongshuMcpDockerStarter;
  /** 登录服务创建能力 */
  readonly createLoginService?: (
    runtime: BootstrappedMcpRuntime,
    serverName: string,
  ) => XiaohongshuMcpLoginChecker;
}

/**
 * 启动通用MCP运行时
 *
 * 小红书模式会先确保上游容器就绪，再连接MCP并完成登录检查。
 * 登录失败会关闭已经建立的MCP会话，但保留容器便于用户查看日志或重试。
 */
export async function bootstrapMcpRuntime(
  options: McpRuntimeBootstrapOptions,
): Promise<BootstrappedMcpRuntime | undefined> {
  const loadConfig =
    options.loadConfig ??
    (async () =>
      (
        await loadMcpRuntimeConfig({
          startDirectory: options.startDirectory,
          env: options.env,
        })
      ).config);
  const loadedConfig = await loadConfig();
  const config = options.includeXiaohongshu
    ? withXiaohongshuMcpServer(loadedConfig, options.env)
    : loadedConfig;

  if (options.includeXiaohongshu && shouldStartDocker(options.env)) {
    const dockerBootstrap = options.dockerBootstrap ?? createDockerBootstrap(options, config);
    await dockerBootstrap.start();
  }

  if (config.servers.length === 0) {
    console.info('⏭️ [AgentRuntime-MCPBootstrap] 未发现MCP配置，跳过外部工具加载');
    return undefined;
  }

  const createRuntime =
    options.createRuntime ??
    ((runtimeConfig: McpRuntimeConfig) =>
      new McpRuntimeService(runtimeConfig.servers, new OpenAiMcpClientFactory(options.env)));
  const runtime = createRuntime(config);
  await runtime.start();

  if (!options.includeXiaohongshu) return runtime;
  const serverName = createXiaohongshuMcpServerConfig(options.env).name;
  const createLoginService =
    options.createLoginService ??
    ((caller: BootstrappedMcpRuntime, name: string) =>
      new XiaohongshuMcpLoginService({
        caller,
        presenter: new LocalXiaohongshuQrcodePresenter(),
        serverName: name,
        timeoutMs: readPositiveInteger(
          options.env.YE_KITTY_XIAOHONGSHU_LOGIN_TIMEOUT_MS,
          240000,
          'YE_KITTY_XIAOHONGSHU_LOGIN_TIMEOUT_MS',
        ),
        pollIntervalMs: readPositiveInteger(
          options.env.YE_KITTY_XIAOHONGSHU_LOGIN_POLL_INTERVAL_MS,
          3000,
          'YE_KITTY_XIAOHONGSHU_LOGIN_POLL_INTERVAL_MS',
        ),
      }));

  try {
    await createLoginService(runtime, serverName).ensureLoggedIn();
    return runtime;
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}

// 创建项目管理的Docker启动器。
function createDockerBootstrap(
  options: McpRuntimeBootstrapOptions,
  config: McpRuntimeConfig,
): XiaohongshuMcpDockerBootstrap {
  const composePath = findNearestPath(
    options.startDirectory,
    join('deploy', 'xiaohongshu', 'compose.yml'),
  );
  if (!composePath) throw new Error('未找到 deploy/xiaohongshu/compose.yml');

  const serverName = createXiaohongshuMcpServerConfig(options.env).name;
  const server = config.servers.find((item) => item.name === serverName);
  if (!server || server.transport === 'stdio') {
    throw new Error(`小红书MCP Server ${serverName} 必须使用HTTP传输才能执行健康检查`);
  }
  const healthUrl = new URL(server.url);
  healthUrl.pathname = '/health';
  healthUrl.search = '';
  healthUrl.hash = '';

  return new XiaohongshuMcpDockerBootstrap({
    composePath,
    healthUrl: healthUrl.toString(),
    environment: {
      YE_KITTY_XIAOHONGSHU_MCP_IMAGE: resolveXiaohongshuMcpImage(
        options.env.YE_KITTY_XIAOHONGSHU_MCP_IMAGE,
        process.arch,
      ),
    },
    timeoutMs: readPositiveInteger(
      options.env.YE_KITTY_XIAOHONGSHU_DOCKER_TIMEOUT_MS,
      120000,
      'YE_KITTY_XIAOHONGSHU_DOCKER_TIMEOUT_MS',
    ),
  });
}

// 判断是否由项目管理本地容器。
function shouldStartDocker(env: NodeJS.ProcessEnv): boolean {
  return env.YE_KITTY_XIAOHONGSHU_MCP_DOCKER?.trim().toLowerCase() !== 'false';
}

// 从启动目录向上查找项目文件。
function findNearestPath(startDirectory: string, relativePath: string): string | undefined {
  let currentDirectory = startDirectory;
  const rootDirectory = parse(startDirectory).root;
  while (true) {
    const candidate = join(currentDirectory, relativePath);
    if (existsSync(candidate)) return candidate;
    if (currentDirectory === rootDirectory) return undefined;
    currentDirectory = dirname(currentDirectory);
  }
}

// 读取正整数环境变量。
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
