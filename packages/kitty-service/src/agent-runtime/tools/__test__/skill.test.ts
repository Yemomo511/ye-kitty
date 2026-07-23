import { describe, expect, test, vi } from 'vitest';
import type { SkillContent, SkillMetadata, SkillReferenceContent } from '../../skills';
import { createSkillTool } from '../skill';
import { Tool } from '../tool';
import { createToolTestContext } from './runtime-context';

const metadata: SkillMetadata = {
  name: 'chat-style',
  description: '聊天风格',
  rootPath: '/tmp/skills/chat-style',
};
const content: SkillContent = { metadata, body: '使用短句回复。' };

describe('Skill Tool', () => {
  test('只能从本轮可见目录启用正文并返回受控Effect', async () => {
    const load = vi.fn(async () => content);
    const effects: unknown[] = [];
    const state = createState();
    const tool = createSkillTool({ load, loadReference: vi.fn() }, state);

    const settlement = await Tool.settle(
      'skill',
      tool,
      { name: 'chat-style' },
      createToolTestContext({
        applyEffects: (items) => {
          effects.push(...items);
        },
      }),
    );

    expect(settlement.status).toBe('success');
    expect(effects).toEqual([{ type: 'enable_skill', skill: content }]);
    expect(load).toHaveBeenCalledWith('chat-style');
  });

  test('拒绝读取未暴露Skill', async () => {
    const load = vi.fn();
    const tool = createSkillTool(
      { load, loadReference: vi.fn() },
      createState({ availableSkills: [] }),
    );

    const settlement = await Tool.settle(
      'skill',
      tool,
      { name: 'hidden' },
      createToolTestContext(),
    );

    expect(settlement.status).toBe('error');
    expect(settlement.output?.error).toBe('Skill本轮不可用');
    expect(load).not.toHaveBeenCalled();
  });

  test('只允许从已启用Skill读取引用', async () => {
    const reference: SkillReferenceContent = {
      skill: metadata,
      referencePath: 'examples.md',
      absolutePath: '/tmp/skills/chat-style/references/examples.md',
      content: '示例',
    };
    const loadReference = vi.fn(async () => reference);
    const effects: unknown[] = [];
    const tool = createSkillTool(
      { load: vi.fn(), loadReference },
      createState({ enabledSkills: [content] }),
    );

    const settlement = await Tool.settle(
      'skill',
      tool,
      { name: 'chat-style', reference: 'examples.md' },
      createToolTestContext({
        applyEffects: (items) => {
          effects.push(...items);
        },
      }),
    );

    expect(settlement.status).toBe('success');
    expect(effects).toEqual([{ type: 'load_skill_reference', reference }]);
  });
});

function createState(
  overrides: Partial<{
    availableSkills: readonly SkillMetadata[];
    enabledSkills: readonly SkillContent[];
    loadedReferences: readonly SkillReferenceContent[];
    maxReferences: number;
  }> = {},
) {
  return {
    availableSkills: [metadata],
    enabledSkills: [],
    loadedReferences: [],
    maxReferences: 3,
    ...overrides,
  };
}
