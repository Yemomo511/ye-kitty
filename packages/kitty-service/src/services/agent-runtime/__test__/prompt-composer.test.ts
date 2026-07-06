import { describe, expect, test } from 'vitest';
import { composeQqReplyPrompt } from '../infrastructure/prompt/prompt-composer';
import { composeHarnessPrompt } from '../infrastructure/prompt/harness.prompt';
import {
  buildAvailableSkillCatalogPrompt,
  buildEnabledSkillPrompt,
} from '../infrastructure/prompt/skill.prompt';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
} from '@kitty/shared/types/ids';

describe('Agent Runtime Prompt组织', () => {
  test('Skill提示词包含名称、描述和正文', () => {
    const prompt = buildEnabledSkillPrompt([
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

    expect(prompt).toContain('已启用Skill正文');
    expect(prompt).toContain('## qq-chat');
    expect(prompt).toContain('用于 QQ 回复');
    expect(prompt).toContain('群聊回复短一点。');
  });

  test('可用Skill目录不包含正文', () => {
    const prompt = buildAvailableSkillCatalogPrompt([
      {
        name: 'qq-chat',
        description: '用于 QQ 回复',
        rootPath: '/tmp/skills/qq-chat',
        allowedTools: ['get_recent_messages'],
      },
    ]);

    expect(prompt).toContain('可请求Skill目录');
    expect(prompt).toContain('## qq-chat');
    expect(prompt).toContain('用于 QQ 回复');
    expect(prompt).not.toContain('get_recent_messages');
    expect(prompt).not.toContain('能力说明');
    expect(prompt).not.toContain('群聊回复短一点。');
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
    expect(prompt.instructions).toContain('已启用Skill正文');
    expect(prompt.instructions).toContain('保持自然、亲近。');
    expect(prompt.input).toContain('可用低风险 QQ 动作目录');
    expect(prompt.input).toContain('reply_to_message');
    expect(prompt.input).toContain('禁止输出 curl、HTTP 请求、群管理');
    expect(prompt.input).toContain('平台：QQ');
    expect(prompt.input).toContain('用户消息文本：你好');
  });

  test('Harness Prompt包含循环协议和工具描述', () => {
    const prompt = composeHarnessPrompt('叶猫猫', {
      event: createChatEvent(),
      availableSkills: [
        {
          name: 'qq-chat',
          description: '用于 QQ 回复',
          rootPath: '/tmp/skills/qq-chat',
        },
      ],
      enabledSkills: [],
      tools: [
        {
          name: 'get_recent_messages',
          description: '读取最近消息',
          riskLevel: 'low',
          inputSchemaDescription: '{ "limit": 可选数字 }',
        },
      ],
      toolResults: [],
      conversationMessages: [
        { type: 'user_event', event: createChatEvent() },
        {
          type: 'skill_catalog',
          skills: [
            {
              name: 'qq-chat',
              description: '用于 QQ 回复',
              rootPath: '/tmp/skills/qq-chat',
            },
          ],
        },
      ],
      turnIndex: 1,
      maxTurns: 4,
      toolCallCount: 0,
      maxToolCalls: 3,
    });

    expect(prompt.instructions).toContain('# Harness System Prompt');
    expect(prompt.instructions).toContain('最高优先级系统约束');
    expect(prompt.instructions).toContain('## 第一层：JSON 输出契约');
    expect(prompt.instructions).toContain('## 第二层：外部环境感知与 Skill/Tool 定义');
    expect(prompt.instructions).toContain('## 第三层：JSON结构');
    expect(prompt.instructions).toContain('每一轮输出都必须是单个 JSON 对象');
    expect(prompt.instructions).toContain('当你想调用 Skill 时，返回 `skill_call`');
    expect(prompt.instructions).not.toContain('可请求Skill目录');
    expect(prompt.instructions).not.toContain('用于 QQ 回复');
    expect(prompt.instructions).not.toContain('能力说明：');
    expect(prompt.instructions).not.toContain('群聊回复短一点。');
    expect(prompt.instructions).toContain('存在安全、合规、隐私或边界风险');
    expect(prompt.instructions).toContain('"type": "skill_call"');
    expect(prompt.instructions).toContain('"type": "skill_reference_call"');
    expect(prompt.instructions).toContain('"type": "tool_call"');
    expect(prompt.instructions).toContain('可用低风险 QQ 动作目录');
    expect(prompt.instructions).toContain('reply_to_message');
    expect(prompt.instructions).toContain('mention_sender');
    expect(prompt.instructions).toContain('send_text_with_face');
    expect(prompt.instructions).toContain('send_text_with_image');
    expect(prompt.instructions).toContain('群管理');
    expect(prompt.instructions).toContain('get_recent_messages');
    expect(prompt.input).toContain('当前轮次：1/4');
    expect(prompt.input).toContain('可请求Skill目录');
    expect(prompt.input).toContain('用于 QQ 回复');
    expect(prompt.input).toContain('用户消息文本：你好');
  });

  test('Harness Prompt在Skill启用后仅在观察中包含正文', () => {
    const event = createChatEvent();
    const prompt = composeHarnessPrompt('叶猫猫', {
      event,
      availableSkills: [
        {
          name: 'qq-chat',
          description: '用于 QQ 回复',
          rootPath: '/tmp/skills/qq-chat',
        },
      ],
      enabledSkills: [
        {
          metadata: {
            name: 'qq-chat',
            description: '用于 QQ 回复',
            rootPath: '/tmp/skills/qq-chat',
          },
          body: '群聊回复短一点。',
        },
      ],
      tools: [],
      toolResults: [],
      conversationMessages: [
        { type: 'user_event', event },
        {
          type: 'skill_catalog',
          skills: [
            {
              name: 'qq-chat',
              description: '用于 QQ 回复',
              rootPath: '/tmp/skills/qq-chat',
            },
          ],
        },
        {
          type: 'skill_content',
          skill: {
            metadata: {
              name: 'qq-chat',
              description: '用于 QQ 回复',
              rootPath: '/tmp/skills/qq-chat',
            },
            body: '群聊回复短一点。',
          },
        },
      ],
      turnIndex: 2,
      maxTurns: 4,
      toolCallCount: 0,
      maxToolCalls: 3,
    });

    expect(prompt.instructions).not.toContain('可请求Skill目录');
    expect(prompt.instructions).not.toContain('# 已启用Skill正文');
    expect(prompt.instructions).not.toContain('能力说明：');
    expect(prompt.instructions).not.toContain('群聊回复短一点。');
    expect(prompt.input).toContain('可请求Skill目录');
    expect(prompt.input).toContain('已启用Skill正文');
    expect(prompt.input).toContain('群聊回复短一点。');
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
