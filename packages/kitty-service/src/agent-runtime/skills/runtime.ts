import type { SkillContentReader } from './loader';
import type { SkillReferenceContent, SkillReferenceReader } from './reference';
import type { SkillContent, SkillMetadata } from './skill';
import type { SkillSelection, SkillSelectionContext } from './selector';

/** 组织Skill选择、正文读取和引用读取的渐进式入口。 */
export class SkillRuntime {
  constructor(
    private readonly metadataList: readonly SkillMetadata[],
    private readonly selector: SkillSelection,
    private readonly contentReader: SkillContentReader,
    private readonly referenceReader?: SkillReferenceReader,
  ) {}

  /** 选择本轮可以暴露给Agent的Skill目录。 */
  async selectSkills(context: SkillSelectionContext): Promise<SkillMetadata[]> {
    return await this.selector.selectSkills(context, this.metadataList);
  }

  /** 按需启用并读取一个Skill。 */
  async load(skillName: string): Promise<SkillContent> {
    return await this.contentReader.loadSkillContent(skillName);
  }

  /** 从已启用Skill中按需读取引用。 */
  async loadReference(skill: SkillContent, referencePath: string): Promise<SkillReferenceContent> {
    if (!this.referenceReader) throw new Error('Skill引用读取器未配置');
    return await this.referenceReader.loadSkillReference(skill, referencePath);
  }
}
