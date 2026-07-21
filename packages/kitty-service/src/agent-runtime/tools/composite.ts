import type { RuntimeTool, RuntimeToolCall, ToolExecutionResult } from './legacy';
import type { RuntimeToolExecutorPort } from './runtime-executor';
import type { RuntimeToolRegistryPort } from './runtime-registry';

/** 组合工具来源 */
export interface RuntimeToolProvider {
  /** 工具注册表 */
  readonly registry: RuntimeToolRegistryPort;
  /** 工具执行器 */
  readonly executor: RuntimeToolExecutorPort;
}

/**
 * 组合工具注册表
 *
 * 将内置工具和外部工具合并为Agent唯一可见目录，构造时拒绝重名，
 * 避免调用被错误路由到另一个Provider。
 */
export class CompositeRuntimeToolRegistry implements RuntimeToolRegistryPort {
  private readonly tools: readonly RuntimeTool[];
  private readonly toolsByName: ReadonlyMap<string, RuntimeTool>;

  constructor(providers: readonly RuntimeToolProvider[]) {
    const tools = providers.flatMap((provider) => [...provider.registry.listTools()]);
    this.toolsByName = createUniqueToolMap(tools);
    this.tools = [...this.toolsByName.values()];
  }

  /** 列出组合工具 */
  listTools(): readonly RuntimeTool[] {
    return this.tools;
  }

  /** 查找组合工具 */
  getTool(toolName: string): RuntimeTool | undefined {
    return this.toolsByName.get(toolName);
  }
}

/**
 * 组合工具执行器
 *
 * 根据注册表归属把调用路由到对应Provider，未注册工具不会向任何外部系统发起请求。
 */
export class CompositeRuntimeToolExecutor implements RuntimeToolExecutorPort {
  private readonly providersByToolName: ReadonlyMap<string, RuntimeToolProvider>;

  constructor(providers: readonly RuntimeToolProvider[]) {
    const tools = providers.flatMap((provider) => [...provider.registry.listTools()]);
    createUniqueToolMap(tools);
    this.providersByToolName = new Map(
      providers.flatMap((provider) =>
        provider.registry.listTools().map((tool) => [tool.name, provider] as const),
      ),
    );
  }

  /** 执行归属Provider工具 */
  async execute(call: RuntimeToolCall): Promise<ToolExecutionResult> {
    const provider = this.providersByToolName.get(call.toolName);
    if (!provider) {
      return {
        toolName: call.toolName,
        success: false,
        observation: `工具 ${call.toolName} 未注册，不能执行。`,
        errorMessage: '工具未注册',
      };
    }
    return await provider.executor.execute(call);
  }
}

// 构建唯一工具映射。
function createUniqueToolMap(tools: readonly RuntimeTool[]): ReadonlyMap<string, RuntimeTool> {
  const toolsByName = new Map<string, RuntimeTool>();
  for (const tool of tools) {
    if (toolsByName.has(tool.name)) throw new Error(`运行时工具名称冲突：${tool.name}`);
    toolsByName.set(tool.name, tool);
  }
  return toolsByName;
}
