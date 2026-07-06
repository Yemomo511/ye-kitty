import type { RuntimeTool } from '../domain/tool';

/**
 * 工具注册端口
 *
 * Harness 通过注册表获取当前可见工具，Runner 只能看到这里返回的工具描述。
 */
export interface RuntimeToolRegistryPort {
  /**
   * 列出工具
   * @returns 可见工具
   */
  listTools(): readonly RuntimeTool[];

  /**
   * 查找工具
   * @param toolName 工具名称
   * @returns 工具定义
   */
  getTool(toolName: string): RuntimeTool | undefined;
}
