/** MCP原始内容块结果 */
export interface XiaohongshuMcpRawToolResult {
  readonly content?: unknown;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

/**
 * 小红书平台层所需的MCP原始调用能力
 *
 * 该窄端口避免平台模块反向依赖Agent Runtime实现。
 */
export interface XiaohongshuMcpRawToolCallerPort {
  hasTool(toolName: string): boolean;
  callToolRaw(
    toolName: string,
    input: Record<string, unknown> | null,
  ): Promise<XiaohongshuMcpRawToolResult>;
}
