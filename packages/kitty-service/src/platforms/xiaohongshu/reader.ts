import { createHash } from 'node:crypto';
import type { XiaohongshuMention, XiaohongshuMentionPage } from './message';
import type { McpRawToolCaller } from '@kitty/shared/mcp';
import type { XiaohongshuMentionReaderPort } from './read';

/**
 * MCP小红书被提及读取器
 *
 * 私有网页响应的字段差异被限制在该适配器内，平台应用层只接收稳定领域对象。
 */
export class McpXiaohongshuMentionReader implements XiaohongshuMentionReaderPort {
  private readonly toolName: string;

  constructor(
    private readonly caller: McpRawToolCaller,
    serverName: string,
  ) {
    this.toolName = `${serverName}_list_mentions`;
  }

  /** 读取并标准化通知中心最新一页提醒 */
  async listMentions(): Promise<XiaohongshuMentionPage> {
    if (!this.caller.hasTool(this.toolName)) {
      throw new Error(`小红书MCP缺少内部工具 ${this.toolName}`);
    }

    const result = await this.caller.callToolRaw(this.toolName, null);
    const resultText = readResultText(result.content);
    if (result.isError) throw new Error(resultText || '小红书MCP读取被提及失败');

    const payload = result.structuredContent ?? parseJsonResult(resultText);
    return normalizeMentionPage(payload);
  }
}

// MCP结果可能包含多个内容块，只拼接文本块用于JSON解析或错误展示。
function readResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!isRecord(item) || item.type !== 'text') return '';
      return typeof item.text === 'string' ? item.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

// 将上游文本结果解析为JSON，并保留明确的结构错误。
function parseJsonResult(text: string): unknown {
  if (!text) throw new Error('小红书MCP没有返回可读JSON');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('小红书MCP返回的被提及结果不是有效JSON');
  }
}

// 兼容网页原始响应和已解包data响应，不把私有字段泄漏到领域层。
function normalizeMentionPage(payload: unknown): XiaohongshuMentionPage {
  const root = requireRecord(payload, '小红书被提及结果缺少对象结构');
  const data = isRecord(root.data) ? root.data : root;
  const rawMessages = data.message_list;
  if (!Array.isArray(rawMessages)) throw new Error('小红书被提及结果缺少message_list');

  const mentions = rawMessages.map((message, index) => normalizeMention(message, index));
  return {
    mentions,
    ...(readString(data, ['cursor']) ? { cursor: readString(data, ['cursor']) } : {}),
    hasMore: readBoolean(data, ['has_more', 'hasMore']) ?? false,
  };
}

// 对常见字段别名做容错，关键ID缺失时用稳定摘要保证去重。
function normalizeMention(input: unknown, index: number): XiaohongshuMention {
  const message = requireRecord(input, `小红书第${index + 1}条被提及结构无效`);
  const user = isRecord(message.user_info) ? message.user_info : {};
  const item = isRecord(message.item_info) ? message.item_info : {};
  const title = readString(message, ['title']) ?? '';
  const content =
    readString(message, ['content', 'text']) ?? readString(item, ['content', 'title']) ?? title;
  const actorId = readString(user, ['user_id', 'id']);
  const noteId = readString(item, ['note_id', 'id']) ?? readString(message, ['note_id']);
  const commentId =
    readString(item, ['comment_id']) ?? readString(message, ['comment_id', 'target_comment_id']);
  const occurredAt = normalizeTimestamp(readNumber(message, ['time', 'timestamp', 'created_at']));
  const explicitId = readString(message, ['id', 'message_id', 'notification_id']);
  const id =
    explicitId ??
    createHash('sha256')
      .update([actorId, noteId, commentId, occurredAt?.toISOString(), title, content].join('|'))
      .digest('hex')
      .slice(0, 24);

  return {
    id,
    ...(actorId ? { actorId } : {}),
    ...(readString(user, ['nickname', 'name'])
      ? { actorDisplayName: readString(user, ['nickname', 'name']) }
      : {}),
    title,
    content,
    ...(noteId ? { noteId } : {}),
    ...(commentId ? { commentId } : {}),
    ...(readString(message, ['url', 'link']) ? { url: readString(message, ['url', 'link']) } : {}),
    ...(occurredAt ? { occurredAt } : {}),
  };
}

function normalizeTimestamp(value: number | undefined): Date | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function readBoolean(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  for (const key of keys) {
    if (typeof record[key] === 'boolean') return record[key];
  }
  return undefined;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
