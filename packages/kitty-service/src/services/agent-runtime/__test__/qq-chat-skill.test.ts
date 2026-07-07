import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { FilesystemSkillReferenceLoader } from '../infrastructure/skill-market/filesystem-skill-reference-loader';
import type { SkillContent } from '../domain/skill';

const qqChatSkillRoot = join(process.cwd(), '..', '..', 'skills', 'qq-chat');

describe('qq-chat Skill动作协议', () => {
  test('主文档只提供动作摘要并指向references', () => {
    const content = readFileSync(join(qqChatSkillRoot, 'SKILL.md'), 'utf8');

    expect(content).toContain('references/qq-action-json.md');
    expect(content).toContain('references/qq-action-style.md');
    expect(content).toContain('send_text');
    expect(content).toContain('send_text_with_face');
    expect(content).toContain('react_to_message');
    expect(content).toContain('当准备戳一戳时');
    expect(content).not.toContain('send_face` 是 QQ 商城表情');
    expect(content).not.toContain('group_poke');
    expect(content).not.toContain('send_group_msg');
  });

  test('动作协议references可以被渐进式读取', async () => {
    const skill: SkillContent = {
      metadata: {
        name: 'qq-chat',
        description: '用于 QQ 群聊和私聊中的自然中文回复。',
        rootPath: qqChatSkillRoot,
      },
      body: 'QQ聊天正文',
    };
    const loader = new FilesystemSkillReferenceLoader();

    expect(existsSync(join(qqChatSkillRoot, 'references', 'qq-action-json.md'))).toBe(true);
    expect(existsSync(join(qqChatSkillRoot, 'references', 'qq-action-style.md'))).toBe(true);

    const jsonReference = await loader.loadSkillReference(skill, 'qq-action-json.md');
    const styleReference = await loader.loadSkillReference(skill, 'qq-action-style.md');

    expect(jsonReference.content).toContain('poke_sender');
    expect(jsonReference.content).toContain('send_text_with_face');
    expect(jsonReference.content).toContain('戳一戳时不要填写外层 `text`');
    expect(jsonReference.content).toContain('不能指定其他用户');
    expect(styleReference.content).toContain('避免打断多人对话');
    expect(styleReference.content).toContain('文字和 QQ 内置表情出现在同一条消息');
    expect(styleReference.content).not.toContain('reply_to_message');
  });
});
