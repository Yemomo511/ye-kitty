import { describe, expect, test, vi } from 'vitest';
import type { SkillContent, SkillMetadata } from '../skills';
import type { ToolContext } from './tool';
import { SkillTool } from './skill';

const metadata: SkillMetadata = {
  name: 'chat-style',
  description: '聊天风格',
  rootPath: '/tmp/skills/chat-style',
};

const content: SkillContent = {
  metadata,
  body: '使用短句回复。',
};

describe('Skill Tool', () => {
  test('只能从本轮可见目录渐进读取正文', async () => {
    const load = vi.fn(async () => content);
    const tool = new SkillTool({
      load,
      loadReference: vi.fn(),
    });

    const result = await tool.execute({ name: 'chat-style' }, createContext());

    expect(result).toEqual({
      success: true,
      summary: '已启用Skill chat-style。',
      data: { contextMessages: [{ type: 'skill_content', skill: content }] },
    });
    expect(load).toHaveBeenCalledWith('chat-style');
  });

  test('拒绝读取未暴露给本轮Agent的Skill', async () => {
    const load = vi.fn();
    const tool = new SkillTool({
      load,
      loadReference: vi.fn(),
    });

    const result = await tool.execute(
      { name: 'hidden-skill' },
      createContext({ availableSkills: [] }),
    );

    expect(result).toMatchObject({ success: false, error: 'Skill本轮不可用' });
    expect(load).not.toHaveBeenCalled();
  });

  test('只能从已启用Skill读取引用', async () => {
    const reference = {
      skill: metadata,
      referencePath: 'examples.md',
      absolutePath: '/tmp/skills/chat-style/references/examples.md',
      content: '示例',
    };
    const loadReference = vi.fn(async () => reference);
    const tool = new SkillTool({
      load: vi.fn(),
      loadReference,
    });

    const result = await tool.execute(
      { name: 'chat-style', reference: 'examples.md' },
      createContext({ enabledSkills: [content] }),
    );

    expect(result).toEqual({
      success: true,
      summary: '已读取Skill chat-style引用 examples.md。',
      data: { contextMessages: [{ type: 'skill_reference', reference }] },
    });
    expect(loadReference).toHaveBeenCalledWith(content, 'examples.md');
  });

  test('未启用Skill时拒绝读取引用', async () => {
    const loadReference = vi.fn();
    const tool = new SkillTool({
      load: vi.fn(),
      loadReference,
    });

    const result = await tool.execute(
      { name: 'chat-style', reference: 'examples.md' },
      createContext({ enabledSkills: [] }),
    );

    expect(result).toMatchObject({ success: false, error: 'Skill尚未启用' });
    expect(loadReference).not.toHaveBeenCalled();
  });
});

function createContext(input: Partial<ToolContext> = {}): ToolContext {
  return {
    callId: 'call-skill',
    availableSkills: [metadata],
    enabledSkills: [],
    ...input,
  };
}
