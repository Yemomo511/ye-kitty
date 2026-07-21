/** 小红书提醒来源定位信息 */
export interface XiaohongshuMentionOrigin {
  /** 来源笔记ID */
  readonly noteId?: string;
  /** 来源评论ID */
  readonly commentId?: string;
  /** 可用时的来源链接 */
  readonly url?: string;
}

/**
 * 小红书被提及事件
 *
 * 平台层将网页私有字段转为该稳定契约，上层不应读取原始通知载荷。
 */
export interface XiaohongshuMessage {
  readonly id: string;
  readonly platform: 'xiaohongshu';
  readonly eventType: 'mention.received';
  readonly mentionId: string;
  readonly senderId: string;
  readonly senderDisplayName?: string;
  readonly content: string;
  readonly source: XiaohongshuMentionOrigin;
  readonly occurredAt?: Date;
  readonly receivedAt: Date;
}
