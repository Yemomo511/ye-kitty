import type { SkillMetadata } from '../domain/skill';
import type { SkillSelectionContext } from '../domain/skill-selection-context';
import type { SkillSelectorPort } from '../ports/skill-selector.port';

/** 默认最大可见Skill数 */
export const DEFAULT_VISIBLE_SKILL_LIMIT = 8;

/**
 * 默认Skill选择器
 *
 * MVP 不做触发评分，只把可用能力目录交给模型自主判断。
 */
export class DefaultSkillSelector implements SkillSelectorPort<SkillSelectionContext> {
  constructor(private readonly visibleSkillLimit = DEFAULT_VISIBLE_SKILL_LIMIT) {}

  /**
   * 选择本轮可见Skill
   * @param _input 平台无关上下文
   * @param skills 已加载元信息
   * @returns 可见Skill目录
   */
  async selectSkills(
    _input: SkillSelectionContext,
    skills: readonly SkillMetadata[],
  ): Promise<SkillMetadata[]> {
    return skills.slice(0, this.visibleSkillLimit);
  }
}
