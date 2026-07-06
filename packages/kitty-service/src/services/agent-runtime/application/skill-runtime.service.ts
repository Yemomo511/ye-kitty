import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SkillContent, SkillMetadata } from '../domain/skill';
import type { SkillContentLoaderPort } from '../ports/skill-content-loader.port';
import type { SkillSelectorPort } from '../ports/skill-selector.port';

/**
 * Skill运行服务
 *
 * 持有启动期缓存的 Skill 元信息，并在消息处理时选择和渐进加载正文。
 */
export class SkillRuntimeService {
  constructor(
    private readonly metadataList: readonly SkillMetadata[],
    private readonly selector: SkillSelectorPort<ChatEventContract>,
    private readonly contentLoader: SkillContentLoaderPort,
  ) {}

  /**
   * 为QQ消息选择可用Skill
   * @param event QQ标准消息
   * @returns 本轮可用Skill元信息
   */
  async selectSkillsForQqReply(event: ChatEventContract): Promise<SkillMetadata[]> {
    return await this.selector.selectSkills(event, this.metadataList);
  }

  /**
   * 按需加载Skill正文
   * @param skillName Skill名称
   * @returns Skill正文
   */
  async loadSkillContent(skillName: string): Promise<SkillContent> {
    return await this.contentLoader.loadSkillContent(skillName);
  }
}
