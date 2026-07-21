import type {
  McpRuntimeConfig,
  McpServerBaseConfig,
  McpServerRuntimeConfig,
  McpTransport,
} from './schema';
import type { RuntimeToolRiskLevel } from '../legacy';

/** 默认MCP调用超时 */
export const DEFAULT_MCP_TIMEOUT_MS = 30000;
/** 默认MCP工具风险 */
export const DEFAULT_MCP_TOOL_RISK_LEVEL: RuntimeToolRiskLevel = 'medium';

/**
 * 解析通用MCP JSON配置
 * @param input JSON对象
 * @returns 规范化运行配置
 */
export function parseMcpRuntimeConfig(input: unknown): McpRuntimeConfig {
  const root = requireRecord(input, 'MCP配置必须是JSON对象');
  const rawServers = requireRecord(root.mcpServers, 'MCP配置必须包含mcpServers对象');
  const servers: McpServerRuntimeConfig[] = [];

  for (const [name, rawConfig] of Object.entries(rawServers)) {
    if (!MCP_SERVER_NAME_PATTERN.test(name)) {
      throw new Error(`MCP Server名称 ${name} 不合法，只允许字母、数字、下划线和连字符`);
    }

    const config = requireRecord(rawConfig, `MCP Server ${name} 配置必须是对象`);
    if (config.disabled === true || config.enabled === false) continue;
    servers.push(parseServerConfig(name, config));
  }

  return { servers };
}

const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const RISK_LEVELS = new Set<RuntimeToolRiskLevel>(['low', 'medium', 'high']);

// 解析单个Server并识别传输方式。
function parseServerConfig(name: string, input: Record<string, unknown>): McpServerRuntimeConfig {
  const transport = parseTransport(name, input);
  const common = parseCommonConfig(name, transport, input);

  if (transport === 'stdio') {
    if (input.auth !== undefined) throw new Error(`MCP Server ${name} 的stdio不能配置auth`);
    return {
      ...common,
      transport,
      command: requireNonEmptyString(input.command, `MCP Server ${name} 缺少command`),
      args: readStringArray(input.args, `MCP Server ${name} 的args必须是字符串数组`) ?? [],
      env: readStringRecord(input.env, `MCP Server ${name} 的env必须是字符串对象`) ?? {},
      cwd: readOptionalString(input.cwd, `MCP Server ${name} 的cwd必须是字符串`),
    };
  }

  const url = requireNonEmptyString(input.url, `MCP Server ${name} 缺少url`);
  validateRemoteUrl(name, url);
  const auth = readRemoteAuth(input.auth, name);
  const headers =
    readStringRecord(input.headers, `MCP Server ${name} 的headers必须是字符串对象`) ?? {};
  if (
    auth === 'oauth' &&
    Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')
  ) {
    throw new Error(`MCP Server ${name} 的OAuth不能同时配置Authorization Header`);
  }

  return {
    ...common,
    transport,
    url,
    headers,
    auth,
  };
}

// 解析远端认证声明，真实OAuth能力由基础设施决定。
function readRemoteAuth(input: unknown, name: string): 'oauth' | undefined {
  if (input === undefined) return undefined;
  if (input !== 'oauth') throw new Error(`MCP Server ${name} 的auth只支持oauth声明`);
  return input;
}

// 解析Server公共治理配置。
function parseCommonConfig(
  name: string,
  transport: McpTransport,
  input: Record<string, unknown>,
): McpServerBaseConfig {
  const allowedTools = readToolFilter(name, 'allowedTools', input.allowedTools);
  const disabledTools = readToolFilter(name, 'disabledTools', input.disabledTools);
  if (allowedTools && disabledTools) {
    throw new Error(`MCP Server ${name} 不能同时配置allowedTools和disabledTools`);
  }

  return {
    name,
    transport,
    timeoutMs: readPositiveInteger(input.timeoutMs, DEFAULT_MCP_TIMEOUT_MS, `${name}.timeoutMs`),
    allowedTools,
    disabledTools,
    defaultRiskLevel: readRiskLevel(input.defaultRiskLevel, DEFAULT_MCP_TOOL_RISK_LEVEL, name),
    toolRiskLevels: readRiskLevelRecord(input.toolRiskLevels, name),
  };
}

// 兼容Deep Agents与LangGraph的type/transport字段。
function parseTransport(name: string, input: Record<string, unknown>): McpTransport {
  const type = normalizeTransport(input.type, name);
  const transport = normalizeTransport(input.transport, name);
  if (type && transport && type !== transport) {
    throw new Error(`MCP Server ${name} 的type与transport不一致`);
  }

  const explicit = type ?? transport;
  if (explicit) return explicit;
  if (typeof input.command === 'string') return 'stdio';
  if (typeof input.url === 'string') return 'http';
  throw new Error(`MCP Server ${name} 必须配置command或url`);
}

// 规范传输别名。
function normalizeTransport(input: unknown, name: string): McpTransport | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'string') throw new Error(`MCP Server ${name} 的传输类型必须是字符串`);
  if (input === 'stdio') return 'stdio';
  if (input === 'http' || input === 'streamable-http' || input === 'streamable_http') return 'http';
  if (input === 'sse') return 'sse';
  throw new Error(`MCP Server ${name} 的传输类型 ${input} 不受支持`);
}

// 读取工具过滤列表。
function readToolFilter(
  name: string,
  field: string,
  input: unknown,
): readonly string[] | undefined {
  const values = readStringArray(input, `MCP Server ${name} 的${field}必须是字符串数组`);
  if (values?.length === 0) throw new Error(`MCP Server ${name} 的${field}不能为空`);
  return values;
}

// 读取单工具风险覆盖。
function readRiskLevelRecord(
  input: unknown,
  name: string,
): Readonly<Record<string, RuntimeToolRiskLevel>> {
  if (input === undefined) return {};
  const record = requireRecord(input, `MCP Server ${name} 的toolRiskLevels必须是对象`);
  return Object.fromEntries(
    Object.entries(record).map(([toolName, riskLevel]) => [
      toolName,
      readRiskLevel(riskLevel, DEFAULT_MCP_TOOL_RISK_LEVEL, `${name}.${toolName}`),
    ]),
  );
}

// 读取风险等级。
function readRiskLevel(
  input: unknown,
  defaultValue: RuntimeToolRiskLevel,
  field: string,
): RuntimeToolRiskLevel {
  if (input === undefined) return defaultValue;
  if (typeof input !== 'string' || !RISK_LEVELS.has(input as RuntimeToolRiskLevel)) {
    throw new Error(`MCP配置 ${field} 的风险等级必须是low、medium或high`);
  }
  return input as RuntimeToolRiskLevel;
}

// 校验远端MCP地址。
function validateRemoteUrl(name: string, rawUrl: string): void {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('协议不支持');
  } catch {
    throw new Error(`MCP Server ${name} 的url必须是有效HTTP地址`);
  }
}

// 读取正整数。
function readPositiveInteger(input: unknown, defaultValue: number, field: string): number {
  if (input === undefined) return defaultValue;
  if (typeof input !== 'number' || !Number.isInteger(input) || input <= 0) {
    throw new Error(`MCP配置 ${field} 必须是正整数`);
  }
  return input;
}

// 读取字符串数组。
function readStringArray(input: unknown, message: string): readonly string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error(message);
  }
  return [...input];
}

// 读取字符串对象。
function readStringRecord(
  input: unknown,
  message: string,
): Readonly<Record<string, string>> | undefined {
  if (input === undefined) return undefined;
  const record = requireRecord(input, message);
  if (Object.values(record).some((value) => typeof value !== 'string')) throw new Error(message);
  return record as Record<string, string>;
}

// 读取可选字符串。
function readOptionalString(input: unknown, message: string): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'string' || !input.trim()) throw new Error(message);
  return input;
}

// 读取必填字符串。
function requireNonEmptyString(input: unknown, message: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error(message);
  return input;
}

// 校验普通对象。
function requireRecord(input: unknown, message: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error(message);
  return input as Record<string, unknown>;
}
