import type { Tool } from './tool';

/**
 * 工具注册表
 *
 * 持有 Agent 当前可见的全部工具，构造时拒绝重名，避免 Action 被路由到
 * 非预期实现。注册表只负责发现，不执行工具。
 */
export class ToolRegistry {
  private readonly tools: readonly Tool[];
  private readonly toolsByName: ReadonlyMap<string, Tool>;

  constructor(tools: readonly Tool[]) {
    this.toolsByName = createUniqueToolMap(tools);
    this.tools = [...this.toolsByName.values()];
  }

  /** 列出当前可见工具。 */
  list(): readonly Tool[] {
    return this.tools;
  }

  /**
   * 按稳定名称查找工具
   * @param name 工具名称
   * @returns 工具或空
   */
  get(name: string): Tool | undefined {
    return this.toolsByName.get(name);
  }
}

// 构建唯一工具映射。
function createUniqueToolMap(tools: readonly Tool[]): ReadonlyMap<string, Tool> {
  const toolsByName = new Map<string, Tool>();
  for (const tool of tools) {
    if (toolsByName.has(tool.name)) throw new Error(`工具名称冲突：${tool.name}`);
    toolsByName.set(tool.name, tool);
  }
  return toolsByName;
}
