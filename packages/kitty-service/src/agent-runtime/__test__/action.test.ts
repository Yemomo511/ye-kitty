import { describe, expect, test } from 'vitest';
import { normalizeAgentAction } from '../action';

describe('AgentAction 兼容解析', () => {
  test('保留新的 FinishAction', () => {
    expect(
      normalizeAgentAction({
        type: 'finish',
        result: 'reply',
        output: { text: '你好' },
        reason: '回应用户',
      }),
    ).toEqual({
      type: 'finish',
      result: 'reply',
      output: { text: '你好' },
      reason: '回应用户',
    });
  });

  test('将旧回复决策转换为 FinishAction', () => {
    expect(
      normalizeAgentAction({
        type: 'reply',
        text: '你好',
        actions: [{ type: 'face' }],
        reason: '回应',
      }),
    ).toEqual({
      type: 'finish',
      result: 'reply',
      output: { text: '你好', actions: [{ type: 'face' }] },
      reason: '回应',
    });
  });

  test.each([
    [{ type: 'ignore', reason: '无需回应' }, 'ignore'],
    [{ type: 'human_review', reason: '需要审核' }, 'review'],
  ] as const)('转换旧终止决策 %#', (input, result) => {
    expect(normalizeAgentAction(input)).toEqual({
      type: 'finish',
      result,
      reason: input.reason,
    });
  });

  test('将旧工具调用转换为 ToolAction', () => {
    expect(
      normalizeAgentAction(
        { type: 'tool_call', toolName: 'get_recent_messages', input: {}, reason: '读取上下文' },
        { createCallId: () => 'call-1' },
      ),
    ).toEqual({
      type: 'tool',
      callId: 'call-1',
      name: 'get_recent_messages',
      input: {},
      reason: '读取上下文',
    });
  });

  test('将 Skill 正文和引用调用统一为 skill Tool', () => {
    expect(
      normalizeAgentAction(
        { type: 'skill_call', skillName: 'qq-chat', input: { topic: '问候' }, reason: '读取方法' },
        { createCallId: () => 'call-skill' },
      ),
    ).toEqual({
      type: 'tool',
      callId: 'call-skill',
      name: 'skill',
      input: { name: 'qq-chat', input: { topic: '问候' } },
      reason: '读取方法',
    });

    expect(
      normalizeAgentAction(
        {
          type: 'skill_reference_call',
          skillName: 'qq-chat',
          referencePath: 'references/send.md',
          reason: '读取引用',
        },
        { createCallId: () => 'call-reference' },
      ),
    ).toEqual({
      type: 'tool',
      callId: 'call-reference',
      name: 'skill',
      input: { name: 'qq-chat', reference: 'references/send.md' },
      reason: '读取引用',
    });
  });

  test('拒绝缺少必要字段的动作', () => {
    expect(() => normalizeAgentAction({ type: 'tool', name: '' })).toThrow(
      'Agent Action 不符合协议',
    );
  });
});
