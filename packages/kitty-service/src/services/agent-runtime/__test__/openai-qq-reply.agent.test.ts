import { describe, expect, test } from 'vitest';
import { parseAgentDecision } from '../infrastructure/openai-harness-agent-runner';
import { parseQqReplyAgentResult } from '../infrastructure/openai-qq-reply.agent';

describe('parseQqReplyAgentResult', () => {
  test('纯文本输出兼容旧回复格式', () => {
    expect(parseQqReplyAgentResult('你好，我在')).toEqual({ text: '你好，我在' });
  });

  test('JSON输出解析为受控动作', () => {
    const result = parseQqReplyAgentResult(
      JSON.stringify({
        text: '先回复一句',
        actions: [
          { type: 'send_face', faceId: '66' },
          { type: 'send_custom_image', file: 'https://example.com/cat.png' },
          { type: 'poke_sender' },
          { type: 'react_to_message', emojiId: '128512' },
          { type: 'reply_to_message', text: '引用回复' },
          { type: 'mention_sender', text: '我在' },
          { type: 'send_text_with_face', text: '配个表情', faceId: '14' },
          { type: 'send_text_with_image', text: '配张图', file: 'https://example.com/cat.png' },
        ],
      }),
    );

    expect(result).toEqual({
      text: '先回复一句',
      actions: [
        { type: 'send_face', faceId: '66' },
        { type: 'send_custom_image', file: 'https://example.com/cat.png' },
        { type: 'poke_sender' },
        { type: 'react_to_message', emojiId: '128512' },
        { type: 'reply_to_message', text: '引用回复' },
        { type: 'mention_sender', text: '我在' },
        { type: 'send_text_with_face', text: '配个表情', faceId: '14' },
        { type: 'send_text_with_image', text: '配张图', file: 'https://example.com/cat.png' },
      ],
    });
  });

  test('未知动作会被过滤', () => {
    const result = parseQqReplyAgentResult(
      JSON.stringify({
        actions: [
          { type: 'set_group_kick', userId: '20000' },
          { type: 'send_text', text: '安全回复' },
          { type: 'reply_to_message', text: '   ' },
          { type: 'send_text_with_face', text: '缺少表情' },
          { type: 'send_text_with_image', text: '非法图片', file: '\n' },
        ],
      }),
    );

    expect(result).toEqual({
      actions: [{ type: 'send_text', text: '安全回复' }],
    });
  });
});

describe('parseAgentDecision', () => {
  test('解析工具调用决策', () => {
    expect(
      parseAgentDecision(
        JSON.stringify({
          type: 'tool_call',
          toolName: 'get_recent_messages',
          input: { limit: 3 },
          reason: '需要上下文',
        }),
      ),
    ).toEqual({
      type: 'tool_call',
      toolName: 'get_recent_messages',
      input: { limit: 3 },
      reason: '需要上下文',
    });
  });

  test('解析Skill调用决策', () => {
    expect(
      parseAgentDecision(
        JSON.stringify({
          type: 'skill_call',
          skillName: 'qq-chat',
          input: { goal: '判断是否需要参与群聊' },
          reason: '需要群聊方法论',
        }),
      ),
    ).toEqual({
      type: 'skill_call',
      skillName: 'qq-chat',
      input: { goal: '判断是否需要参与群聊' },
      reason: '需要群聊方法论',
    });
  });

  test('解析Skill引用调用决策', () => {
    expect(
      parseAgentDecision(
        JSON.stringify({
          type: 'skill_reference_call',
          skillName: 'chat-style',
          referencePath: 'examples.md',
          reason: '需要读取示例',
        }),
      ),
    ).toEqual({
      type: 'skill_reference_call',
      skillName: 'chat-style',
      referencePath: 'examples.md',
      reason: '需要读取示例',
    });
  });

  test('过滤回复决策中的未知动作', () => {
    expect(
      parseAgentDecision(
        JSON.stringify({
          type: 'reply',
          text: '安全回复',
          actions: [
            { type: 'set_group_kick' },
            { type: 'poke_sender' },
            { type: 'reply_to_message', text: '收到' },
            { type: 'mention_sender', text: '看这里' },
          ],
          reason: '可以回复',
        }),
      ),
    ).toEqual({
      type: 'reply',
      text: '安全回复',
      actions: [
        { type: 'poke_sender' },
        { type: 'reply_to_message', text: '收到' },
        { type: 'mention_sender', text: '看这里' },
      ],
      reason: '可以回复',
    });
  });

  test('非法决策抛出错误', () => {
    expect(() => parseAgentDecision('不是JSON')).toThrow();
  });
});
