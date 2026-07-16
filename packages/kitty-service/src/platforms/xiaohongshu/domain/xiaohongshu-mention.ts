/** 小红书被提及领域对象 */
export interface XiaohongshuMention {
  readonly id: string;
  readonly actorId?: string;
  readonly actorDisplayName?: string;
  readonly title: string;
  readonly content: string;
  readonly noteId?: string;
  readonly commentId?: string;
  readonly url?: string;
  readonly occurredAt?: Date;
}

/** 小红书被提及列表页 */
export interface XiaohongshuMentionPage {
  readonly mentions: readonly XiaohongshuMention[];
  readonly cursor?: string;
  readonly hasMore: boolean;
}

/** 被提及检查点，只保存去重所需ID，不保存通知正文 */
export interface XiaohongshuMentionCheckpoint {
  readonly initialized: boolean;
  readonly recentMentionIds: readonly string[];
}
