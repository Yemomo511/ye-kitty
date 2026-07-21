import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { SkillReferenceLoader } from '../reference';
import type { SkillContent } from '../skill';

const qqChatSkillRoot = join(process.cwd(), '..', '..', 'skills', 'qq-chat');

describe('qq-chat Skill动作协议', () => {
  test('主文档只提供动作摘要并指向references', () => {
    const content = readFileSync(join(qqChatSkillRoot, 'SKILL.md'), 'utf8');

    expect(content).toContain('references/qq-action-json.md');
    expect(content).toContain('references/qq-action-style.md');
    expect(content).toContain('send_msg');
    expect(content).toContain('message');
    expect(content).toContain('react_to_message');
    expect(content).toContain('当准备戳一戳时');
    expect(content).toContain('自定义表情单独发送，不携带 @/reply 上下文');
    expect(content).toContain('不要手写 `reply` 段');
    expect(content).not.toContain('group_poke');
    expect(content).toContain('不要输出 `send_group_msg`');
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
    const loader = new SkillReferenceLoader();

    expect(existsSync(join(qqChatSkillRoot, 'references', 'qq-action-json.md'))).toBe(true);
    expect(existsSync(join(qqChatSkillRoot, 'references', 'qq-action-style.md'))).toBe(true);

    const jsonReference = await loader.loadSkillReference(skill, 'qq-action-json.md');
    const styleReference = await loader.loadSkillReference(skill, 'qq-action-style.md');

    expect(jsonReference.content).toContain('poke_sender');
    expect(jsonReference.content).toContain('send_msg');
    expect(jsonReference.content).toContain('OneBot 11 消息混合类型');
    expect(jsonReference.content).toContain('戳一戳时不要填写外层 `text`');
    expect(jsonReference.content).toContain('Agent 不能指定任意群号');
    expect(jsonReference.content).toContain('自定义表情使用 `image` 段单独发送');
    expect(jsonReference.content).toContain('当前实现不接受模型手写 `reply`');
    expect(styleReference.content).toContain('避免打断多人对话');
    expect(styleReference.content).toContain('放在同一个 `message` 数组里');
    expect(styleReference.content).toContain('自定义表情单独发送，不携带 @/reply 上下文');
    expect(styleReference.content).not.toContain('reply_to_message');
  });
});
