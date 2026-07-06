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
   * 为QQ消息加载本轮Skill
   * @param event QQ标准消息
   * @returns 本轮Skill正文
   */
  async loadSkillsForQqReply(event: ChatEventContract): Promise<SkillContent[]> {
    const selectedSkills = await this.selector.selectSkills(event, this.metadataList);
    const contents: SkillContent[] = [];

    for (const skill of selectedSkills) {
      try {
        contents.push(await this.contentLoader.loadSkillContent(skill.name));
      } catch (error) {
        console.warn(
          `⚠️ [AgentRuntime-SkillRuntime] Skill加载失败，已跳过该Skill name=${skill.name} reason=${formatError(error)}`,
        );
      }
    }

    return contents;
  }
}

// 提取错误原因，避免日志输出完整异常对象。
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
