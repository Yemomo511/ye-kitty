import { describe, expect, test } from 'vitest';
import {
  createXiaohongshuMcpServerConfig,
  withXiaohongshuMcpServer,
} from '../application/xiaohongshu-mcp-config';

describe('小红书MCP默认配置', () => {
  test('使用上游默认地址、13个工具和保守风险等级', () => {
    const config = createXiaohongshuMcpServerConfig({});

    expect(config).toMatchObject({
      name: 'xiaohongshu',
      transport: 'http',
      url: 'http://127.0.0.1:18060/mcp',
      defaultRiskLevel: 'medium',
      timeoutMs: 60000,
    });
    expect(config.allowedTools).toHaveLength(13);
    expect(config.internalTools).toEqual(['list_mentions']);
    expect(config.toolRiskLevels).toMatchObject({
      check_login_status: 'low',
      get_login_qrcode: 'low',
      list_feeds: 'low',
      search_feeds: 'low',
      get_feed_detail: 'low',
      user_profile: 'low',
    });
    expect(config.toolRiskLevels).not.toHaveProperty('publish_content');
    expect(config.toolRiskLevels).not.toHaveProperty('reply_comment_in_feed');
  });

  test('环境变量可以覆盖Server名称、地址和超时', () => {
    expect(
      createXiaohongshuMcpServerConfig({
        YE_KITTY_XIAOHONGSHU_MCP_NAME: 'xhs-local',
        YE_KITTY_XIAOHONGSHU_MCP_URL: 'http://localhost:28060/mcp',
        YE_KITTY_XIAOHONGSHU_MCP_TIMEOUT_MS: '90000',
      }),
    ).toMatchObject({ name: 'xhs-local', url: 'http://localhost:28060/mcp', timeoutMs: 90000 });
  });

  test('合并时保留用户同名Server配置', () => {
    const userServer = {
      ...createXiaohongshuMcpServerConfig({}),
      url: 'https://custom.example.com/mcp',
    };

    const merged = withXiaohongshuMcpServer({ servers: [userServer] }, {});

    expect(merged.servers).toEqual([userServer]);
  });

  test('没有同名Server时追加默认配置且不修改原对象', () => {
    const original = { servers: [] };

    const merged = withXiaohongshuMcpServer(original, {});

    expect(merged.servers).toHaveLength(1);
    expect(original.servers).toEqual([]);
  });

  test.each([
    [{ YE_KITTY_XIAOHONGSHU_MCP_TIMEOUT_MS: '0' }, '正整数'],
    [{ YE_KITTY_XIAOHONGSHU_MCP_URL: 'file:///tmp/mcp' }, 'HTTP地址'],
    [{ YE_KITTY_XIAOHONGSHU_MCP_NAME: 'bad/name' }, '名称'],
  ])('非法环境配置会被拒绝', (env, message) => {
    expect(() => createXiaohongshuMcpServerConfig(env)).toThrow(message);
  });
});
