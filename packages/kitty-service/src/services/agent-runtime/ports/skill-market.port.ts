import type { SkillMetadata } from '../domain/skill';

/**
 * Skill市场端口
 *
 * 提供启动期扫描 Skill 元信息的能力，具体实现可以来自本地文件系统或远程市场。
 */
export interface SkillMarketPort {
  /**
   * 列出全部Skill元信息
   * @returns Skill元信息列表
   */
  listSkillMetadata(): Promise<SkillMetadata[]>;
}
