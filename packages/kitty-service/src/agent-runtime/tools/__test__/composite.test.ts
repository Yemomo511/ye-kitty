import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { mergeToolSources, type ToolSource } from '../composite';
import { Tool } from '../tool';

describe('Tool来源合并', () => {
  test('合并不同来源的规范Tool', () => {
    const merged = mergeToolSources([createSource('builtin_read'), createSource('docs_search')]);

    expect(Object.keys(merged)).toEqual(['builtin_read', 'docs_search']);
    expect(Tool.is(merged.docs_search)).toBe(true);
  });

  test('名称冲突和伪造Tool均拒绝启动', () => {
    expect(() => mergeToolSources([createSource('same'), createSource('same')])).toThrow(
      '名称冲突',
    );
    expect(() => mergeToolSources([{ listTools: () => ({ fake: {} as never }) }])).toThrow(
      '不是规范Tool',
    );
  });
});

function createSource(name: string): ToolSource {
  return {
    listTools: () => ({
      [name]: Tool.make({
        description: `${name}说明`,
        parameters: z.object({}).strict(),
        policy: {
          source: 'builtin',
          risk: 'low',
          approval: 'never',
          timeoutMs: 1000,
        },
        execute: async () => ({ success: true, summary: '完成' }),
      }),
    }),
  };
}
