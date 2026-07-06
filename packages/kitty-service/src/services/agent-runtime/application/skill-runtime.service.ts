import type { SkillContent, SkillMetadata } from '../domain/skill';
import type { SkillReferenceContent } from '../domain/skill-reference';
import type { SkillSelectionContext } from '../domain/skill-selection-context';
import type { SkillContentLoaderPort } from '../ports/skill-content-loader.port';
import type { SkillReferenceLoaderPort } from '../ports/skill-reference-loader.port';
import type { SkillSelectorPort } from '../ports/skill-selector.port';

/**
 * Skill运行服务
 *
 * 持有启动期缓存的 Skill 元信息，并在消息处理时选择和渐进加载正文。
 */
export class SkillRuntimeService {
  constructor(
    private readonly metadataList: readonly SkillMetadata[],
    private readonly selector: SkillSelectorPort<SkillSelectionContext>,
    private readonly contentLoader: SkillContentLoaderPort,
    private readonly referenceLoader?: SkillReferenceLoaderPort,
  ) {}

  /**
   * 为单次运行选择可见Skill
   * @param context 选择上下文
   * @returns 本轮可用Skill元信息
   */
  async selectSkillsForRun(context: SkillSelectionContext): Promise<SkillMetadata[]> {
    return await this.selector.selectSkills(context, this.metadataList);
  }

  /**
   * 按需加载Skill正文
   * @param skillName Skill名称
   * @returns Skill正文
   */
  async loadSkillContent(skillName: string): Promise<SkillContent> {
    return await this.contentLoader.loadSkillContent(skillName);
  }

  /**
   * 按需加载Skill引用
   * @param skill 已启用Skill
   * @param referencePath 引用路径
   * @returns 引用正文
   */
  async loadSkillReference(
    skill: SkillContent,
    referencePath: string,
  ): Promise<SkillReferenceContent> {
    if (!this.referenceLoader) throw new Error('Skill引用加载器未配置');
    return await this.referenceLoader.loadSkillReference(skill, referencePath);
  }
}
