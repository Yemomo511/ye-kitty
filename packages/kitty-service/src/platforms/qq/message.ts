/**
 * QQ文本消息载荷
 *
 * 表示 QQ 平台适配层已经提取出的文本消息。
 * 该结构仍保留平台原始载荷，方便排查 OneBot/NapCat 事件差异。
 */
export interface QqTextMessagePayload {
  /** 平台消息ID */
  readonly messageId: string;
  /** 群号或好友号 */
  readonly conversationExternalId: string;
  /** 会话类型 */
  readonly conversationType: 'private' | 'group';
  /** 发送者QQ号 */
  readonly senderExternalId: string;
  /** 发送者展示名 */
  readonly senderDisplayName?: string;
  /** 纯文本内容 */
  readonly text: string;
  /** 被@的QQ号 */
  readonly mentions: readonly string[];
  /** 平台接收时间 */
  readonly receivedAt: Date;
  /** 平台原始事件 */
  readonly rawPayload: unknown;
}
