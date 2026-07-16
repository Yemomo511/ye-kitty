import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SenderBatch } from './sender-batch';

/**
 * Actor 快照
 *
 * ConversationActor 在每条消息处理完成后保存的状态快照，
 * 用于崩溃后恢复会话的对话记忆（history）和待办清单（mailbox）。
 */
export interface ActorSnapshot {
  /** 会话ID */
  readonly conversationId: string;
  /** 已处理的聊天事件（记忆） */
  readonly history: readonly ChatEventContract[];
  /** 未处理的邮件箱批次（待办） */
  readonly mailbox: readonly SenderBatch[];
  /** 正在处理中的消息（可选，崩溃时可丢弃） */
  readonly currentMessage?: ChatEventContract;
  /** 累计崩溃次数 */
  readonly errorCount: number;
  /** 快照序号（单调递增） */
  readonly sequenceNumber: number;
  /** 快照生成时间戳 */
  readonly createdAt: number;
}
