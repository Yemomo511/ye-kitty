import { describe, expect, test, vi } from 'vitest';
import type { McpClientFactoryPort, McpClientPort } from '../client-type';
import { McpRuntimeService } from '../runtime';
import type { McpServerRuntimeConfig } from '../schema';
import { Tool } from '../../tool';
import { createToolTestContext } from '../../__test__/runtime-context';

describe('MCP规范Tool来源', () => {
  test('发现、过滤并以前缀名称暴露规范Tool', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const client = createClient('docs', [
      {
        name: 'search',
        description: '搜索文档',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      { name: 'delete', inputSchema: { type: 'object' } },
    ]);
    const runtime = new McpRuntimeService(
      [createConfig({ allowedTools: ['search'] })],
      createFactory(client),
    );

    await runtime.start();

    expect(Object.keys(runtime.listTools())).toEqual(['docs_search']);
    expect(Tool.is(runtime.listTools().docs_search)).toBe(true);
    expect(Tool.definition(runtime.listTools().docs_search)).toMatchObject({
      description: '搜索文档',
      strict: false,
    });
  });

  test('调用结果经过统一Tool结算和模型投影', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const client = createClient('docs', [
      {
        name: 'search',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ]);
    client.callTool.mockResolvedValue({
      content: [{ type: 'text', text: '搜索结果' }],
      structuredContent: { count: 1 },
    });
    const runtime = new McpRuntimeService(
      [createConfig({ defaultRiskLevel: 'low' })],
      createFactory(client),
    );
    await runtime.start();

    const tool = runtime.listTools().docs_search;
    const settlement = await Tool.settle(
      'docs_search',
      tool,
      { query: 'MCP' },
      createToolTestContext(),
    );

    expect(settlement).toMatchObject({
      status: 'success',
      output: { summary: '搜索结果', data: { count: 1 } },
    });
    expect(client.callTool).toHaveBeenCalledWith('search', { query: 'MCP' });
  });

  test('中高风险MCP工具强制声明SDK审批', async () => {
    const client = createClient('docs', [{ name: 'write', inputSchema: { type: 'object' } }]);
    const runtime = new McpRuntimeService([createConfig()], createFactory(client));
    await runtime.start();

    expect(Tool.policy(runtime.listTools().docs_write)).toMatchObject({
      risk: 'medium',
      approval: 'required',
    });
  });

  test('内部工具只允许系统原始调用，不进入模型目录', async () => {
    const client = createClient('docs', [
      { name: 'login_status', inputSchema: { type: 'object' } },
    ]);
    client.callTool.mockResolvedValue({ structuredContent: { loggedIn: true } });
    const runtime = new McpRuntimeService(
      [createConfig({ allowedTools: [], internalTools: ['login_*'] })],
      createFactory(client),
    );
    await runtime.start();

    expect(runtime.listTools()).toEqual({});
    expect(runtime.hasTool('docs_login_status')).toBe(true);
    await expect(runtime.callToolRaw('docs_login_status', null)).resolves.toEqual({
      structuredContent: { loggedIn: true },
    });
  });

  test('单个Server连接失败时隔离且脱敏凭证', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = createClient('docs', []);
    client.connect.mockRejectedValue(new Error('Authorization: Bearer super-secret'));
    const runtime = new McpRuntimeService([createConfig()], createFactory(client));

    await runtime.start();

    expect(runtime.listTools()).toEqual({});
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('super-secret'));
    expect(client.close).toHaveBeenCalledOnce();
  });

  test('远端Schema包含运行时未知关键字时隔离该工具', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = createClient('docs', [
      {
        name: 'search',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', format: 'email' } },
        },
      },
      {
        name: 'safe_search',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', minLength: 1 } },
        },
      },
    ]);
    const runtime = new McpRuntimeService(
      [createConfig({ defaultRiskLevel: 'low' })],
      createFactory(client),
    );

    await runtime.start();

    expect(Object.keys(runtime.listTools())).toEqual(['docs_safe_search']);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('不支持的关键字 format'));
  });
});

function createClient(
  name: string,
  tools: Awaited<ReturnType<McpClientPort['listTools']>>,
): McpClientPort & {
  readonly connect: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
  readonly callTool: ReturnType<typeof vi.fn>;
} {
  return {
    name,
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    listTools: vi.fn(async () => tools),
    callTool: vi.fn(async () => ({})),
  };
}

function createFactory(client: McpClientPort): McpClientFactoryPort {
  return { create: () => client };
}

function createConfig(overrides: Partial<McpServerRuntimeConfig> = {}): McpServerRuntimeConfig {
  return {
    name: 'docs',
    transport: 'http',
    url: 'https://mcp.example.com',
    headers: {},
    timeoutMs: 1000,
    defaultRiskLevel: 'medium',
    toolRiskLevels: {},
    ...overrides,
  } as McpServerRuntimeConfig;
}
