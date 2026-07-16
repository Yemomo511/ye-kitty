import { describe, expect, test } from 'vitest';
import { parseMcpRuntimeConfig } from '../application/mcp-runtime-config';

describe('MCP运行配置', () => {
  test('兼容stdio、HTTP、Streamable HTTP和SSE常见配置', () => {
    const config = parseMcpRuntimeConfig({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          env: { FILESYSTEM_MODE: 'readonly' },
          allowedTools: ['read_file', 'list_*'],
          toolRiskLevels: { read_file: 'low' },
        },
        docs: {
          type: 'http',
          url: 'https://docs.example.com/mcp',
          headers: { Authorization: 'Bearer ${DOCS_TOKEN}' },
          defaultRiskLevel: 'low',
        },
        api: {
          transport: 'streamable_http',
          url: 'https://api.example.com/mcp',
        },
        legacy: {
          type: 'sse',
          url: 'https://legacy.example.com/sse',
          disabledTools: ['delete_*'],
        },
        oauth: {
          type: 'http',
          url: 'https://oauth.example.com/mcp',
          auth: 'oauth',
        },
        disabled: {
          command: 'node',
          disabled: true,
        },
      },
    });

    expect(config.servers).toEqual([
      expect.objectContaining({
        name: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        env: { FILESYSTEM_MODE: 'readonly' },
        allowedTools: ['read_file', 'list_*'],
        defaultRiskLevel: 'medium',
        toolRiskLevels: { read_file: 'low' },
      }),
      expect.objectContaining({
        name: 'docs',
        transport: 'http',
        url: 'https://docs.example.com/mcp',
        headers: { Authorization: 'Bearer ${DOCS_TOKEN}' },
        defaultRiskLevel: 'low',
      }),
      expect.objectContaining({
        name: 'api',
        transport: 'http',
        url: 'https://api.example.com/mcp',
      }),
      expect.objectContaining({
        name: 'legacy',
        transport: 'sse',
        url: 'https://legacy.example.com/sse',
        disabledTools: ['delete_*'],
      }),
      expect.objectContaining({
        name: 'oauth',
        transport: 'http',
        auth: 'oauth',
      }),
    ]);
  });

  test('只有url时默认使用Streamable HTTP', () => {
    const config = parseMcpRuntimeConfig({
      mcpServers: {
        remote: { url: 'https://example.com/mcp' },
      },
    });

    expect(config.servers[0]).toMatchObject({ name: 'remote', transport: 'http' });
  });

  test.each([
    {
      name: '非法Server名称',
      input: { mcpServers: { 'bad/server': { command: 'node' } } },
      message: 'Server名称',
    },
    {
      name: '同时配置允许与禁用列表',
      input: {
        mcpServers: {
          bad: { command: 'node', allowedTools: ['read'], disabledTools: ['write'] },
        },
      },
      message: '不能同时配置',
    },
    {
      name: '空过滤列表',
      input: { mcpServers: { bad: { command: 'node', allowedTools: [] } } },
      message: '不能为空',
    },
    {
      name: '未知传输',
      input: { mcpServers: { bad: { type: 'websocket', url: 'ws://localhost' } } },
      message: '传输类型',
    },
    {
      name: '缺少连接入口',
      input: { mcpServers: { bad: {} } },
      message: 'command或url',
    },
    {
      name: 'stdio声明OAuth',
      input: { mcpServers: { bad: { command: 'node', auth: 'oauth' } } },
      message: 'stdio不能配置auth',
    },
    {
      name: 'OAuth与Authorization Header并存',
      input: {
        mcpServers: {
          bad: {
            url: 'https://example.com/mcp',
            auth: 'oauth',
            headers: { authorization: 'Bearer token' },
          },
        },
      },
      message: 'OAuth不能同时配置Authorization Header',
    },
  ])('$name时拒绝启动配置', ({ input, message }) => {
    expect(() => parseMcpRuntimeConfig(input)).toThrow(message);
  });
});
