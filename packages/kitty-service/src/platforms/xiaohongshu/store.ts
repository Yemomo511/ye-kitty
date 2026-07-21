import type { XiaohongshuMentionCheckpoint } from './message';

/** 小红书被提及检查点仓库 */
export interface XiaohongshuMentionCheckpointRepositoryPort {
  /** 读取上次成功处理后的检查点 */
  load(): Promise<XiaohongshuMentionCheckpoint | undefined>;
  /** 原子保存新检查点 */
  save(checkpoint: XiaohongshuMentionCheckpoint): Promise<void>;
}
