import type { McpRemoteServerConfig, McpRuntimeConfig } from '@kitty/shared/mcp';

/** 小红书MCP默认工具 */
export const XIAOHONGSHU_MCP_TOOLS = [
  'check_login_status',
  'get_login_qrcode',
  'delete_cookies',
  'publish_content',
  'list_feeds',
  'search_feeds',
  'get_feed_detail',
  'user_profile',
  'post_comment_to_feed',
  'reply_comment_in_feed',
  'publish_with_video',
  'like_feed',
  'favorite_feed',
] as const;

const DEFAULT_SERVER_NAME = 'xiaohongshu';
const DEFAULT_MCP_URL = 'http://127.0.0.1:18060/mcp';
const DEFAULT_TIMEOUT_MS = 60000;
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * 创建小红书MCP默认配置
 * @param env 运行环境变量
 * @returns 保守风险配置
 */
export function createXiaohongshuMcpServerConfig(env: NodeJS.ProcessEnv): McpRemoteServerConfig {
  const name = env.YE_KITTY_XIAOHONGSHU_MCP_NAME?.trim() || DEFAULT_SERVER_NAME;
  if (!SERVER_NAME_PATTERN.test(name)) throw new Error('小红书MCP Server名称不合法');

  const url = env.YE_KITTY_XIAOHONGSHU_MCP_URL?.trim() || DEFAULT_MCP_URL;
  validateHttpUrl(url);
  const timeoutMs = parsePositiveInteger(
    env.YE_KITTY_XIAOHONGSHU_MCP_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );

  return {
    name,
    transport: 'http',
    url,
    headers: {},
    timeoutMs,
    allowedTools: XIAOHONGSHU_MCP_TOOLS,
    internalTools: ['list_mentions'],
    defaultRiskLevel: 'medium',
    toolRiskLevels: {
      check_login_status: 'low',
      get_login_qrcode: 'low',
      list_feeds: 'low',
      search_feeds: 'low',
      get_feed_detail: 'low',
      user_profile: 'low',
    },
  };
}

/**
 * 合并小红书MCP配置
 * @param config 通用MCP配置
 * @param env 运行环境变量
 * @returns 不覆盖用户同名Server的新配置
 */
export function withXiaohongshuMcpServer(
  config: McpRuntimeConfig,
  env: NodeJS.ProcessEnv,
): McpRuntimeConfig {
  const xiaohongshu = createXiaohongshuMcpServerConfig(env);
  if (config.servers.some((server) => server.name === xiaohongshu.name)) return config;
  return { servers: [...config.servers, xiaohongshu] };
}

// 校验远端MCP地址。
function validateHttpUrl(rawUrl: string): void {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('协议不支持');
  } catch {
    throw new Error('小红书MCP URL必须是有效HTTP地址');
  }
}

// 解析正整数配置。
function parsePositiveInteger(input: string | undefined, defaultValue: number): number {
  if (input === undefined || input.trim() === '') return defaultValue;
  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) throw new Error('小红书MCP超时必须是正整数');
  return value;
}
