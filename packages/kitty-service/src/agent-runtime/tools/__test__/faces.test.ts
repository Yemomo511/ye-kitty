import { describe, expect, test, vi } from 'vitest';
import type { QqBotClientPort } from '@kitty/platforms/qq/client';
import type { QqCustomFaceResource } from '@kitty/platforms/qq/api';
import { CustomFaceCatalogService } from '../../../platforms/qq/faces';
import {
  BuiltinRuntimeToolExecutor,
  BuiltinRuntimeToolRegistry,
  GET_CUSTOM_FACES_TOOL_NAME,
} from '../messages';
import { InMemoryConversationHistory } from '../../history';
import type { CustomFaceVisionAgentPort } from '../../../platforms/qq/vision';
import type { PlatformMessage } from '@kitty/platforms/message';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';

describe('CustomFaceCatalogService', () => {
  test('刷新时读取自定义表情并缓存视觉描述', async () => {
    const catalog = new CustomFaceCatalogService(
      createBotClient([
        { id: 'face-1', file: 'custom-face://cat', summary: '猫猫震惊' },
        { id: 'face-1-duplicate', file: 'custom-face://cat', summary: '重复资源' },
        { id: 'face-2', file: 'custom-face://sad', name: '伤心猫' },
      ]),
      createVisionAgent(),
    );

    await catalog.refresh();

    expect(await catalog.recommend({ query: '震惊', limit: 10 })).toEqual([
      expect.objectContaining({
        id: 'face-1',
        file: 'custom-face://cat',
        content: '一只猫猫震惊地看着屏幕',
        suitableScenes: ['表达震惊', '吐槽离谱发言'],
      }),
      expect.objectContaining({
        id: 'face-2',
        file: 'custom-face://sad',
        content: '一只猫猫看起来很伤心',
      }),
    ]);
    expect(catalog.list({ limit: 10 })).toHaveLength(2);
    expect(catalog.getSnapshot()).toMatchObject({
      status: 'ready',
      faceCount: 2,
    });
  });

  test('视觉理解失败时保留可发送表情并写入降级描述', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const catalog = new CustomFaceCatalogService(
      createBotClient([{ id: 'face-1', file: 'custom-face://cat', summary: '猫猫震惊' }]),
      {
        async describeFace() {
          throw new Error('视觉模型不可用');
        },
        async selectFaces() {
          return [];
        },
      },
    );

    await catalog.refresh();

    expect(catalog.list({ limit: 1 })[0]).toMatchObject({
      id: 'face-1',
      file: 'custom-face://cat',
      content: '猫猫震惊',
      confidence: 0.2,
    });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('自定义表情理解失败'));
  });

  test('启动期全量刷新失败时工具返回降级观察且不抛异常', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const catalog = new CustomFaceCatalogService(
      createBotClient([], {
        async fetchCustomFaces() {
          throw new Error('NapCat暂时不可用');
        },
      }),
      createVisionAgent(),
    );

    await expect(catalog.refresh()).rejects.toThrow('NapCat暂时不可用');

    const executor = new BuiltinRuntimeToolExecutor(new InMemoryConversationHistory(), {
      customFaceCatalog: catalog,
    });
    const result = await executor.execute({
      event: createChatEvent(),
      toolName: GET_CUSTOM_FACES_TOOL_NAME,
      input: { query: '猫猫', limit: 5 },
    });

    expect(result).toMatchObject({
      success: true,
      observation: expect.stringContaining('当前自定义表情目录刷新失败'),
      structuredData: [],
    });
    expect(result.observation).toContain('NapCat暂时不可用');
  });

  test('缓存为空时工具只返回空目录且不触发懒刷新', async () => {
    const fetchCustomFaces = vi.fn(async () => [
      { id: 'face-1', file: 'custom-face://cat', summary: '猫猫震惊' },
    ]);
    const catalog = new CustomFaceCatalogService(
      createBotClient([], { fetchCustomFaces }),
      createVisionAgent(),
    );
    const registry = new BuiltinRuntimeToolRegistry({ customFaceCatalog: catalog });
    const executor = new BuiltinRuntimeToolExecutor(new InMemoryConversationHistory(), {
      customFaceCatalog: catalog,
    });

    expect(registry.getTool(GET_CUSTOM_FACES_TOOL_NAME)).toMatchObject({
      name: GET_CUSTOM_FACES_TOOL_NAME,
    });

    const result = await executor.execute({
      event: createChatEvent(),
      toolName: GET_CUSTOM_FACES_TOOL_NAME,
      input: { query: '猫猫', limit: 5 },
    });

    expect(result).toMatchObject({
      success: true,
      observation: '当前自定义表情目录为空，没有可用自定义表情。你可以改用文字或 QQ 内置表情回复。',
    });
    expect(result.structuredData).toEqual([]);
    expect(fetchCustomFaces).not.toHaveBeenCalled();
  });

  test('工具读取表情时只读取启动期缓存且不调用视觉推荐', async () => {
    const selectFaces = vi.fn(async () => [
      {
        id: 'face-1',
        reason: '不应在聊天期调用',
        score: 0.99,
      },
    ]);
    const catalog = new CustomFaceCatalogService(
      createBotClient([{ id: 'face-1', file: 'custom-face://cat', summary: '猫猫震惊' }]),
      createVisionAgent({ selectFaces }),
    );
    await catalog.refresh();
    const executor = new BuiltinRuntimeToolExecutor(new InMemoryConversationHistory(), {
      customFaceCatalog: catalog,
    });

    const result = await executor.execute({
      event: createChatEvent(),
      toolName: GET_CUSTOM_FACES_TOOL_NAME,
      input: { query: '哭哭', limit: 5 },
    });

    expect(result).toMatchObject({
      success: true,
      observation: expect.stringContaining('来自启动期缓存'),
    });
    expect(result.structuredData).toEqual([
      expect.objectContaining({
        id: 'face-1',
        file: 'custom-face://cat',
      }),
    ]);
    expect(selectFaces).not.toHaveBeenCalled();
  });

  test('自定义表情工具执行异常时返回失败观察而不是抛出', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const throwingCatalog = {
      async recommend() {
        throw new Error('缓存读取异常');
      },
      getSnapshot() {
        return { status: 'ready' as const, faceCount: 0 };
      },
    } as unknown as CustomFaceCatalogService;
    const executor = new BuiltinRuntimeToolExecutor(new InMemoryConversationHistory(), {
      customFaceCatalog: throwingCatalog,
    });

    await expect(
      executor.execute({
        event: createChatEvent(),
        toolName: GET_CUSTOM_FACES_TOOL_NAME,
        input: { query: '猫猫', limit: 5 },
      }),
    ).resolves.toMatchObject({
      success: false,
      observation: expect.stringContaining('自定义表情目录暂时不可用'),
      errorMessage: '缓存读取异常',
    });
  });
});

function createVisionAgent(
  overrides: Partial<CustomFaceVisionAgentPort> = {},
): CustomFaceVisionAgentPort {
  return {
    async describeFace(face) {
      return {
        content: face.file.includes('sad') ? '一只猫猫看起来很伤心' : '一只猫猫震惊地看着屏幕',
        emotion: face.file.includes('sad') ? '伤心' : '震惊',
        suitableScenes: face.file.includes('sad') ? ['表达委屈'] : ['表达震惊', '吐槽离谱发言'],
        avoidScenes: ['严肃通知'],
        tags: face.file.includes('sad') ? ['猫', '伤心'] : ['猫', '震惊'],
        confidence: 0.9,
      };
    },
    async selectFaces(demand, faces) {
      const targetFace = faces.find((face) => face.id === 'face-1') ?? faces[0];
      if (!targetFace) return [];

      return [
        {
          id: targetFace.id,
          reason: demand.includes('哭哭')
            ? '没有完全哭哭，但这个表情最适合接住情绪'
            : '需求与震惊情绪最匹配',
          score: demand.includes('哭哭') ? 0.74 : 0.91,
        },
      ];
    },
    ...overrides,
  };
}

function createBotClient(
  faces: readonly QqCustomFaceResource[],
  overrides: Partial<Pick<QqBotClientPort, 'fetchCustomFaces'>> = {},
): QqBotClientPort {
  return {
    async sendTextMessage() {},
    async sendMessageSegments() {},
    async sendPoke() {},
    async reactToMessage() {},
    async fetchCustomFaces() {
      return faces;
    },
    ...overrides,
  };
}

function createChatEvent(): PlatformMessage {
  return {
    id: 'chat-event-1' as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: 'qq:conversation:123456' as ConversationId,
    conversationType: 'group',
    senderId: 'qq:participant:20000' as ParticipantId,
    senderDisplayName: '测试用户',
    message: {
      id: 'message-1' as MessageId,
      type: 'text',
      text: '来个表情',
      mentions: [],
    },
    receivedAt: new Date('2026-07-07T00:00:00.000Z'),
  };
}
