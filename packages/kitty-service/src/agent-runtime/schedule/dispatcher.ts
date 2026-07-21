import type { Tool } from '../tools/tool';
import type { ToolRegistry } from '../tools/registry';

/**
 * Action 工具定位器
 *
 * Schedule 只通过稳定工具名定位实现，不认识 Skill、MCP、平台或 Code Agent。
 */
export class ToolDispatcher {
  constructor(private readonly registry: ToolRegistry) {}

  /**
   * 定位工具
   * @param name 工具名称
   * @returns 已注册工具或空
   */
  find(name: string): Tool | undefined {
    return this.registry.get(name);
  }
}
