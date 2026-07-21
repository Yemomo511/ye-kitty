import type { SkillMetadata } from './skill';

/** 平台事件压缩后的Skill选择上下文。 */
export interface SkillSelectionContext {
  readonly platform: string;
  readonly conversationType: string;
  readonly messageText: string;
  readonly mentionsAgent: boolean;
  readonly receivedAt: Date;
}

/** 根据运行上下文决定本轮可见Skill的能力。 */
export interface SkillSelection<TInput = SkillSelectionContext> {
  selectSkills(input: TInput, skills: readonly SkillMetadata[]): Promise<SkillMetadata[]>;
}

/** 默认最大可见Skill数。 */
export const DEFAULT_VISIBLE_SKILL_LIMIT = 8;

/** 默认将有限的Skill目录交给模型自主选择。 */
export class SkillSelector implements SkillSelection {
  constructor(private readonly visibleSkillLimit = DEFAULT_VISIBLE_SKILL_LIMIT) {}

  /** 返回本轮可见的Skill元信息。 */
  async selectSkills(
    _input: SkillSelectionContext,
    skills: readonly SkillMetadata[],
  ): Promise<SkillMetadata[]> {
    return skills.slice(0, this.visibleSkillLimit);
  }
}
