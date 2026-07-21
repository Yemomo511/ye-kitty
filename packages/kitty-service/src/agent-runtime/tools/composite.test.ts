import { describe, expect, test, vi } from 'vitest';
import type { RuntimeTool, RuntimeToolCall } from './legacy';
import type { RuntimeToolExecutorPort } from './runtime-executor';
import type { RuntimeToolRegistryPort } from './runtime-registry';
import {
  CompositeRuntimeToolExecutor,
  CompositeRuntimeToolRegistry,
  type RuntimeToolProvider,
} from './composite';

describe('组合运行时工具', () => {
  test('合并工具目录并按所属Provider路由执行', async () => {
    const builtin = createProvider(createTool('builtin_read'));
    const mcp = createProvider(createTool('docs_search'));
    const registry = new CompositeRuntimeToolRegistry([builtin, mcp]);
    const executor = new CompositeRuntimeToolExecutor([builtin, mcp]);
    const call = { toolName: 'docs_search', input: {} } as RuntimeToolCall;

    await executor.execute(call);

    expect(registry.listTools().map((tool) => tool.name)).toEqual(['builtin_read', 'docs_search']);
    expect(mcp.executor.execute).toHaveBeenCalledWith(call);
    expect(builtin.executor.execute).not.toHaveBeenCalled();
  });

  test('组合后工具名称冲突时拒绝启动', () => {
    const first = createProvider(createTool('same_tool'));
    const second = createProvider(createTool('same_tool'));

    expect(() => new CompositeRuntimeToolRegistry([first, second])).toThrow('工具名称冲突');
    expect(() => new CompositeRuntimeToolExecutor([first, second])).toThrow('工具名称冲突');
  });

  test('执行未注册工具时返回失败观察', async () => {
    const executor = new CompositeRuntimeToolExecutor([createProvider(createTool('known'))]);

    await expect(
      executor.execute({ toolName: 'unknown', input: {} } as RuntimeToolCall),
    ).resolves.toMatchObject({
      toolName: 'unknown',
      success: false,
      errorMessage: '工具未注册',
    });
  });
});

function createTool(name: string): RuntimeTool {
  return {
    name,
    description: `${name}说明`,
    riskLevel: 'low',
    inputSchemaDescription: '{}',
  };
}

function createProvider(tool: RuntimeTool): RuntimeToolProvider & {
  executor: RuntimeToolExecutorPort & { execute: ReturnType<typeof vi.fn> };
} {
  const registry: RuntimeToolRegistryPort = {
    listTools: () => [tool],
    getTool: (toolName) => (toolName === tool.name ? tool : undefined),
  };
  const executor = {
    execute: vi.fn(async (call: RuntimeToolCall) => ({
      toolName: call.toolName,
      success: true,
      observation: '执行成功',
    })),
  };
  return { registry, executor };
}
