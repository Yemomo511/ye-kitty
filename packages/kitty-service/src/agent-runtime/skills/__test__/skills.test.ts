import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SkillCatalog, SkillLoader, SkillReferenceLoader, SkillRuntime, SkillSelector } from '..';

describe('Skill文件系统资产', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
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

    const metadataList = await new SkillCatalog(skillsRoot).listSkillMetadata();

    expect(metadataList).toEqual([
      {
        name: 'qq-chat',
        description: '用于 QQ 群聊和私聊中的自然中文回复。',
        allowedTools: undefined,
        metadata: undefined,
        rootPath: join(skillsRoot, 'qq-chat'),
      },
    ]);
  });

  test('解析allowed-tools和metadata扩展字段', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await writeSkillFile(skillsRoot, 'qq-chat', [
      '---',
      'name: qq-chat',
      'description: QQ回复',
      'allowed-tools: get_recent_messages search_memory',
      'metadata:',
      '  ye-kitty.version: "1"',
      "  ye-kitty.platforms: 'qq'",
      '---',
      '',
      '# QQ中文聊天',
    ]);

    const metadataList = await new SkillCatalog(skillsRoot).listSkillMetadata();
    const content = await new SkillLoader(metadataList).loadSkillContent('qq-chat');

    expect(metadataList[0]).toMatchObject({
      allowedTools: ['get_recent_messages', 'search_memory'],
      metadata: {
        'ye-kitty.version': '1',
        'ye-kitty.platforms': 'qq',
      },
    });
    expect(content.metadata.allowedTools).toEqual(['get_recent_messages', 'search_memory']);
    expect(content.metadata.metadata).toEqual({
      'ye-kitty.version': '1',
      'ye-kitty.platforms': 'qq',
    });
  });

  test('按Skill名称渐进读取Markdown正文', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
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
    const metadataList = await new SkillCatalog(skillsRoot).listSkillMetadata();
    const content = await new SkillLoader(metadataList).loadSkillContent('qq-chat');

    expect(content.metadata.name).toBe('qq-chat');
    expect(content.body).toContain('使用中文自然回复。');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AgentRuntime-Skill] 已读取Skill正文 name=qq-chat'),
    );
  });

  test('缺少SKILL.md时抛出清晰错误', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await mkdir(join(skillsRoot, 'broken'), { recursive: true });

    await expect(new SkillCatalog(skillsRoot).listSkillMetadata()).rejects.toThrow(/SKILL\.md/);
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

    await expect(new SkillCatalog(skillsRoot).listSkillMetadata()).rejects.toThrow('缺少name');
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

    await expect(new SkillCatalog(skillsRoot).listSkillMetadata()).rejects.toThrow(
      '缺少description',
    );
  });

  test('默认Skill选择器返回平台无关Skill目录', async () => {
    const selector = new SkillSelector();
    const skills = await selector.selectSkills(
      {
        platform: 'qq',
        conversationType: 'group',
        messageText: '你好',
        mentionsAgent: false,
        receivedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
      [
        {
          name: 'chat-style',
          description: '聊天风格',
          rootPath: '/tmp/skills/chat-style',
          allowedTools: ['get_recent_messages'],
        },
      ],
    );

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('chat-style');
  });

  test('读取已启用Skill的references文件', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const skillsRoot = await createTempSkillsRoot();
    await writeSkillFile(skillsRoot, 'chat-style', [
      '---',
      'name: chat-style',
      'description: 聊天风格',
      '---',
      '',
      '# 聊天风格',
    ]);
    await mkdir(join(skillsRoot, 'chat-style', 'references'), { recursive: true });
    await writeFile(
      join(skillsRoot, 'chat-style', 'references', 'examples.md'),
      '示例：短句回复。',
      'utf8',
    );
    const metadataList = await new SkillCatalog(skillsRoot).listSkillMetadata();
    const skill = await new SkillLoader(metadataList).loadSkillContent('chat-style');

    const reference = await new SkillReferenceLoader().loadSkillReference(skill, 'examples.md');

    expect(reference).toMatchObject({
      referencePath: 'examples.md',
      content: '示例：短句回复。',
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AgentRuntime-Skill] 已读取Skill引用'),
    );
  });

  test('拒绝references路径逃逸和非白名单扩展', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await writeSkillFile(skillsRoot, 'chat-style', [
      '---',
      'name: chat-style',
      'description: 聊天风格',
      '---',
      '',
      '# 聊天风格',
    ]);
    await mkdir(join(skillsRoot, 'chat-style', 'references'), { recursive: true });
    await writeFile(join(skillsRoot, 'secret.md'), '密文', 'utf8');
    await writeFile(join(skillsRoot, 'chat-style', 'references', 'script.ts'), '代码', 'utf8');
    const metadataList = await new SkillCatalog(skillsRoot).listSkillMetadata();
    const skill = await new SkillLoader(metadataList).loadSkillContent('chat-style');
    const loader = new SkillReferenceLoader();

    await expect(loader.loadSkillReference(skill, '../secret.md')).rejects.toThrow('上级目录');
    await expect(loader.loadSkillReference(skill, 'script.ts')).rejects.toThrow('扩展名不允许');
  });

  test('拒绝软链和超大references文件', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await writeSkillFile(skillsRoot, 'chat-style', [
      '---',
      'name: chat-style',
      'description: 聊天风格',
      '---',
      '',
      '# 聊天风格',
    ]);
    await mkdir(join(skillsRoot, 'chat-style', 'references'), { recursive: true });
    await writeFile(join(skillsRoot, 'outside.md'), '外部内容', 'utf8');
    await symlink(
      join(skillsRoot, 'outside.md'),
      join(skillsRoot, 'chat-style', 'references', 'link.md'),
    );
    await writeFile(
      join(skillsRoot, 'chat-style', 'references', 'large.md'),
      'x'.repeat(8),
      'utf8',
    );
    const metadataList = await new SkillCatalog(skillsRoot).listSkillMetadata();
    const skill = await new SkillLoader(metadataList).loadSkillContent('chat-style');

    await expect(new SkillReferenceLoader().loadSkillReference(skill, 'link.md')).rejects.toThrow(
      '软链接',
    );
    await expect(
      new SkillReferenceLoader({
        maxChars: 4,
        maxReferencesPerRun: 3,
      }).loadSkillReference(skill, 'large.md'),
    ).rejects.toThrow('大小限制');
  });

  test('运行时统一选择并渐进读取Skill', async () => {
    const skillsRoot = await createTempSkillsRoot();
    await writeSkillFile(skillsRoot, 'chat-style', [
      '---',
      'name: chat-style',
      'description: 聊天风格',
      '---',
      '',
      '# 聊天风格',
    ]);
    const metadataList = await new SkillCatalog(skillsRoot).listSkillMetadata();
    const runtime = new SkillRuntime(
      metadataList,
      new SkillSelector(),
      new SkillLoader(metadataList),
      new SkillReferenceLoader(),
    );

    const selected = await runtime.selectSkills({
      platform: 'qq',
      conversationType: 'group',
      messageText: '你好',
      mentionsAgent: false,
      receivedAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    const content = await runtime.load('chat-style');

    expect(selected.map((skill) => skill.name)).toEqual(['chat-style']);
    expect(content.body).toContain('# 聊天风格');
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
