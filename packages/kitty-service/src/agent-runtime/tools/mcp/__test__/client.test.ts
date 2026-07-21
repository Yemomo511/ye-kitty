import { describe, expect, test, vi } from 'vitest';
import type { McpServerRuntimeConfig } from '../schema';
import { OpenAiMcpClientFactory, type McpSdkServerConstructors } from '../client';

describe('OpenAI MCP客户端工厂', () => {
  test('把三种传输配置转换为SDK Server并代理生命周期', async () => {
    const sdkServer = createSdkServer();
    const constructors: McpSdkServerConstructors = {
      stdio: vi.fn(() => sdkServer),
      http: vi.fn(() => sdkServer),
      sse: vi.fn(() => sdkServer),
    };
    const factory = new OpenAiMcpClientFactory(
      { PATH: '/usr/bin', MCP_TOKEN: 'secret-token', MCP_MODE: 'readonly' },
      constructors,
    );

    const stdio = factory.create({
      name: 'filesystem',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { MODE: '${MCP_MODE}' },
      timeoutMs: 5000,
      defaultRiskLevel: 'medium',
      toolRiskLevels: {},
    });
    const http = factory.create({
      name: 'docs',
      transport: 'http',
      url: 'https://docs.example.com/mcp',
      headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
      timeoutMs: 6000,
      defaultRiskLevel: 'medium',
      toolRiskLevels: {},
    });
    factory.create({
      name: 'legacy',
      transport: 'sse',
      url: 'https://legacy.example.com/sse',
      headers: {},
      timeoutMs: 7000,
      defaultRiskLevel: 'medium',
      toolRiskLevels: {},
    });

    expect(constructors.stdio).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'filesystem',
        command: 'node',
        args: ['server.js'],
        timeout: 5000,
        env: expect.objectContaining({ PATH: '/usr/bin', MODE: 'readonly' }),
      }),
    );
    expect(constructors.http).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'docs',
        url: 'https://docs.example.com/mcp',
        timeout: 6000,
        requestInit: { headers: { Authorization: 'Bearer secret-token' } },
      }),
    );
    expect(constructors.sse).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'legacy', timeout: 7000 }),
    );

    await stdio.connect();
    await stdio.close();
    await http.listTools();
    await http.callTool('search', { query: 'MCP' });

    expect(sdkServer.connect).toHaveBeenCalledOnce();
    expect(sdkServer.close).toHaveBeenCalledOnce();
    expect(sdkServer.listTools).toHaveBeenCalledOnce();
    expect(sdkServer.callToolResult).toHaveBeenCalledWith('search', { query: 'MCP' });
  });

  test('缺少环境变量时只让对应Server创建失败', () => {
    const factory = new OpenAiMcpClientFactory({}, createConstructors());
    const config: McpServerRuntimeConfig = {
      name: 'private-api',
      transport: 'http',
      url: 'https://api.example.com/mcp',
      headers: { Authorization: 'Bearer ${MISSING_TOKEN}' },
      timeoutMs: 30000,
      defaultRiskLevel: 'medium',
      toolRiskLevels: {},
    };

    expect(() => factory.create(config)).toThrow('MISSING_TOKEN');
  });

  test('OAuth Server缺少凭证提供器时返回可隔离错误', () => {
    const factory = new OpenAiMcpClientFactory({}, createConstructors());

    expect(() =>
      factory.create({
        name: 'oauth-api',
        transport: 'http',
        url: 'https://api.example.com/mcp',
        headers: {},
        auth: 'oauth',
        timeoutMs: 30000,
        defaultRiskLevel: 'medium',
        toolRiskLevels: {},
      }),
    ).toThrow('OAuth');
  });

  test('默认SDK构造器可以创建三种传输客户端', () => {
    const factory = new OpenAiMcpClientFactory({ HOME: '/tmp' });

    expect(
      factory.create({
        name: 'stdio',
        transport: 'stdio',
        command: 'node',
        args: [],
        env: {},
        cwd: '${HOME}',
        timeoutMs: 30000,
        defaultRiskLevel: 'medium',
        toolRiskLevels: {},
      }).name,
    ).toBe('stdio');
    expect(
      factory.create({
        name: 'http',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: {},
        timeoutMs: 30000,
        defaultRiskLevel: 'medium',
        toolRiskLevels: {},
      }).name,
    ).toBe('http');
    expect(
      factory.create({
        name: 'sse',
        transport: 'sse',
        url: 'https://example.com/sse',
        headers: {},
        timeoutMs: 30000,
        defaultRiskLevel: 'medium',
        toolRiskLevels: {},
      }).name,
    ).toBe('sse');
  });
});

function createConstructors(): McpSdkServerConstructors {
  return {
    stdio: vi.fn(() => createSdkServer()),
    http: vi.fn(() => createSdkServer()),
    sse: vi.fn(() => createSdkServer()),
  };
}

function createSdkServer() {
  return {
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    listTools: vi.fn(async () => []),
    callToolResult: vi.fn(async () => ({ content: [] })),
  };
}
