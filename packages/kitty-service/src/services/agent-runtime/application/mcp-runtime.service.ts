import type { McpRemoteTool, McpServerRuntimeConfig } from '../domain/mcp';
import type { RuntimeTool, RuntimeToolCall, ToolExecutionResult } from '../domain/tool';
import type {
  McpClientFactoryPort,
  McpClientPort,
  McpToolCallResult,
} from '../ports/mcp-client.port';
import type { RuntimeToolExecutorPort } from '../ports/tool-executor.port';
import type { RuntimeToolRegistryPort } from '../ports/tool-registry.port';
import type { McpRawToolCallerPort } from '../ports/mcp-raw-tool-caller.port';

/** MCP observation最大字符数 */
export const MAX_MCP_OBSERVATION_LENGTH = 12000;

interface ActiveMcpTool {
  readonly client: McpClientPort;
  readonly originalName: string;
  readonly runtimeTool: RuntimeTool;
}

/**
 * MCP运行时
 *
 * 管理多个MCP Server连接、工具发现、过滤、前缀命名和调用结果转换。
 * Server之间相互隔离，单个连接失败只会移除该Server工具。
 */
export class McpRuntimeService
  implements RuntimeToolRegistryPort, RuntimeToolExecutorPort, McpRawToolCallerPort
{
  private readonly activeClients: McpClientPort[] = [];
  private readonly toolsByName = new Map<string, ActiveMcpTool>();
  private started = false;

  constructor(
    private readonly serverConfigs: readonly McpServerRuntimeConfig[],
    private readonly clientFactory: McpClientFactoryPort,
  ) {}

  /**
   * 连接全部Server并发现工具
   *
   * 单个Server失败会记录警告并继续连接其他Server。
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    for (const config of this.serverConfigs) {
      await this.startServer(config);
    }

    console.info(
      `✅ [AgentRuntime-MCP-start] MCP运行时已启动 serverCount=${this.activeClients.length} toolCount=${this.toolsByName.size}`,
    );
  }

  /** 关闭全部已连接Server */
  async stop(): Promise<void> {
    if (!this.started) return;
    const clients = this.activeClients.splice(0);
    this.started = false;
    this.toolsByName.clear();

    const results = await Promise.allSettled(clients.map((client) => client.close()));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') return;
      console.warn(
        `⚠️ [AgentRuntime-MCP-stop] MCP Server关闭失败 server=${clients[index]?.name ?? 'unknown'} reason=${formatError(result.reason)}`,
      );
    });
    console.info(`✅ [AgentRuntime-MCP-stop] MCP运行时已关闭 serverCount=${clients.length}`);
  }

  /** 列出已发现工具 */
  listTools(): readonly RuntimeTool[] {
    return [...this.toolsByName.values()].map((item) => item.runtimeTool);
  }

  /** 查找已发现工具 */
  getTool(toolName: string): RuntimeTool | undefined {
    return this.toolsByName.get(toolName)?.runtimeTool;
  }

  /** 判断公开MCP工具是否存在 */
  hasTool(toolName: string): boolean {
    return this.toolsByName.has(toolName);
  }

  /**
   * 调用MCP工具并保留原始内容块
   * @param toolName 带Server前缀的工具名
   * @param input 工具参数
   * @returns MCP原始结果
   */
  async callToolRaw(
    toolName: string,
    input: Record<string, unknown> | null,
  ): Promise<McpToolCallResult> {
    const activeTool = this.toolsByName.get(toolName);
    if (!activeTool) throw new Error(`MCP工具 ${toolName} 未注册`);
    return await activeTool.client.callTool(activeTool.originalName, input);
  }

  /**
   * 执行MCP工具
   * @param call Harness工具调用
   * @returns 中文工具观察
   */
  async execute(call: RuntimeToolCall): Promise<ToolExecutionResult> {
    const activeTool = this.toolsByName.get(call.toolName);
    if (!activeTool) return createUnregisteredResult(call.toolName);

    const input = normalizeToolInput(call.input);
    if (input === undefined) {
      return {
        toolName: call.toolName,
        success: false,
        observation: `MCP工具 ${call.toolName} 的输入必须是JSON对象。`,
        errorMessage: 'MCP工具输入不是JSON对象',
      };
    }

    try {
      console.info(
        `🚧 [AgentRuntime-MCP-call] 开始调用MCP工具 server=${activeTool.client.name} tool=${activeTool.originalName}`,
      );
      const result = await activeTool.client.callTool(activeTool.originalName, input);
      const observation = formatMcpObservation(result);
      if (result.isError) {
        console.warn(
          `⚠️ [AgentRuntime-MCP-call] MCP工具返回失败 server=${activeTool.client.name} tool=${activeTool.originalName}`,
        );
        return {
          toolName: call.toolName,
          success: false,
          observation,
          structuredData: result.structuredContent,
          errorMessage: observation,
        };
      }

      console.info(
        `✅ [AgentRuntime-MCP-call] MCP工具调用成功 server=${activeTool.client.name} tool=${activeTool.originalName} observationLength=${observation.length}`,
      );
      return {
        toolName: call.toolName,
        success: true,
        observation,
        structuredData: result.structuredContent,
      };
    } catch (error) {
      const reason = formatError(error);
      console.warn(
        `⚠️ [AgentRuntime-MCP-call] MCP工具调用异常，已回灌失败观察 server=${activeTool.client.name} tool=${activeTool.originalName} reason=${reason}`,
      );
      return {
        toolName: call.toolName,
        success: false,
        observation: `MCP工具 ${call.toolName} 调用失败：${reason}`,
        errorMessage: reason,
      };
    }
  }

  // 连接单个Server并注册过滤后的工具。
  private async startServer(config: McpServerRuntimeConfig): Promise<void> {
    let client: McpClientPort | undefined;
    try {
      console.info(
        `🚧 [AgentRuntime-MCP-connect] 正在连接MCP Server server=${config.name} transport=${config.transport}`,
      );
      client = this.clientFactory.create(config);
      await client.connect();
      const remoteTools = await client.listTools();
      const visibleTools = remoteTools.filter((tool) => isToolVisible(config, tool.name));
      const activeTools = visibleTools.map((tool) => createActiveTool(config, client!, tool));
      this.ensureNoToolCollision(activeTools);

      this.activeClients.push(client);
      activeTools.forEach((tool) => this.toolsByName.set(tool.runtimeTool.name, tool));
      console.info(
        `✅ [AgentRuntime-MCP-connect] MCP Server连接成功 server=${config.name} transport=${config.transport} discoveredToolCount=${remoteTools.length} visibleToolCount=${visibleTools.length}`,
      );
    } catch (error) {
      if (client) await closeFailedClient(client);
      console.warn(
        `⚠️ [AgentRuntime-MCP-connect] MCP Server连接失败，已隔离该Server server=${config.name} transport=${config.transport} reason=${formatError(error)}`,
      );
    }
  }

  // 检查跨Server公开工具重名。
  private ensureNoToolCollision(activeTools: readonly ActiveMcpTool[]): void {
    for (const tool of activeTools) {
      if (this.toolsByName.has(tool.runtimeTool.name)) {
        throw new Error(`MCP公开工具名称冲突：${tool.runtimeTool.name}`);
      }
    }
  }
}

// 创建带Server前缀的Harness工具。
function createActiveTool(
  config: McpServerRuntimeConfig,
  client: McpClientPort,
  tool: McpRemoteTool,
): ActiveMcpTool {
  const publicName = `${config.name}_${tool.name}`;
  return {
    client,
    originalName: tool.name,
    runtimeTool: {
      name: publicName,
      description:
        tool.description?.trim() || `调用MCP Server ${config.name} 的 ${tool.name} 工具。`,
      riskLevel: config.toolRiskLevels[tool.name] ?? config.defaultRiskLevel,
      inputSchemaDescription: stringifySchema(tool.inputSchema),
    },
  };
}

// 根据允许或禁用规则过滤工具。
function isToolVisible(config: McpServerRuntimeConfig, toolName: string): boolean {
  const publicName = `${config.name}_${toolName}`;
  if (config.allowedTools) {
    return config.allowedTools.some((pattern) => matchesToolPattern(pattern, toolName, publicName));
  }
  if (config.disabledTools) {
    return !config.disabledTools.some((pattern) =>
      matchesToolPattern(pattern, toolName, publicName),
    );
  }
  return true;
}

// 同时匹配原始名和带Server前缀名称。
function matchesToolPattern(pattern: string, toolName: string, publicName: string): boolean {
  const matcher = globToRegExp(pattern);
  return matcher.test(toolName) || matcher.test(publicName);
}

// 将常见fnmatch通配符转换为正则。
function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === '*') {
      source += '.*';
      continue;
    }
    if (character === '?') {
      source += '.';
      continue;
    }
    if (character === '[') {
      const closingIndex = pattern.indexOf(']', index + 1);
      if (closingIndex > index + 1) {
        const characterClass = pattern.slice(index + 1, closingIndex).replace(/^!/, '^');
        source += `[${characterClass.replace(/\\/g, '\\\\')}]`;
        index = closingIndex;
        continue;
      }
    }
    source += escapeRegExp(character);
  }
  return new RegExp(`${source}$`);
}

// 转义正则字符。
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// MCP调用只接受对象或null。
function normalizeToolInput(input: unknown): Record<string, unknown> | null | undefined {
  if (input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) return undefined;
  return input as Record<string, unknown>;
}

// 将MCP内容块转为模型可读文本。
function formatMcpObservation(result: McpToolCallResult): string {
  const textParts = extractTextParts(result.content);
  const rawObservation =
    textParts.length > 0
      ? textParts.join('\n')
      : result.structuredContent !== undefined
        ? safeStringify(result.structuredContent)
        : 'MCP工具执行完成，但没有返回可读内容。';
  if (rawObservation.length <= MAX_MCP_OBSERVATION_LENGTH) return rawObservation;
  return `${rawObservation.slice(0, MAX_MCP_OBSERVATION_LENGTH)}\n[MCP结果过长，已截断]`;
}

// 提取MCP文本内容块。
function extractTextParts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (isRecord(item) && item.type === 'text' && typeof item.text === 'string') return [item.text];
    if (isRecord(item) && item.type === 'image') {
      return [
        `[MCP返回图片内容 mimeType=${typeof item.mimeType === 'string' ? item.mimeType : 'unknown'}]`,
      ];
    }
    return [`[MCP返回非文本内容 ${safeStringify(item)}]`];
  });
}

// 序列化输入Schema。
function stringifySchema(schema: Record<string, unknown> | undefined): string {
  return safeStringify(schema ?? { type: 'object', properties: {} });
}

// 安全序列化未知值。
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// 判断普通对象。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 关闭启动失败的Client。
async function closeFailedClient(client: McpClientPort): Promise<void> {
  try {
    await client.close();
  } catch {
    // 启动失败后的关闭异常由原始连接失败日志统一说明，避免重复噪音。
  }
}

// 创建未注册工具结果。
function createUnregisteredResult(toolName: string): ToolExecutionResult {
  return {
    toolName,
    success: false,
    observation: `工具 ${toolName} 未注册，不能执行。`,
    errorMessage: '工具未注册',
  };
}

// 格式化错误。
function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer ***')
    .replace(/((?:token|api[_-]?key|secret)\s*[=:]\s*)[^\s,;]+/gi, '$1***')
    .slice(0, 500);
}
