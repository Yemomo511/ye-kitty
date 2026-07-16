import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';

/**
 * 同一发送者的消息批次
 *
 * 邮件箱将同一发送者的连续消息归入一个批次，
 * 在 grace 期结束后封口并送入 Actor 处理。
 * LLM 自行判断批次内消息是拆分、纠正还是独立问题。
 */
export interface SenderBatch {
  /** 批次唯一标识 */
  readonly id: string;
  /** 发送者ID */
  readonly senderId: string;
  /** 批次内的消息列表（Mailbox 可追加） */
  messages: ChatEventContract[];
  /** 是否已封口（不再接受追加） */
  sealed: boolean;
  /** 批次创建时间（第一条消息到达时间） */
  readonly createdAt: number;
  /** 最后追加时间（Mailbox 更新） */
  lastAppendedAt: number;
}
