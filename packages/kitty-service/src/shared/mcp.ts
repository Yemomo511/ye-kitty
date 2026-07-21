/** MCP工具风险等级。 */
export type McpToolRiskLevel = 'low' | 'medium' | 'high';

/** MCP传输类型。 */
export type McpTransport = 'stdio' | 'http' | 'sse';

/** MCP远端工具描述。 */
export interface McpRemoteTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

/** MCP Server公共配置。 */
export interface McpServerBaseConfig {
  readonly name: string;
  readonly transport: McpTransport;
  readonly timeoutMs: number;
  readonly allowedTools?: readonly string[];
  readonly disabledTools?: readonly string[];
  readonly internalTools?: readonly string[];
  readonly defaultRiskLevel: McpToolRiskLevel;
  readonly toolRiskLevels: Readonly<Record<string, McpToolRiskLevel>>;
}

/** 标准输入输出传输配置。 */
export interface McpStdioServerConfig extends McpServerBaseConfig {
  readonly transport: 'stdio';
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

/** HTTP或SSE远端传输配置。 */
export interface McpRemoteServerConfig extends McpServerBaseConfig {
  readonly transport: 'http' | 'sse';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly auth?: 'oauth';
}

/** 单个MCP Server运行配置。 */
export type McpServerRuntimeConfig = McpStdioServerConfig | McpRemoteServerConfig;

/** MCP运行时配置。 */
export interface McpRuntimeConfig {
  readonly servers: readonly McpServerRuntimeConfig[];
}

/** MCP工具原始调用结果。 */
export interface McpToolCallResult {
  readonly content?: unknown;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

/** 不暴露运行时实现的MCP原始调用能力。 */
export interface McpRawToolCaller {
  hasTool(toolName: string): boolean;
  callToolRaw(toolName: string, input: Record<string, unknown> | null): Promise<McpToolCallResult>;
}
