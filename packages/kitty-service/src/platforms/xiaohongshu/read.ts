import type { XiaohongshuMentionPage } from './message';

/** 小红书被提及读取能力 */
export interface XiaohongshuMentionReaderPort {
  /** 读取通知中心当前最新一页提醒 */
  listMentions(): Promise<XiaohongshuMentionPage>;
}
