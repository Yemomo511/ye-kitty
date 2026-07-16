import type { McpToolCallResult } from './mcp-client.port';

/** MCP原始工具调用能力 */
export interface McpRawToolCallerPort {
  /**
   * 判断公开或内部工具是否存在
   * @param toolName 带Server前缀的工具名
   */
  hasTool(toolName: string): boolean;

  /**
   * 调用工具并保留原始内容块
   * @param toolName 带Server前缀的工具名
   * @param input 工具参数
   * @returns MCP原始结果
   */
  callToolRaw(toolName: string, input: Record<string, unknown> | null): Promise<McpToolCallResult>;
}
