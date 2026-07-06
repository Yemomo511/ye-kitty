import { describe, expect, test } from 'vitest';
import { composeQqReplyPrompt } from '../infrastructure/prompt/prompt-composer';
import { composeHarnessPrompt } from '../infrastructure/prompt/harness.prompt';
import { buildSkillPrompt } from '../infrastructure/prompt/skill.prompt';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
} from '@kitty/shared/types/ids';

describe('Agent Runtime Prompt组织', () => {
  test('Skill提示词包含名称、描述和正文', () => {
    const prompt = buildSkillPrompt([
      {
        metadata: {
          name: 'qq-chat',
          description: '用于 QQ 回复',
          rootPath: '/tmp/skills/qq-chat',
          allowedTools: ['get_recent_messages'],
        },
        body: '群聊回复短一点。',
      },
    ]);

    expect(prompt).toContain('本轮启用 Skill');
    expect(prompt).toContain('## qq-chat');
    expect(prompt).toContain('用于 QQ 回复');
    expect(prompt).toContain('建议工具：get_recent_messages');
    expect(prompt).toContain('群聊回复短一点。');
  });

  test('Prompt组合包含基础身份、QQ上下文和Skill内容', () => {
    const prompt = composeQqReplyPrompt({
      agentName: '叶猫猫',
      event: createChatEvent(),
      skills: [
        {
          metadata: {
            name: 'qq-chat',
            description: '用于 QQ 回复',
            rootPath: '/tmp/skills/qq-chat',
          },
          body: '保持自然、亲近。',
        },
      ],
    });

    expect(prompt.instructions).toContain('你是叶猫猫');
    expect(prompt.instructions).toContain('本轮启用 Skill');
    expect(prompt.instructions).toContain('保持自然、亲近。');
    expect(prompt.input).toContain('平台：QQ');
    expect(prompt.input).toContain('用户消息文本：你好');
  });

  test('Harness Prompt包含循环协议和工具描述', () => {
    const prompt = composeHarnessPrompt('叶猫猫', {
      event: createChatEvent(),
      skills: [],
      tools: [
        {
          name: 'get_recent_messages',
          description: '读取最近消息',
          riskLevel: 'low',
          inputSchemaDescription: '{ "limit": 可选数字 }',
        },
      ],
      toolResults: [],
      turnIndex: 1,
      maxTurns: 4,
      toolCallCount: 0,
      maxToolCalls: 3,
    });

    expect(prompt.instructions).toContain('你运行在 Ye-Kitty Harness 循环中');
    expect(prompt.instructions).toContain('【第一层：JSON 输出契约】');
    expect(prompt.instructions).toContain('【第二层：Skill 与 Tool 定义】');
    expect(prompt.instructions).toContain('【第三层：JSON 调用方式】');
    expect(prompt.instructions).toContain('每一轮输出都必须是单个 JSON 对象');
    expect(prompt.instructions).toContain('当你缺少会话上下文');
    expect(prompt.instructions).toContain('"type":"tool_call"');
    expect(prompt.instructions).toContain('如果用户明确要求你查看最近聊天');
    expect(prompt.instructions).toContain('get_recent_messages');
    expect(prompt.input).toContain('当前轮次：1/4');
    expect(prompt.input).toContain('工具观察结果：暂无。');
  });

  test('无Skill时仍能生成Prompt', () => {
    const prompt = composeQqReplyPrompt({
      agentName: '叶猫猫',
      event: createChatEvent(),
      skills: [],
    });

    expect(prompt.instructions).toContain('你是叶猫猫');
    expect(prompt.instructions).not.toContain('本轮启用 Skill');
    expect(prompt.input).toContain('请根据下面的 QQ 消息生成一条回复。');
  });
});

function createChatEvent(): ChatEventContract {
  return {
    id: 'chat-event-1' as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: 'qq:conversation:123456' as ConversationId,
    conversationType: 'group',
    senderId: 'qq:participant:20000' as ParticipantId,
    senderDisplayName: '测试用户',
    message: {
      id: 'message-1' as MessageId,
      type: 'text',
      text: '你好',
      mentions: [],
    },
    receivedAt: new Date('2026-07-02T00:00:00.000Z'),
  };
}
