import type { PlatformMessage } from '@kitty/platforms/message';
import type { QqCustomFaceResource } from '@kitty/platforms/qq/api';
import type { QqBotClientPort } from '@kitty/platforms/qq/client';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';
import { describe, expect, test, vi } from 'vitest';
import { InMemoryConversationHistory } from '../../history';
import { CustomFaceCatalogService } from '../../../platforms/qq/faces';
import type { CustomFaceVisionAgentPort } from '../../../platforms/qq/vision';
import { createMessageTools, GET_CUSTOM_FACES_TOOL_NAME } from '../messages';
import { Tool } from '../tool';
import { createToolTestContext } from './runtime-context';

describe('自定义表情Tool', () => {
  test('读取启动期缓存并返回可审计资源', async () => {
    const catalog = new CustomFaceCatalogService(
      createBotClient([{ id: 'face-1', file: 'custom-face://cat', summary: '震惊猫' }]),
      createVisionAgent(),
    );
    await catalog.refresh();
    const tool = createMessageTools(createMessage(), new InMemoryConversationHistory(), {
      customFaceCatalog: catalog,
    })[GET_CUSTOM_FACES_TOOL_NAME];

    const settlement = await Tool.settle(
      GET_CUSTOM_FACES_TOOL_NAME,
      tool,
      { query: '震惊', limit: 5 },
      createToolTestContext(),
    );

    expect(settlement).toMatchObject({
      status: 'success',
      output: {
        summary: expect.stringContaining('来自启动期缓存'),
        data: [expect.objectContaining({ file: 'custom-face://cat' })],
      },
    });
  });

  test('缓存为空时不触发聊天期懒刷新', async () => {
    const fetchCustomFaces = vi.fn(async () => [{ id: 'face-1', file: 'custom-face://cat' }]);
    const catalog = new CustomFaceCatalogService(
      createBotClient([], { fetchCustomFaces }),
      createVisionAgent(),
    );
    const tool = createMessageTools(createMessage(), new InMemoryConversationHistory(), {
      customFaceCatalog: catalog,
    })[GET_CUSTOM_FACES_TOOL_NAME];

    const settlement = await Tool.settle(
      GET_CUSTOM_FACES_TOOL_NAME,
      tool,
      { query: '猫猫', limit: 5 },
      createToolTestContext(),
    );

    expect(settlement.output?.data).toEqual([]);
    expect(fetchCustomFaces).not.toHaveBeenCalled();
  });

  test('缓存读取异常转换为受控失败观察', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const throwingCatalog = {
      async recommend() {
        throw new Error('缓存读取异常');
      },
      getSnapshot() {
        return { status: 'ready' as const, faceCount: 0 };
      },
    } as unknown as CustomFaceCatalogService;
    const tool = createMessageTools(createMessage(), new InMemoryConversationHistory(), {
      customFaceCatalog: throwingCatalog,
    })[GET_CUSTOM_FACES_TOOL_NAME];

    const settlement = await Tool.settle(
      GET_CUSTOM_FACES_TOOL_NAME,
      tool,
      { query: '猫猫', limit: 5 },
      createToolTestContext(),
    );

    expect(settlement).toMatchObject({
      status: 'error',
      output: {
        summary: expect.stringContaining('自定义表情目录暂时不可用'),
        error: '缓存读取异常',
      },
    });
  });
});

function createVisionAgent(): CustomFaceVisionAgentPort {
  return {
    async describeFace() {
      return {
        content: '一只震惊的猫',
        emotion: '震惊',
        suitableScenes: ['表达震惊'],
        avoidScenes: ['严肃通知'],
        tags: ['猫'],
        confidence: 0.9,
      };
    },
    async selectFaces() {
      return [];
    },
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

function createMessage(): PlatformMessage {
  return {
    id: 'event-1' as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: 'group-1' as ConversationId,
    conversationType: 'group',
    senderId: 'user-1' as ParticipantId,
    message: {
      id: 'message-1' as MessageId,
      type: 'text',
      text: '来个表情',
      mentions: [],
    },
    receivedAt: new Date('2026-07-23T00:00:00.000Z'),
  };
}
