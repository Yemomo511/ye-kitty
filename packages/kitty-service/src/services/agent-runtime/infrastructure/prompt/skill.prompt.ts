import type { SkillContent, SkillMetadata } from '../../domain/skill';

/**
 * 构建可用Skill目录提示词
 * @param skills 本轮可请求Skill
 * @returns Skill目录片段
 */
export function buildAvailableSkillCatalogPrompt(skills: readonly SkillMetadata[]): string {
  if (skills.length === 0) return '';

  return [
    '本轮可请求 Skill：',
    '下面只是一份能力目录。除非你通过 `skill_call` 启用对应 Skill，否则不能把目录描述当成完整方法论执行。',
    ...skills.map((skill) =>
      [
        `## ${skill.name}`,
        `描述：${skill.description}`,
        `建议工具：${formatAllowedTools(skill.allowedTools)}`,
      ].join('\n'),
    ),
  ].join('\n\n');
}

/**
 * 构建已启用Skill正文提示词
 * @param skills 已注入正文Skill
 * @returns Skill正文片段
 */
export function buildEnabledSkillPrompt(skills: readonly SkillContent[]): string {
  if (skills.length === 0) return '';

  return [
    '本轮已启用 Skill 正文：',
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

/**
 * 构建兼容旧QQ回复链路的Skill提示词
 * @param skills 已启用Skill
 * @returns Skill提示词片段
 */
export function buildSkillPrompt(skills: readonly SkillContent[]): string {
  return buildEnabledSkillPrompt(skills);
}

// 展示Skill建议工具，不代表最终执行授权。
function formatAllowedTools(allowedTools: readonly string[] | undefined): string {
  return allowedTools && allowedTools.length > 0 ? allowedTools.join(', ') : '未声明';
}
