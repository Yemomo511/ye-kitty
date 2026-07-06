import { describe, expect, test } from 'vitest';
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
      ],
    });
  });

  test('未知动作会被过滤', () => {
    const result = parseQqReplyAgentResult(
      JSON.stringify({
        actions: [
          { type: 'set_group_kick', userId: '20000' },
          { type: 'send_text', text: '安全回复' },
        ],
      }),
    );

    expect(result).toEqual({
      actions: [{ type: 'send_text', text: '安全回复' }],
    });
  });
});
