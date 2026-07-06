import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillContent, SkillMetadata } from '../../domain/skill';
import type { SkillContentLoaderPort } from '../../ports/skill-content-loader.port';
import { parseSkillMarkdown } from './skill-frontmatter.parser';

/**
 * Markdown Skill内容加载器
 *
 * 根据启动期缓存的 rootPath 按需读取 SKILL.md 正文。
 */
export class MarkdownSkillContentLoader implements SkillContentLoaderPort {
  constructor(private readonly metadataList: readonly SkillMetadata[]) {}

  /**
   * 按名称加载Skill正文
   * @param skillName Skill名称
   * @returns Skill正文内容
   */
  async loadSkillContent(skillName: string): Promise<SkillContent> {
    const metadata = this.metadataList.find((skill) => skill.name === skillName);
    if (!metadata) throw new Error(`未找到Skill元信息: ${skillName}`);

    const skillPath = join(metadata.rootPath, 'SKILL.md');
    const content = await readFile(skillPath, 'utf8');
    const parsedSkill = parseSkillMarkdown(content, skillPath);
    console.info(
      `✅ [AgentRuntime-SkillContentLoader] 已读取Skill正文 name=${metadata.name} bodyLength=${parsedSkill.body.length}`,
    );

    return {
      metadata: {
        ...metadata,
        description: parsedSkill.description,
        allowedTools: parsedSkill.allowedTools ?? metadata.allowedTools,
        metadata: parsedSkill.metadata ?? metadata.metadata,
      },
      body: parsedSkill.body,
    };
  }
}
