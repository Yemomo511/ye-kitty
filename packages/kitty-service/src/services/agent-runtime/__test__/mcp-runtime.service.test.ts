import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
} from '@kitty/shared/types/ids';
import { MAX_MCP_OBSERVATION_LENGTH, McpRuntimeService } from '../application/mcp-runtime.service';
import type { McpServerRuntimeConfig } from '../domain/mcp';
import type {
  McpClientFactoryPort,
  McpClientPort,
  McpToolCallResult,
} from '../ports/mcp-client.port';

describe('MCP运行时', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('启动多Server并把过滤后的工具以前缀形式注册到Harness', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const filesystem = createClient('filesystem', [
      { name: 'read_file', description: '读取文件', inputSchema: { type: 'object' } },
      { name: 'write_file', description: '写入文件', inputSchema: { type: 'object' } },
      { name: 'list_directory', description: '列出目录', inputSchema: { type: 'object' } },
    ]);
    const docs = createClient('docs', [
      { name: 'search', description: '搜索文档', inputSchema: { type: 'object' } },
    ]);
    const runtime = new McpRuntimeService(
      [
        createStdioConfig('filesystem', {
          allowedTools: ['read_*', 'filesystem_list_*'],
          toolRiskLevels: { read_file: 'low' },
        }),
        createHttpConfig('docs', { defaultRiskLevel: 'low' }),
      ],
      createFactory({ filesystem, docs }),
    );

    await runtime.start();

    expect(runtime.listTools()).toEqual([
      expect.objectContaining({
        name: 'filesystem_read_file',
        description: '读取文件',
        riskLevel: 'low',
      }),
      expect.objectContaining({
        name: 'filesystem_list_directory',
        riskLevel: 'medium',
      }),
      expect.objectContaining({ name: 'docs_search', riskLevel: 'low' }),
    ]);
    expect(filesystem.connect).toHaveBeenCalledOnce();
    expect(docs.connect).toHaveBeenCalledOnce();
  });

  test('单个Server连接失败时保留其他Server工具', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failed = createClient('failed', []);
    failed.connect.mockRejectedValue(new Error('Authorization: Bearer super-secret'));
    const healthy = createClient('healthy', [
      { name: 'read', description: '读取数据', inputSchema: { type: 'object' } },
    ]);
    const runtime = new McpRuntimeService(
      [createHttpConfig('failed'), createHttpConfig('healthy', { defaultRiskLevel: 'low' })],
      createFactory({ failed, healthy }),
    );

    await runtime.start();

    expect(runtime.listTools()).toEqual([
      expect.objectContaining({ name: 'healthy_read', riskLevel: 'low' }),
    ]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('failed'));
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('super-secret'));
  });

  test('按公开工具名路由到原始MCP工具并回灌结果', async () => {
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
    ]);
    client.callTool.mockResolvedValue({
      content: [{ type: 'text', text: '搜索结果：MCP文档' }],
      structuredContent: { count: 1 },
    });
    const runtime = new McpRuntimeService(
      [createHttpConfig('docs', { defaultRiskLevel: 'low' })],
      createFactory({ docs: client }),
    );
    await runtime.start();

    const result = await runtime.execute({
      event: createChatEvent(),
      toolName: 'docs_search',
      input: { query: 'MCP' },
    });

    expect(client.callTool).toHaveBeenCalledWith('search', { query: 'MCP' });
    expect(result).toMatchObject({
      toolName: 'docs_search',
      success: true,
      observation: '搜索结果：MCP文档',
      structuredData: { count: 1 },
    });
  });

  test('MCP返回isError时转换为失败观察', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = createClient('api', [
      { name: 'query', description: '查询', inputSchema: { type: 'object' } },
    ]);
    client.callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: '远端限流' }],
    });
    const runtime = new McpRuntimeService(
      [createHttpConfig('api', { defaultRiskLevel: 'low' })],
      createFactory({ api: client }),
    );
    await runtime.start();

    await expect(
      runtime.execute({ event: createChatEvent(), toolName: 'api_query', input: {} }),
    ).resolves.toMatchObject({
      success: false,
      observation: '远端限流',
      errorMessage: '远端限流',
    });
  });

  test('停止时关闭全部已连接Server且保持幂等', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const first = createClient('first', []);
    const second = createClient('second', []);
    const runtime = new McpRuntimeService(
      [createStdioConfig('first'), createHttpConfig('second')],
      createFactory({ first, second }),
    );
    await runtime.start();

    await runtime.stop();
    await runtime.stop();

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(runtime.listTools()).toEqual([]);
  });

  test('启动与未启动停止保持幂等', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const client = createClient('once', []);
    const runtime = new McpRuntimeService(
      [createStdioConfig('once')],
      createFactory({ once: client }),
    );

    await runtime.stop();
    await runtime.start();
    await runtime.start();

    expect(client.connect).toHaveBeenCalledOnce();
  });

  test('关闭Server异常时记录警告并完成清理', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = createClient('close-failed', []);
    client.close.mockRejectedValue(new Error('关闭超时'));
    const runtime = new McpRuntimeService(
      [createStdioConfig('close-failed')],
      createFactory({ 'close-failed': client }),
    );
    await runtime.start();

    await runtime.stop();

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('关闭失败'));
    expect(runtime.listTools()).toEqual([]);
  });

  test('禁用规则、问号和字符范围通配符会过滤工具', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const client = createClient('api', [
      { name: 'read_a', inputSchema: { type: 'object' } },
      { name: 'read_b', inputSchema: { type: 'object' } },
      { name: 'delete_a', inputSchema: { type: 'object' } },
      { name: 'keep', inputSchema: { type: 'object' } },
    ]);
    const runtime = new McpRuntimeService(
      [createHttpConfig('api', { disabledTools: ['read_?', 'delete_[ab]'] })],
      createFactory({ api: client }),
    );

    await runtime.start();

    expect(runtime.listTools()).toEqual([
      expect.objectContaining({
        name: 'api_keep',
        description: expect.stringContaining('api'),
      }),
    ]);
    expect(runtime.getTool('api_keep')?.inputSchemaDescription).toBe('{"type":"object"}');
  });

  test('未注册工具和非法输入不会调用远端', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const client = createClient('api', [{ name: 'query' }]);
    const runtime = new McpRuntimeService(
      [createHttpConfig('api', { defaultRiskLevel: 'low' })],
      createFactory({ api: client }),
    );
    await runtime.start();

    await expect(
      runtime.execute({ event: createChatEvent(), toolName: 'missing', input: {} }),
    ).resolves.toMatchObject({ errorMessage: '工具未注册' });
    await expect(
      runtime.execute({ event: createChatEvent(), toolName: 'api_query', input: 'invalid' }),
    ).resolves.toMatchObject({ errorMessage: 'MCP工具输入不是JSON对象' });
    expect(client.callTool).not.toHaveBeenCalled();
  });

  test('远端抛错时回灌失败观察且允许null输入', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = createClient('api', [{ name: 'query' }]);
    client.callTool.mockRejectedValue(new Error('连接中断'));
    const runtime = new McpRuntimeService(
      [createHttpConfig('api', { defaultRiskLevel: 'low' })],
      createFactory({ api: client }),
    );
    await runtime.start();

    await expect(
      runtime.execute({ event: createChatEvent(), toolName: 'api_query', input: null }),
    ).resolves.toMatchObject({
      success: false,
      observation: expect.stringContaining('连接中断'),
      errorMessage: '连接中断',
    });
    expect(client.callTool).toHaveBeenCalledWith('query', null);
  });

  test('结构化、图片、非文本和超长内容会转为受限观察', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const client = createClient('media', [
      { name: 'structured' },
      { name: 'mixed' },
      { name: 'long' },
      { name: 'empty' },
    ]);
    client.callTool.mockImplementation(async (toolName) => {
      if (toolName === 'structured') return { structuredContent: { count: 2 } };
      if (toolName === 'mixed') {
        return {
          content: [
            '字符串内容',
            { type: 'image', mimeType: 'image/png' },
            { type: 'resource', uri: 'file:///tmp/a' },
          ],
        };
      }
      if (toolName === 'long') return { content: 'x'.repeat(MAX_MCP_OBSERVATION_LENGTH + 1) };
      return {};
    });
    const runtime = new McpRuntimeService(
      [createHttpConfig('media', { defaultRiskLevel: 'low' })],
      createFactory({ media: client }),
    );
    await runtime.start();

    await expect(execute(runtime, 'media_structured')).resolves.toMatchObject({
      observation: '{"count":2}',
    });
    await expect(execute(runtime, 'media_mixed')).resolves.toMatchObject({
      observation: expect.stringContaining('image/png'),
    });
    await expect(execute(runtime, 'media_long')).resolves.toMatchObject({
      observation: expect.stringContaining('已截断'),
    });
    await expect(execute(runtime, 'media_empty')).resolves.toMatchObject({
      observation: 'MCP工具执行完成，但没有返回可读内容。',
    });
  });
});

type MockClient = McpClientPort & {
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
};

function createClient(
  name: string,
  tools: Awaited<ReturnType<McpClientPort['listTools']>>,
): MockClient {
  return {
    name,
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    listTools: vi.fn(async () => tools),
    callTool: vi.fn(async (): Promise<McpToolCallResult> => ({ content: [] })),
  };
}

function createFactory(clients: Record<string, MockClient>): McpClientFactoryPort {
  return {
    create(config) {
      const client = clients[config.name];
      if (!client) throw new Error(`测试Client不存在：${config.name}`);
      return client;
    },
  };
}

function createStdioConfig(
  name: string,
  overrides: Partial<McpServerRuntimeConfig> = {},
): McpServerRuntimeConfig {
  return {
    name,
    transport: 'stdio',
    command: 'node',
    args: [],
    env: {},
    timeoutMs: 30000,
    defaultRiskLevel: 'medium',
    toolRiskLevels: {},
    ...overrides,
  } as McpServerRuntimeConfig;
}

function createHttpConfig(
  name: string,
  overrides: Partial<McpServerRuntimeConfig> = {},
): McpServerRuntimeConfig {
  return {
    name,
    transport: 'http',
    url: `https://${name}.example.com/mcp`,
    headers: {},
    timeoutMs: 30000,
    defaultRiskLevel: 'medium',
    toolRiskLevels: {},
    ...overrides,
  } as McpServerRuntimeConfig;
}

function createChatEvent(): ChatEventContract {
  return {
    id: 'chat-event-mcp' as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: 'qq:conversation:mcp' as ConversationId,
    conversationType: 'private',
    senderId: 'qq:participant:mcp' as ParticipantId,
    senderDisplayName: '测试用户',
    message: {
      id: 'message-mcp' as MessageId,
      type: 'text',
      text: '查询MCP',
      mentions: [],
    },
    receivedAt: new Date('2026-07-16T00:00:00.000Z'),
  };
}

function execute(runtime: McpRuntimeService, toolName: string) {
  return runtime.execute({ event: createChatEvent(), toolName, input: {} });
}
