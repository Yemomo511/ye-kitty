import type { SkillContent } from '../../domain/skill';
import { buildAvailableSkillCatalogPrompt, buildEnabledSkillPrompt } from './conversation-renderer';

export { buildAvailableSkillCatalogPrompt, buildEnabledSkillPrompt };

/**
 * 构建兼容旧QQ回复链路的Skill提示词
 * @param skills 已启用Skill
 * @returns Skill提示词片段
 */
export function buildSkillPrompt(skills: readonly SkillContent[]): string {
  return buildEnabledSkillPrompt(skills);
}
