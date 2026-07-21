import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { RuntimeToolExecutorPort } from '../../services/agent-runtime/ports/tool-executor.port';
import type { RuntimeToolRegistryPort } from '../../services/agent-runtime/ports/tool-registry.port';
import type { Tool } from './tool';

/**
 * 将迁移中的旧工具来源转换为统一Tool。
 *
 * 该桥接只做结构映射，风险判断和异常归一化仍由Schedule、Permission与
 * ToolExecutor统一处理；旧工具删除后该桥接会随之消失。
 */
export function createRuntimeTools(
  registry: RuntimeToolRegistryPort,
  executor: RuntimeToolExecutorPort,
  event: ChatEventContract,
): Tool[] {
  return registry.listTools().map((definition) => ({
    name: definition.name,
    description: definition.description,
    risk: definition.riskLevel,
    input: definition.inputSchemaDescription,
    async execute(input) {
      const result = await executor.execute({ event, toolName: definition.name, input });
      return {
        success: result.success,
        summary: result.observation,
        ...(result.structuredData === undefined ? {} : { data: result.structuredData }),
        ...(result.errorMessage === undefined ? {} : { error: result.errorMessage }),
      };
    },
  }));
}
