import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillMetadata } from '../../domain/skill';
import type { SkillMarketPort } from '../../ports/skill-market.port';
import { parseSkillMarkdown } from './skill-frontmatter.parser';

/**
 * 文件系统Skill市场
 *
 * 从项目根目录 skills/<name>/SKILL.md 扫描 Skill 元信息。
 * 启动期只读取 frontmatter，正文交给渐进加载器按需读取。
 */
export class FilesystemSkillMarket implements SkillMarketPort {
  constructor(private readonly skillsRoot: string) {}

  /**
   * 扫描Skill元信息
   * @returns Skill元信息列表
   */
  async listSkillMetadata(): Promise<SkillMetadata[]> {
    const entries = await readdir(this.skillsRoot, { withFileTypes: true });
    const metadataList: SkillMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const rootPath = join(this.skillsRoot, entry.name);
      const skillPath = join(rootPath, 'SKILL.md');
      const content = await readFile(skillPath, 'utf8');
      const parsedSkill = parseSkillMarkdown(content, skillPath);

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
