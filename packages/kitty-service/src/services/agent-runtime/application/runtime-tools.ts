import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { ConversationId } from '@kitty/shared/types/ids';
import type { RecommendedCustomFace } from '../domain/custom-face';
import type { RuntimeTool, RuntimeToolCall, ToolExecutionResult } from '../domain/tool';
import type { CustomFaceCatalogService } from './custom-face-catalog.service';
import type { ConversationHistoryPort } from '../ports/conversation-history.port';
import type { RuntimeToolExecutorPort } from '../ports/tool-executor.port';
import type { RuntimeToolRegistryPort } from '../ports/tool-registry.port';

/** 最近消息工具名称 */
export const GET_RECENT_MESSAGES_TOOL_NAME = 'get_recent_messages';
/** 自定义表情目录工具名称 */
export const GET_CUSTOM_FACES_TOOL_NAME = 'get_custom_faces';
/** 私聊上下文窗口 */
const PRIVATE_RECENT_MESSAGE_LIMIT = 100;
/** 群聊上下文窗口 */
const GROUP_RECENT_MESSAGE_LIMIT = 50;

/** 内置工具依赖 */
export interface BuiltinRuntimeToolDependencies {
  /** 自定义表情目录 */
  readonly customFaceCatalog?: CustomFaceCatalogService;
}

/**
 * 内置工具注册表
 *
 * MVP 只暴露只读工具，后续 MCP 或写操作工具也必须先注册到这里。
 */
export class BuiltinRuntimeToolRegistry implements RuntimeToolRegistryPort {
  private readonly tools: readonly RuntimeTool[];

  constructor(dependencies: BuiltinRuntimeToolDependencies = {}) {
    this.tools = [
      {
        name: GET_RECENT_MESSAGES_TOOL_NAME,
        description: '读取当前会话最近消息，用于判断上下文和是否需要回复。',
        riskLevel: 'low',
        inputSchemaDescription: '{}',
      },
      ...(dependencies.customFaceCatalog
        ? [
            {
              name: GET_CUSTOM_FACES_TOOL_NAME,
              description: '读取启动期缓存的QQ自定义表情目录，用于根据描述选择合适表情回复。',
              riskLevel: 'low' as const,
              inputSchemaDescription: '{ "query"?: string 表情需求, "limit"?: number }',
            },
          ]
        : []),
    ];
  }

  /**
   * 列出工具
   * @returns 可见工具
   */
  listTools(): readonly RuntimeTool[] {
    return this.tools;
  }

  /**
   * 查找工具
   * @param toolName 工具名称
   * @returns 工具定义
   */
  getTool(toolName: string): RuntimeTool | undefined {
    return this.tools.find((tool) => tool.name === toolName);
  }
}

/**
 * 内置工具执行器
 *
 * 将已授权的工具调用收敛到本地只读能力，并返回中文观察摘要。
 */
export class BuiltinRuntimeToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly conversationHistory: ConversationHistoryPort,
    private readonly dependencies: BuiltinRuntimeToolDependencies = {},
  ) {}

  /**
   * 执行工具
   * @param call 工具调用
   * @returns 工具观察结果
   */
  async execute(call: RuntimeToolCall): Promise<ToolExecutionResult> {
    if (call.toolName === GET_RECENT_MESSAGES_TOOL_NAME) {
      return this.getRecentMessages(call.event);
    }

    if (call.toolName === GET_CUSTOM_FACES_TOOL_NAME) {
      return await this.getCustomFaces(call.input);
    }

    return {
      toolName: call.toolName,
      success: false,
      observation: `工具 ${call.toolName} 未注册，不能执行。`,
      errorMessage: '工具未注册',
    };
  }

  // 读取自定义表情目录。
  private async getCustomFaces(input: unknown): Promise<ToolExecutionResult> {
    const catalog = this.dependencies.customFaceCatalog;
    if (!catalog) {
      return {
        toolName: GET_CUSTOM_FACES_TOOL_NAME,
        success: false,
        observation: '自定义表情目录未配置，不能读取。',
        errorMessage: '自定义表情目录未配置',
      };
    }

    const query = isRecord(input) && typeof input.query === 'string' ? input.query : undefined;
    const limit = isRecord(input) && typeof input.limit === 'number' ? input.limit : undefined;
    try {
      const faces = await catalog.recommend({ query, limit });
      const snapshot = catalog.getSnapshot();

      console.info(
        `✅ [AgentRuntime-Tool-getCustomFaces] 已读取自定义表情缓存 count=${faces.length} demandLength=${query?.trim().length ?? 0} status=${snapshot.status}`,
      );

      return {
        toolName: GET_CUSTOM_FACES_TOOL_NAME,
        success: true,
        observation: formatCustomFacesObservation(faces, snapshot),
        structuredData: faces.map((face) => ({
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
        })),
      };
    } catch (error) {
      const reason = formatError(error);
      console.warn(
        `⚠️ [AgentRuntime-Tool-getCustomFaces] 自定义表情目录读取失败，已返回降级观察 demandLength=${query?.trim().length ?? 0} reason=${reason}`,
      );
      return {
        toolName: GET_CUSTOM_FACES_TOOL_NAME,
        success: false,
        observation: `自定义表情目录暂时不可用，原因：${reason}。你可以直接用文字说明现在网络不好、暂时看不到图片或无法理解表情，不要中断聊天。`,
        errorMessage: reason,
      };
    }
  }

  // 读取当前会话最近消息。
  private getRecentMessages(event: ChatEventContract): ToolExecutionResult {
    const limit = getRecentMessageLimit(event.conversationType);
    const messages = this.conversationHistory.getRecentMessages(event.conversationId, limit);

    console.info(
      `✅ [AgentRuntime-Tool-getRecentMessages] 已读取最近消息 conversationId=${maskId(
        String(event.conversationId),
      )} conversationType=${event.conversationType} count=${messages.length} limit=${limit}`,
    );

    return {
      toolName: GET_RECENT_MESSAGES_TOOL_NAME,
      success: true,
      observation: formatRecentMessagesObservation(event.conversationId, messages),
      structuredData: messages.map(toRecentMessageSummary),
    };
  }
}

// 格式化自定义表情目录观察。
function formatCustomFacesObservation(
  faces: readonly RecommendedCustomFace[],
  snapshot: ReturnType<CustomFaceCatalogService['getSnapshot']>,
): string {
  if (faces.length === 0) {
    if (snapshot.status === 'failed') {
      return `当前自定义表情目录刷新失败，暂时看不到可用表情。失败原因：${snapshot.lastFailureReason ?? '未知'}。你可以用文字说明网络不好、暂时看不到图片或无法理解表情。`;
    }

    if (snapshot.status === 'refreshing') {
      return '自定义表情目录正在启动期刷新中，当前还没有可用表情。你可以先用文字回复，或说明暂时看不到表情。';
    }

    return '当前自定义表情目录为空，没有可用自定义表情。你可以改用文字或 QQ 内置表情回复。';
  }

  return [
    `可用自定义表情 ${faces.length} 个，来自启动期缓存：`,
    ...faces.map(
      (face, index) =>
        `${index + 1}. id=${face.id} file=${face.file} 内容=${face.content} 情绪=${face.emotion} 适用=${face.suitableScenes.join('、') || '未知'} 避免=${face.avoidScenes.join('、') || '未知'} 标签=${face.tags.join('、') || '无'} 置信度=${face.confidence}${face.recommendationReason ? ` 推荐理由=${face.recommendationReason}` : ''}${typeof face.recommendationScore === 'number' ? ` 推荐分=${face.recommendationScore}` : ''}`,
    ),
  ].join('\n');
}

// 按会话类型选择上下文窗口，避免群聊噪声挤压私聊连续上下文。
function getRecentMessageLimit(conversationType: ChatEventContract['conversationType']): number {
  return conversationType === 'private' ? PRIVATE_RECENT_MESSAGE_LIMIT : GROUP_RECENT_MESSAGE_LIMIT;
}

// 格式化最近消息观察。
function formatRecentMessagesObservation(
  conversationId: ConversationId,
  messages: readonly ChatEventContract[],
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

// 转为结构化摘要。
function toRecentMessageSummary(message: ChatEventContract): Record<string, string> {
  return {
    messageId: String(message.message.id),
    senderDisplayName: message.senderDisplayName ?? '未知用户',
    text: message.message.text,
    receivedAt: message.receivedAt.toISOString(),
  };
}

// 判断普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

// 脱敏会话ID。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}

// 压缩错误内容。
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
