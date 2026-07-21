import type { Tool, ToolContext, ToolResult } from './tool';

/**
 * 工具执行器
 *
 * 统一捕获实现异常并转换为可继续回灌的结果。权限判断和工具发现分别由
 * Permission 与 Registry 负责，执行器不重复判断。
 */
export class ToolExecutor {
  /**
   * 执行已定位工具
   * @param tool 工具定义
   * @param input 工具输入
   * @param context 调用上下文
   * @returns 统一工具结果
   */
  async execute(tool: Tool, input: unknown, context: ToolContext): Promise<ToolResult> {
    try {
      return await tool.execute(input, context);
    } catch (error) {
      const reason = formatError(error);
      console.warn(
        `⚠️ [AgentRuntime-ToolExecutor-execute] 工具执行异常，已转换为失败观察 tool=${tool.name} callId=${context.callId} reason=${reason}`,
      );
      return {
        success: false,
        summary: `工具 ${tool.name} 执行失败。`,
        error: reason,
      };
    }
  }
}

// 压缩错误内容，避免输出完整外部响应。
function formatError(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason.replaceAll(/\s+/g, ' ').slice(0, 200);
}
