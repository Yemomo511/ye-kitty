import { tool as createSdkTool, type FunctionTool } from '@openai/agents';
import { Tool, type Tool as CanonicalTool, type ToolRuntimeContext } from './tool';

/**
 * 物化官方FunctionTool
 * @param name Registry注册名称
 * @param canonicalTool 规范Tool
 * @returns 单次运行SDK工具
 */
export function materializeTool(
  name: string,
  canonicalTool: CanonicalTool,
): FunctionTool<ToolRuntimeContext> {
  const definition = Tool.definition(canonicalTool);
  const policy = Tool.policy(canonicalTool);
  const common = {
    name,
    description: definition.description,
    parameters: definition.parameters,
    needsApproval: async () => policy.approval === 'required',
    execute: async (
      input: unknown,
      runContext?: {
        readonly context: ToolRuntimeContext;
        readonly isToolApproved?: (input: {
          readonly toolName: string;
          readonly callId: string;
        }) => boolean | undefined;
      },
      details?: { readonly toolCall?: { readonly callId?: string } },
    ) => {
      const runtimeContext = runContext?.context;
      const callId = details?.toolCall?.callId;
      if (!runtimeContext || !callId) {
        return {
          status: 'error',
          summary: '工具运行上下文不完整，当前没有执行。',
          retryable: false,
        };
      }

      const settlement = await Tool.settle(name, canonicalTool, input, {
        ...runtimeContext,
        callId,
        approvalGranted: runContext.isToolApproved?.({ toolName: name, callId }) === true,
      });
      return Tool.toModelOutput(canonicalTool, settlement);
    },
    errorFunction: formatSdkToolError,
  } as const;

  if (definition.strict) {
    return createSdkTool({
      ...common,
      parameters: definition.parameters as never,
      strict: true,
    }) as FunctionTool<ToolRuntimeContext>;
  }
  return createSdkTool({
    ...common,
    parameters: definition.parameters as never,
    strict: false,
  }) as FunctionTool<ToolRuntimeContext>;
}

/**
 * 格式化SDK调用层异常
 *
 * Tool内部异常通常已经由settle转换；该函数兜底处理SDK解析或调用包装异常，
 * 不把原始错误内容返回模型。
 *
 * @returns 固定安全错误
 */
export function formatSdkToolError(): string {
  return '工具执行失败，请根据当前信息调整方案。';
}
