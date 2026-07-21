import { describe, expect, test, vi } from 'vitest';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import { createRuntimeTools } from './runtime';

describe('旧运行时工具桥接', () => {
  test('把工具定义和执行结果转换为统一Tool', async () => {
    const event = { platform: 'qq' } as ChatEventContract;
    const execute = vi.fn(async () => ({
      toolName: 'echo',
      success: true,
      observation: '完成',
      structuredData: { text: '你好' },
    }));
    const tools = createRuntimeTools(
      {
        listTools: () => [
          {
            name: 'echo',
            description: '回显',
            riskLevel: 'low',
            inputSchemaDescription: '{"text":"文本"}',
          },
        ],
        getTool: vi.fn(),
      },
      { execute },
      event,
    );

    expect(tools[0]).toMatchObject({
      name: 'echo',
      description: '回显',
      risk: 'low',
      input: '{"text":"文本"}',
    });
    await expect(tools[0]!.execute({ text: '你好' }, { callId: 'call-1' })).resolves.toEqual({
      success: true,
      summary: '完成',
      data: { text: '你好' },
    });
    expect(execute).toHaveBeenCalledWith({ event, toolName: 'echo', input: { text: '你好' } });
  });
});
