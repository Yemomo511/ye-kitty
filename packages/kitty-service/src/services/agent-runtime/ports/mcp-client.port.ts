import type { McpRemoteTool, McpServerRuntimeConfig } from '../domain/mcp';

/** MCP工具调用结果 */
export interface McpToolCallResult {
  /** MCP内容块 */
  readonly content?: unknown;
  /** MCP结构化内容 */
  readonly structuredContent?: unknown;
  /** MCP错误标记 */
  readonly isError?: boolean;
}

/**
 * MCP客户端能力
 *
 * 基础设施实现负责持有一个Server会话，并提供工具发现和调用。
 * 调用方必须按 connect、list/call、close 顺序管理生命周期。
 */
export interface McpClientPort {
  /** Server名称 */
  readonly name: string;

  /** 建立Server连接 */
  connect(): Promise<void>;

  /** 关闭Server连接 */
  close(): Promise<void>;

  /** 发现Server工具 */
  listTools(): Promise<readonly McpRemoteTool[]>;

  /**
   * 调用Server工具
   * @param toolName MCP原始工具名
   * @param input 工具参数
   * @returns MCP原始结果
   */
  callTool(toolName: string, input: Record<string, unknown> | null): Promise<McpToolCallResult>;
}

/** MCP客户端创建能力 */
export interface McpClientFactoryPort {
  /**
   * 创建单Server客户端
   * @param config Server配置
   * @returns 未连接客户端
   */
  create(config: McpServerRuntimeConfig): McpClientPort;
}
