import type { RuntimeToolRiskLevel } from './tool';

/** MCP传输类型 */
export type McpTransport = 'stdio' | 'http' | 'sse';

/** MCP工具描述 */
export interface McpRemoteTool {
  /** MCP原始工具名 */
  readonly name: string;
  /** MCP工具说明 */
  readonly description?: string;
  /** JSON Schema输入结构 */
  readonly inputSchema?: Record<string, unknown>;
}

/** MCP Server公共配置 */
export interface McpServerBaseConfig {
  /** Server名称 */
  readonly name: string;
  /** 传输类型 */
  readonly transport: McpTransport;
  /** 调用超时毫秒 */
  readonly timeoutMs: number;
  /** 工具允许规则 */
  readonly allowedTools?: readonly string[];
  /** 工具禁用规则 */
  readonly disabledTools?: readonly string[];
  /** 仅供系统组件原始调用、不暴露给Harness的工具规则 */
  readonly internalTools?: readonly string[];
  /** 默认风险等级 */
  readonly defaultRiskLevel: RuntimeToolRiskLevel;
  /** 单工具风险覆盖 */
  readonly toolRiskLevels: Readonly<Record<string, RuntimeToolRiskLevel>>;
}

/** stdio MCP Server配置 */
export interface McpStdioServerConfig extends McpServerBaseConfig {
  /** stdio传输 */
  readonly transport: 'stdio';
  /** 启动命令 */
  readonly command: string;
  /** 命令参数 */
  readonly args: readonly string[];
  /** 子进程环境变量 */
  readonly env: Readonly<Record<string, string>>;
  /** 子进程工作目录 */
  readonly cwd?: string;
}

/** 远端 MCP Server配置 */
export interface McpRemoteServerConfig extends McpServerBaseConfig {
  /** HTTP或SSE传输 */
  readonly transport: 'http' | 'sse';
  /** MCP服务地址 */
  readonly url: string;
  /** 请求头 */
  readonly headers: Readonly<Record<string, string>>;
  /** 远端认证方式 */
  readonly auth?: 'oauth';
}

/** MCP Server运行配置 */
export type McpServerRuntimeConfig = McpStdioServerConfig | McpRemoteServerConfig;

/** MCP运行配置 */
export interface McpRuntimeConfig {
  /** 启用的Server */
  readonly servers: readonly McpServerRuntimeConfig[];
}
