import { Tool, type Tool as CanonicalTool } from './tool';

/** 可动态提供规范Tool的来源。 */
export interface ToolSource {
  /**
   * 列出当前可见Tool
   * @returns 名称到规范Tool映射
   */
  listTools(): Readonly<Record<string, CanonicalTool>>;
}

/**
 * 合并Tool来源
 * @param sources 内置或外部来源
 * @returns 唯一工具映射
 */
export function mergeToolSources(
  sources: readonly ToolSource[],
): Readonly<Record<string, CanonicalTool>> {
  const merged: Record<string, CanonicalTool> = {};
  for (const source of sources) {
    for (const [name, tool] of Object.entries(source.listTools())) {
      if (!Tool.is(tool)) throw new Error(`工具 ${name} 不是规范Tool`);
      if (merged[name]) throw new Error(`运行时工具名称冲突：${name}`);
      merged[name] = tool;
    }
  }
  return Object.freeze(merged);
}
