import type { SkillContent } from '../domain/skill';

/**
 * Skill内容加载端口
 *
 * 在运行时按需读取 Skill 正文，避免 Agent Runtime 启动时加载完整能力包。
 */
export interface SkillContentLoaderPort {
  /**
   * 加载Skill正文
   * @param skillName Skill名称
   * @returns Skill正文内容
   */
  loadSkillContent(skillName: string): Promise<SkillContent>;
}
