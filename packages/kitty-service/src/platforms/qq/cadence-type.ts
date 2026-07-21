import type { PlatformMessage } from '@kitty/platforms/message';

/** 群聊节奏触发模式 */
export type GroupChatCadenceTriggerMode = 'mention' | 'random_window' | 'post_reply_counter';

/**
 * 群聊节奏判断结果
 *
 * 订阅器只根据这里决定是否把群聊消息交给 Agent；真正回复内容仍由 Agent 生成。
 */
export interface GroupChatCadenceDecision {
  /** 门控结果 */
  readonly type: 'trigger' | 'ignore' | 'wait';
  /** 触发来源 */
  readonly triggerMode?: GroupChatCadenceTriggerMode;
  /** true 表示本轮 Agent 必须向群里回复 */
  readonly replyRequired: boolean;
  /** true 表示本轮必须读取最近消息 */
  readonly requiresRecentMessages: true;
  /** 最近消息读取条数 */
  readonly recentMessageLimit: 100;
  /** 中文原因 */
  readonly reason: string;
}

/**
 * 群聊节奏端口
 *
 * 维护每个群的随机观察片段、回复后计时计数器，以及跨群主动请求预算。
 */
export interface GroupChatCadencePort {
  /**
   * 记录群聊消息
   * @param event 标准消息
   */
  recordMessage(event: PlatformMessage): void;

  /**
   * 判断当前消息是否触发 Agent
   * @param event 标准消息
   * @returns 节奏门控结果
   */
  shouldTrigger(event: PlatformMessage): GroupChatCadenceDecision;

  /**
   * 标记已成功回复
   * @param event 触发回复的消息
   */
  markReplySent(event: PlatformMessage): void;
}
