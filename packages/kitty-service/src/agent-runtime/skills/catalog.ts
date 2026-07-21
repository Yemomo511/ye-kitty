import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSkillMarkdown } from './parser';
import type { SkillMetadata } from './skill';

/** 提供Skill元信息列表的能力。 */
export interface SkillMetadataSource {
  listSkillMetadata(): Promise<SkillMetadata[]>;
}

/** 从本地skills目录发现Skill，只在启动期读取frontmatter。 */
export class SkillCatalog implements SkillMetadataSource {
  constructor(private readonly skillsRoot: string) {}

  /** 扫描Skill目录并返回稳定排序的元信息。 */
  async listSkillMetadata(): Promise<SkillMetadata[]> {
    const entries = await readdir(this.skillsRoot, { withFileTypes: true });
    const metadataList: SkillMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const rootPath = join(this.skillsRoot, entry.name);
      const skillPath = join(rootPath, 'SKILL.md');
      const parsedSkill = parseSkillMarkdown(await readFile(skillPath, 'utf8'), skillPath);
      metadataList.push({
        name: parsedSkill.name,
        description: parsedSkill.description,
        allowedTools: parsedSkill.allowedTools,
        metadata: parsedSkill.metadata,
        rootPath,
      });
    }

    return metadataList.sort((left, right) => left.name.localeCompare(right.name));
  }
}
