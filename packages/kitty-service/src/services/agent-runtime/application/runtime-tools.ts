import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { ConversationId } from '@kitty/shared/types/ids';
import type { RuntimeTool, RuntimeToolCall, ToolExecutionResult } from '../domain/tool';
import type { ConversationHistoryPort } from '../ports/conversation-history.port';
import type { RuntimeToolExecutorPort } from '../ports/tool-executor.port';
import type { RuntimeToolRegistryPort } from '../ports/tool-registry.port';

/** 最近消息工具名称 */
export const GET_RECENT_MESSAGES_TOOL_NAME = 'get_recent_messages';
/** 私聊上下文窗口 */
const PRIVATE_RECENT_MESSAGE_LIMIT = 100;
/** 群聊上下文窗口 */
const GROUP_RECENT_MESSAGE_LIMIT = 50;

/**
 * 内置工具注册表
 *
 * MVP 只暴露只读工具，后续 MCP 或写操作工具也必须先注册到这里。
 */
export class BuiltinRuntimeToolRegistry implements RuntimeToolRegistryPort {
  private readonly tools: readonly RuntimeTool[] = [
    {
      name: GET_RECENT_MESSAGES_TOOL_NAME,
      description: '读取当前会话最近消息，用于判断上下文和是否需要回复。',
      riskLevel: 'low',
      inputSchemaDescription: '{}',
    },
  ];

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
  constructor(private readonly conversationHistory: ConversationHistoryPort) {}

  /**
   * 执行工具
   * @param call 工具调用
   * @returns 工具观察结果
   */
  async execute(call: RuntimeToolCall): Promise<ToolExecutionResult> {
    if (call.toolName === GET_RECENT_MESSAGES_TOOL_NAME) {
      return this.getRecentMessages(call.event);
    }

    return {
      toolName: call.toolName,
      success: false,
      observation: `工具 ${call.toolName} 未注册，不能执行。`,
      errorMessage: '工具未注册',
    };
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

// 脱敏会话ID。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}
