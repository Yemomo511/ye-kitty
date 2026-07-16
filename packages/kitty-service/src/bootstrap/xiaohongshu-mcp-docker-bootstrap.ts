import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** 外部命令执行能力 */
export type BootstrapCommandRunner = (command: string, args: readonly string[]) => Promise<void>;

/** 小红书MCP Docker启动参数 */
export interface XiaohongshuMcpDockerBootstrapOptions {
  /** Compose文件路径 */
  readonly composePath: string;
  /** 健康检查地址 */
  readonly healthUrl: string;
  /** 启动超时毫秒 */
  readonly timeoutMs?: number;
  /** 检查间隔毫秒 */
  readonly pollIntervalMs?: number;
  /** 命令执行能力 */
  readonly runCommand?: BootstrapCommandRunner;
  /** 健康检查能力 */
  readonly checkHealth?: (url: string) => Promise<boolean>;
  /** 等待能力 */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** 当前时间能力 */
  readonly now?: () => number;
}

const DEFAULT_START_TIMEOUT_MS = 120000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const executeFile = promisify(execFile);

/**
 * 小红书MCP Docker启动器
 *
 * 负责启动项目内Compose并等待HTTP健康检查。不会安装Docker，
 * 启动失败时保留容器状态和日志，方便用户直接排查。
 */
export class XiaohongshuMcpDockerBootstrap {
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly runCommand: BootstrapCommandRunner;
  private readonly checkHealth: (url: string) => Promise<boolean>;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: XiaohongshuMcpDockerBootstrapOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.runCommand = options.runCommand ?? runCommand;
    this.checkHealth = options.checkHealth ?? checkHttpHealth;
    this.sleep = options.sleep ?? wait;
    this.now = options.now ?? Date.now;
  }

  /** 启动容器并等待服务就绪 */
  async start(): Promise<void> {
    console.info(
      `🚧 [XiaohongshuMCP-Docker-start] 正在启动小红书MCP composePath=${this.options.composePath}`,
    );
    try {
      await this.runCommand('docker', ['compose', '-f', this.options.composePath, 'up', '-d']);
    } catch (error) {
      throw new Error(
        `小红书MCP Docker启动失败，请确认Docker已经安装并正在运行。reason=${formatError(error)}`,
        { cause: error },
      );
    }

    const deadline = this.now() + this.timeoutMs;
    while (true) {
      if (await this.checkHealth(this.options.healthUrl)) {
        console.info(
          `✅ [XiaohongshuMCP-Docker-start] 小红书MCP健康检查通过 url=${this.options.healthUrl}`,
        );
        return;
      }
      if (this.now() >= deadline) {
        throw new Error(
          `小红书MCP健康检查超时，请运行 pnpm xiaohongshu:logs 查看容器日志。url=${this.options.healthUrl}`,
        );
      }
      await this.sleep(this.pollIntervalMs);
    }
  }
}

// 执行无交互外部命令。
async function runCommand(command: string, args: readonly string[]): Promise<void> {
  await executeFile(command, [...args]);
}

// 检查HTTP健康状态。
async function checkHttpHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

// 等待指定时间。
async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// 压缩外部错误。
function formatError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
