import type { PlatformMessage } from '@kitty/platforms/message';
import type { ConversationId } from '@kitty/shared/ids';
import type { RecommendedCustomFace } from '../../platforms/qq/face';
import type { CustomFaceCatalogService } from '../../platforms/qq/faces';
import type { ConversationHistoryPort } from '../history-type';
import { z } from 'zod';
import { Tool, type Tool as CanonicalTool } from './tool';

/** 最近消息工具名称 */
export const GET_RECENT_MESSAGES_TOOL_NAME = 'get_recent_messages';
/** 自定义表情目录工具名称 */
export const GET_CUSTOM_FACES_TOOL_NAME = 'get_custom_faces';
/** 私聊上下文窗口 */
const PRIVATE_RECENT_MESSAGE_LIMIT = 100;
/** 群聊上下文窗口 */
const GROUP_RECENT_MESSAGE_LIMIT = 100;

/** 内置消息工具依赖。 */
export interface MessageToolDependencies {
  /** 自定义表情目录 */
  readonly customFaceCatalog?: CustomFaceCatalogService;
}

/**
 * 创建本轮消息工具
 * @param event 当前平台消息
 * @param history 会话历史
 * @param dependencies 可选平台能力
 * @returns 名称到规范Tool映射
 */
export function createMessageTools(
  event: PlatformMessage,
  history: ConversationHistoryPort,
  dependencies: MessageToolDependencies = {},
): Readonly<Record<string, CanonicalTool>> {
  return Object.freeze({
    [GET_RECENT_MESSAGES_TOOL_NAME]: createRecentMessagesTool(event, history),
    ...(dependencies.customFaceCatalog
      ? {
          [GET_CUSTOM_FACES_TOOL_NAME]: createCustomFacesTool(dependencies.customFaceCatalog),
        }
      : {}),
  });
}

// 创建最近消息只读工具。
function createRecentMessagesTool(
  event: PlatformMessage,
  history: ConversationHistoryPort,
): CanonicalTool {
  return Tool.make({
    description: '读取当前会话最近消息，用于判断上下文和是否需要回复。',
    parameters: z.object({}).strict(),
    policy: {
      source: 'builtin',
      risk: 'low',
      approval: 'never',
      timeoutMs: 3000,
      consumesBudget: true,
    },
    execute: () => {
      const limit = getRecentMessageLimit(event.conversationType);
      const messages = history.getRecentMessages(event.conversationId, limit);
      console.info(
        `✅ [AgentRuntime-Tool-getRecentMessages] 已读取最近消息 conversationId=${maskId(
          String(event.conversationId),
        )} conversationType=${event.conversationType} count=${messages.length} limit=${limit}`,
      );
      return {
        success: true,
        summary: formatRecentMessagesObservation(event.conversationId, messages),
        data: messages.map(toRecentMessageSummary),
      };
    },
  });
}

// 创建自定义表情目录工具。
function createCustomFacesTool(catalog: CustomFaceCatalogService): CanonicalTool {
  return Tool.make({
    description: '读取启动期缓存的QQ自定义表情目录，用于根据描述选择合适表情回复。',
    parameters: z
      .object({
        query: z.string().trim().min(1).optional().describe('表情需求'),
        limit: z.number().int().positive().optional().describe('返回数量上限'),
      })
      .strict(),
    policy: {
      source: 'builtin',
      risk: 'low',
      approval: 'never',
      timeoutMs: 5000,
      consumesBudget: true,
    },
    execute: async (input: { query?: string; limit?: number }) => {
      try {
        const faces = await catalog.recommend(input);
        const snapshot = catalog.getSnapshot();
        console.info(
          `✅ [AgentRuntime-Tool-getCustomFaces] 已读取自定义表情缓存 count=${faces.length} demandLength=${input.query?.length ?? 0} status=${snapshot.status}`,
        );
        return {
          success: true,
          summary: formatCustomFacesObservation(faces, snapshot),
          data: faces.map(toCustomFaceSummary),
        };
      } catch (error) {
        const reason = formatError(error);
        console.warn(
          `⚠️ [AgentRuntime-Tool-getCustomFaces] 自定义表情目录读取失败，已返回降级观察 demandLength=${input.query?.length ?? 0} reason=${reason}`,
        );
        return {
          success: false,
          summary:
            '自定义表情目录暂时不可用。可以直接用文字说明网络不好、暂时看不到图片或无法理解表情，不要中断聊天。',
          error: reason,
          retryable: true,
        };
      }
    },
  });
}

// 转换自定义表情摘要。
function toCustomFaceSummary(face: RecommendedCustomFace): Record<string, unknown> {
  return {
    id: face.id,
    file: face.file,
    content: face.content,
    emotion: face.emotion,
    suitableScenes: face.suitableScenes,
    avoidScenes: face.avoidScenes,
    tags: face.tags,
    confidence: face.confidence,
    recommendationReason: face.recommendationReason,
    recommendationScore: face.recommendationScore,
  };
}

// 格式化自定义表情目录观察。
function formatCustomFacesObservation(
  faces: readonly RecommendedCustomFace[],
  snapshot: ReturnType<CustomFaceCatalogService['getSnapshot']>,
): string {
  if (faces.length === 0) {
    if (snapshot.status === 'failed') {
      return '当前自定义表情目录刷新失败，暂时看不到可用表情。可以改用文字回复。';
    }
    if (snapshot.status === 'refreshing') {
      return '自定义表情目录正在刷新，当前还没有可用表情。可以先用文字回复。';
    }
    return '当前自定义表情目录为空，可以改用文字或QQ内置表情回复。';
  }

  return [
    `可用自定义表情 ${faces.length} 个，来自启动期缓存：`,
    ...faces.map(
      (face, index) =>
        `${index + 1}. id=${face.id} file=${face.file} 内容=${face.content} 情绪=${face.emotion} 适用=${face.suitableScenes.join('、') || '未知'} 避免=${face.avoidScenes.join('、') || '未知'} 标签=${face.tags.join('、') || '无'} 置信度=${face.confidence}`,
    ),
  ].join('\n');
}

// 按会话类型选择上下文窗口。
function getRecentMessageLimit(conversationType: PlatformMessage['conversationType']): number {
  return conversationType === 'private' ? PRIVATE_RECENT_MESSAGE_LIMIT : GROUP_RECENT_MESSAGE_LIMIT;
}

// 格式化最近消息观察。
function formatRecentMessagesObservation(
  conversationId: ConversationId,
  messages: readonly PlatformMessage[],
): string {
  if (messages.length === 0) return `会话 ${conversationId} 暂无最近消息。`;
  return [
    `会话 ${conversationId} 最近 ${messages.length} 条消息：`,
    ...messages.map(
      (message, index) =>
        `${index + 1}. ${message.receivedAt.toISOString()} ${message.senderDisplayName ?? '未知用户'} messageId=${message.message.id} text=${message.message.text}`,
    ),
  ].join('\n');
}

// 转为结构化消息摘要。
function toRecentMessageSummary(message: PlatformMessage): Record<string, string> {
  return {
    messageId: String(message.message.id),
    senderDisplayName: message.senderDisplayName ?? '未知用户',
    text: message.message.text,
    receivedAt: message.receivedAt.toISOString(),
  };
}

// 脱敏会话ID。
function maskId(value: string): string {
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}

// 压缩错误内容。
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
