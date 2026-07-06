import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';
import { FilesystemSkillMarket } from '../infrastructure/skill-market/filesystem-skill-market';
import { MarkdownSkillContentLoader } from '../infrastructure/skill-market/markdown-skill-content-loader';

describe('Skill文件系统资产', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    for (const directory of tempDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('扫描SKILL.md并读取name、description和rootPath', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await writeSkillFile(skillsRoot, 'qq-chat', [
      '---',
      'name: qq-chat',
      'description: 用于 QQ 群聊和私聊中的自然中文回复。',
      '---',
      '',
      '# QQ中文聊天',
    ]);

    const metadataList = await new FilesystemSkillMarket(skillsRoot).listSkillMetadata();

    expect(metadataList).toEqual([
      {
        name: 'qq-chat',
        description: '用于 QQ 群聊和私聊中的自然中文回复。',
        rootPath: join(skillsRoot, 'qq-chat'),
      },
    ]);
  });

  test('按Skill名称渐进读取Markdown正文', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await writeSkillFile(skillsRoot, 'qq-chat', [
      '---',
      'name: qq-chat',
      'description: QQ回复',
      '---',
      '',
      '# QQ中文聊天',
      '',
      '使用中文自然回复。',
    ]);
    const metadataList = await new FilesystemSkillMarket(skillsRoot).listSkillMetadata();
    const content = await new MarkdownSkillContentLoader(metadataList).loadSkillContent('qq-chat');

    expect(content.metadata.name).toBe('qq-chat');
    expect(content.body).toContain('使用中文自然回复。');
  });

  test('缺少SKILL.md时抛出清晰错误', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await mkdir(join(skillsRoot, 'broken'), { recursive: true });

    await expect(new FilesystemSkillMarket(skillsRoot).listSkillMetadata()).rejects.toThrow(
      /SKILL\.md/,
    );
  });

  test('缺少name或description时抛出清晰错误', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await writeSkillFile(skillsRoot, 'missing-name', [
      '---',
      'description: 缺少名称',
      '---',
      '',
      '# 缺少名称',
    ]);

    await expect(new FilesystemSkillMarket(skillsRoot).listSkillMetadata()).rejects.toThrow(
      '缺少name',
    );
  });

  test('缺少description时抛出清晰错误', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await writeSkillFile(skillsRoot, 'missing-description', [
      '---',
      'name: missing-description',
      '---',
      '',
      '# 缺少描述',
    ]);

    await expect(new FilesystemSkillMarket(skillsRoot).listSkillMetadata()).rejects.toThrow(
      '缺少description',
    );
  });

  async function createTempSkillsRoot(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'ye-kitty-skills-'));
    tempDirectories.push(directory);
    return directory;
  }
});

async function writeSkillFile(
  skillsRoot: string,
  skillName: string,
  lines: readonly string[],
): Promise<void> {
  const skillRoot = join(skillsRoot, skillName);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(join(skillRoot, 'SKILL.md'), lines.join('\n'), 'utf8');
}
