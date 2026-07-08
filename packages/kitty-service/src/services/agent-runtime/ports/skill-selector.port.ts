import type { SkillMetadata } from '../domain/skill';

/**
 * Skill选择端口
 *
 * 根据平台无关运行上下文和已知 Skill 元信息，决定本轮 Agent 可见哪些能力。
 */
export interface SkillSelectorPort<TInput> {
  /**
   * 选择本轮Skill
   * @param input 选择上下文
   * @param skills 已加载元信息
   * @returns 本轮可见的Skill
   */
  selectSkills(input: TInput, skills: readonly SkillMetadata[]): Promise<SkillMetadata[]>;
}
