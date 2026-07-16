import { MCPServerSSE, MCPServerStdio, MCPServerStreamableHttp } from '@openai/agents';
import type { McpRemoteTool, McpServerRuntimeConfig } from '../../domain/mcp';
import type {
  McpClientFactoryPort,
  McpClientPort,
  McpToolCallResult,
} from '../../ports/mcp-client.port';

type StdioOptions = ConstructorParameters<typeof MCPServerStdio>[0];
type HttpOptions = ConstructorParameters<typeof MCPServerStreamableHttp>[0];
type SseOptions = ConstructorParameters<typeof MCPServerSSE>[0];
type SseOptionsWithRequestInit = SseOptions & { readonly requestInit?: RequestInit };

interface McpSdkServer {
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<readonly McpRemoteTool[]>;
  callToolResult(
    toolName: string,
    input: Record<string, unknown> | null,
  ): Promise<McpToolCallResult>;
}

/** OpenAI MCP SDK构造器 */
export interface McpSdkServerConstructors {
  /** 创建stdio Server */
  readonly stdio: (options: StdioOptions) => McpSdkServer;
  /** 创建Streamable HTTP Server */
  readonly http: (options: HttpOptions) => McpSdkServer;
  /** 创建SSE Server */
  readonly sse: (options: SseOptionsWithRequestInit) => McpSdkServer;
}

const DEFAULT_CONSTRUCTORS: McpSdkServerConstructors = {
  stdio: (options) => new MCPServerStdio(options),
  http: (options) => new MCPServerStreamableHttp(options),
  sse: (options) => new MCPServerSSE(options),
};

/**
 * OpenAI Agents SDK MCP客户端工厂
 *
 * 只复用SDK的传输与会话实现，不把Server直接交给OpenAI Agent，
 * 从而保持Ye-Kitty Harness对工具目录和调用过程的所有权。
 */
export class OpenAiMcpClientFactory implements McpClientFactoryPort {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly constructors: McpSdkServerConstructors = DEFAULT_CONSTRUCTORS,
  ) {}

  /** 创建未连接MCP客户端 */
  create(config: McpServerRuntimeConfig): McpClientPort {
    if (config.transport === 'stdio') {
      const server = this.constructors.stdio({
        name: config.name,
        command: resolveEnvironmentTemplate(config.command, this.env),
        args: config.args.map((value) => resolveEnvironmentTemplate(value, this.env)),
        cwd: config.cwd ? resolveEnvironmentTemplate(config.cwd, this.env) : undefined,
        env: {
          ...readStringEnvironment(this.env),
          ...resolveEnvironmentRecord(config.env, this.env),
        },
        timeout: config.timeoutMs,
        cacheToolsList: true,
      });
      return new OpenAiMcpClient(config.name, server);
    }

    if (config.auth === 'oauth') {
      throw new Error(`MCP Server ${config.name} 需要OAuth登录，当前运行时尚未配置OAuth凭证提供器`);
    }

    const headers = resolveEnvironmentRecord(config.headers, this.env);
    const sharedOptions = {
      name: config.name,
      url: resolveEnvironmentTemplate(config.url, this.env),
      timeout: config.timeoutMs,
      cacheToolsList: true,
      requestInit: { headers },
    };
    const server =
      config.transport === 'http'
        ? this.constructors.http(sharedOptions)
        : this.constructors.sse(sharedOptions);
    return new OpenAiMcpClient(config.name, server);
  }
}

/**
 * OpenAI MCP SDK客户端适配器
 *
 * 把SDK Server收敛为项目端口，避免应用层依赖具体SDK类型。
 */
class OpenAiMcpClient implements McpClientPort {
  constructor(
    readonly name: string,
    private readonly server: McpSdkServer,
  ) {}

  /** 连接MCP Server */
  async connect(): Promise<void> {
    await this.server.connect();
  }

  /** 关闭MCP Server */
  async close(): Promise<void> {
    await this.server.close();
  }

  /** 发现MCP工具 */
  async listTools(): Promise<readonly McpRemoteTool[]> {
    return await this.server.listTools();
  }

  /** 调用MCP工具并保留完整结果 */
  async callTool(
    toolName: string,
    input: Record<string, unknown> | null,
  ): Promise<McpToolCallResult> {
    return await this.server.callToolResult(toolName, input);
  }
}

// 替换配置中的环境变量引用。
function resolveEnvironmentTemplate(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, variableName: string) => {
    const environmentValue = env[variableName];
    if (environmentValue === undefined) throw new Error(`环境变量 ${variableName} 未配置`);
    return environmentValue;
  });
}

// 替换字符串对象中的环境变量引用。
function resolveEnvironmentRecord(
  record: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, resolveEnvironmentTemplate(value, env)]),
  );
}

// 过滤undefined环境变量，满足stdio客户端类型约束。
function readStringEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}
