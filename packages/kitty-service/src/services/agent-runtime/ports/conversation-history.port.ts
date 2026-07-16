import type { ConversationHistory } from '../domain/conversation-history';

/**
 * 会话历史端口
 *
 * 扩展 domain 层 ConversationHistory，MVP 使用进程内实现。
 */
export type { ConversationHistory };
export type ConversationHistoryPort = ConversationHistory;
