import type { SkillContent } from '../domain/skill';
import type { SkillReferenceContent } from '../domain/skill-reference';

/**
 * Skill引用加载端口
 *
 * 实现方只能读取已启用 Skill 的 references 目录，不能扩大为通用文件读取能力。
 */
export interface SkillReferenceLoaderPort {
  /**
   * 加载引用文件
   * @param skill 已启用Skill
   * @param referencePath 引用路径
   * @returns 引用内容
   */
  loadSkillReference(skill: SkillContent, referencePath: string): Promise<SkillReferenceContent>;
}
