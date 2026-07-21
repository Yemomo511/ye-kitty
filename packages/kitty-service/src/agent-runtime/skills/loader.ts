import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkillMarkdown } from './parser';
import type { SkillContent, SkillMetadata } from './skill';

/** 按需读取Skill正文的能力。 */
export interface SkillContentReader {
  loadSkillContent(skillName: string): Promise<SkillContent>;
}

/** 根据启动期缓存的元信息渐进读取SKILL.md正文。 */
export class SkillLoader implements SkillContentReader {
  constructor(private readonly metadataList: readonly SkillMetadata[]) {}

  /** 按名称读取Skill正文。 */
  async loadSkillContent(skillName: string): Promise<SkillContent> {
    const metadata = this.metadataList.find((skill) => skill.name === skillName);
    if (!metadata) throw new Error(`未找到Skill元信息: ${skillName}`);

    const skillPath = join(metadata.rootPath, 'SKILL.md');
    const parsedSkill = parseSkillMarkdown(await readFile(skillPath, 'utf8'), skillPath);
    console.info(
      `✅ [AgentRuntime-Skill] 已读取Skill正文 name=${metadata.name} bodyLength=${parsedSkill.body.length}`,
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
