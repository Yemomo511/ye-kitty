import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, parse, resolve } from 'node:path';
import type { McpRuntimeConfig } from './schema';
import { parseMcpRuntimeConfig } from './config';

/** MCP配置加载选项 */
export interface McpRuntimeConfigLoadOptions {
  /** 启动目录 */
  readonly startDirectory: string;
  /** 运行环境变量 */
  readonly env?: NodeJS.ProcessEnv;
}

/** MCP配置加载结果 */
export interface LoadedMcpRuntimeConfig {
  /** 规范化配置 */
  readonly config: McpRuntimeConfig;
  /** 实际配置文件 */
  readonly sourcePath?: string;
}

/**
 * 加载MCP JSON配置
 *
 * 显式 `YE_KITTY_MCP_CONFIG_PATH` 优先；未配置时只读取最近Git项目根目录的 `.mcp.json`。
 */
export async function loadMcpRuntimeConfig(
  options: McpRuntimeConfigLoadOptions,
): Promise<LoadedMcpRuntimeConfig> {
  const env = options.env ?? process.env;
  const explicitPath = env.YE_KITTY_MCP_CONFIG_PATH?.trim();
  const sourcePath = explicitPath
    ? isAbsolute(explicitPath)
      ? explicitPath
      : resolve(options.startDirectory, explicitPath)
    : await findProjectMcpConfig(options.startDirectory);

  if (!sourcePath) return { config: { servers: [] }, sourcePath: undefined };

  try {
    const content = await readFile(sourcePath, 'utf8');
    return {
      config: parseMcpRuntimeConfig(JSON.parse(content) as unknown),
      sourcePath,
    };
  } catch (error) {
    throw new Error(`MCP配置文件读取失败 path=${sourcePath} reason=${formatError(error)}`, {
      cause: error,
    });
  }
}

// 只在当前Git项目根目录发现配置，避免误执行父级目录中的stdio命令。
async function findProjectMcpConfig(startDirectory: string): Promise<string | undefined> {
  const projectRoot = await findProjectRoot(startDirectory);
  const candidate = resolve(projectRoot, '.mcp.json');
  return (await isReadable(candidate)) ? candidate : undefined;
}

// 查找最近Git项目根目录，无Git仓库时退回启动目录。
async function findProjectRoot(startDirectory: string): Promise<string> {
  let currentDirectory = resolve(startDirectory);
  const rootDirectory = parse(currentDirectory).root;

  while (true) {
    if (await isReadable(resolve(currentDirectory, '.git'))) return currentDirectory;
    if (currentDirectory === rootDirectory) return resolve(startDirectory);
    currentDirectory = dirname(currentDirectory);
  }
}

// 判断文件是否可读。
async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// 格式化错误。
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
