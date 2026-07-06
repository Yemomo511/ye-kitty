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
        `建议工具：${formatAllowedTools(skill.metadata.allowedTools)}`,
        '能力说明：',
        skill.body,
      ].join('\n'),
    ),
  ].join('\n\n');
}

// 展示Skill建议工具，不代表最终执行授权。
function formatAllowedTools(allowedTools: readonly string[] | undefined): string {
  return allowedTools && allowedTools.length > 0 ? allowedTools.join(', ') : '未声明';
}
