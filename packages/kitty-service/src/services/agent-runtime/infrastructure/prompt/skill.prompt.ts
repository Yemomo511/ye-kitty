import type { SkillContent } from '../../domain/skill';

/**
 * 构建Skill提示词
 * @param skills 本轮启用Skill
 * @returns Skill提示词片段
 */
export function buildSkillPrompt(skills: readonly SkillContent[]): string {
  if (skills.length === 0) return '';

  return [
    '本轮启用 Skill：',
    ...skills.map((skill) =>
      [
        `## ${skill.metadata.name}`,
        `描述：${skill.metadata.description}`,
        '能力说明：',
        skill.body,
      ].join('\n'),
    ),
  ].join('\n\n');
}
