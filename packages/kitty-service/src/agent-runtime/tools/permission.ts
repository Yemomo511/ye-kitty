import type { Tool, ToolContext } from './tool';

/** 工具权限检查结果。 */
export type ToolPermissionResult =
  | { readonly status: 'allowed' }
  | { readonly status: 'denied' | 'review'; readonly reason: string };

/**
 * 工具权限能力
 *
 * 实现方根据 Tool 风险、运行上下文和人工授权状态返回是否允许执行。
 */
export interface ToolPermission {
  /**
   * 检查工具权限
   * @param tool 待执行工具
   * @param context 调用上下文
   * @returns 权限结果
   */
  check(tool: Tool, context: ToolContext): Promise<ToolPermissionResult>;
}

/** 默认风险权限：低风险放行，其余进入人工确认。 */
export class RiskToolPermission implements ToolPermission {
  /** 按工具风险判断是否需要确认。 */
  async check(tool: Tool): Promise<ToolPermissionResult> {
    if (tool.risk === 'low') return { status: 'allowed' };
    return {
      status: 'review',
      reason: `工具 ${tool.name} 风险等级为 ${tool.risk}，需要人工确认。`,
    };
  }
}
