import { describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { composeQqReplyPrompt } from './reply';
import { composeAgentPrompt } from './composer';
import {
  buildAvailableSkillCatalogPrompt,
  buildEnabledSkillPrompt,
  createSkillPromptDocument,
} from './skills';
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
    expect(prompt).toContain('#### qq-chat');
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
    expect(prompt).toContain('#### 2.1.1.1 qq-chat');
    expect(prompt).toContain('用于 QQ 回复');
    expect(prompt).not.toContain('get_recent_messages');
    expect(prompt).not.toContain('能力说明');
    expect(prompt).not.toContain('群聊回复短一点。');
  });

  test('Skill结构化文档包含小节和reference索引', () => {
    const rootPath = join(tmpdir(), `skill-doc-${Date.now()}`);
    mkdirSync(join(rootPath, 'references'), { recursive: true });
    writeFileSync(join(rootPath, 'references', 'examples.md'), '不应读取正文');
    writeFileSync(join(rootPath, 'references', 'ignore.ts'), '不应进入索引');

    const document = createSkillPromptDocument({
      metadata: {
        name: 'chat-style',
        description: '聊天风格',
        rootPath,
      },
      body: '# 风格说明\n保持自然。\n\n## 示例策略\n先看上下文。',
    });

    expect(document.schemaVersion).toBe('ye-kitty.skill.prompt.v1');
    expect(document.sections.map((section) => section.id)).toEqual([
      'skill:chat-style#风格说明',
      'skill:chat-style#示例策略',
    ]);
    expect(document.references).toEqual([
      {
        path: 'examples.md',
        readable: true,
        extension: '.md',
      },
    ]);
    expect(document.referenceAccess).toEqual({
      type: 'tool',
      name: 'skill',
      referenceField: 'reference',
      trigger: '当你需要读取 reference 文件时，调用 skill Tool 并提供 reference。',
      constraint:
        '只能请求当前已启用 Skill 的 references 索引内文件；不得猜测未出现在 references[].path 中的路径。',
      references: [
        {
          path: 'examples.md',
          readable: true,
          extension: '.md',
        },
      ],
    });
  });

  test('无标题Skill正文生成默认小节', () => {
    const document = createSkillPromptDocument({
      metadata: {
        name: 'plain-skill',
        description: '无标题Skill',
        rootPath: join(tmpdir(), `plain-skill-${Date.now()}`),
      },
      body: '只有正文。',
    });

    expect(document.sections).toEqual([
      {
        id: 'skill:plain-skill#body',
        title: 'Skill正文',
        level: 1,
        content: '只有正文。',
      },
    ]);
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
    expect(prompt.input).toContain('平台：QQ');
    expect(prompt.input).toContain('用户消息文本：你好');
  });

  test('Agent Prompt包含循环协议和工具描述', () => {
    const prompt = composeAgentPrompt('叶猫猫', {
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
          inputSchemaDescription: '{}',
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
      promptState: createPromptState(),
      turnIndex: 1,
      maxTurns: 4,
      toolCallCount: 0,
      maxToolCalls: 3,
    });

    expect(prompt.instructions).toContain('# 第一章节: Agent System Prompt');
    expect(prompt.instructions).toContain('# 第二章节: Outside Context Prompt');
    expect(prompt.instructions).toContain('## 1.1 宪法约束');
    expect(prompt.instructions).toContain('## 1.2 状态机约束');
    expect(prompt.instructions).toContain('## 1.3 JSON Action 契约');
    expect(prompt.instructions).toContain('每一轮输出必须是单个 JSON 对象');
    expect(prompt.instructions).toContain('启用 Skill 正文');
    expect(prompt.instructions).toContain('需要未启用 Skill 正文');
    expect(prompt.instructions).toContain('首轮决策前自动注入最近消息观察');
    expect(prompt.instructions).toContain('不要重复调用已经成功完成的工具');
    expect(prompt.instructions).toContain('可请求Skill目录');
    expect(prompt.instructions).toContain('用于 QQ 回复');
    expect(prompt.instructions).not.toContain('能力说明：');
    expect(prompt.instructions).not.toContain('群聊回复短一点。');
    expect(prompt.instructions).toContain('读取最近消息');
    expect(prompt.instructions).toContain('存在安全、合规、隐私或边界风险');
    expect(prompt.instructions).toContain('"type": "tool"');
    expect(prompt.instructions).toContain('"name": "skill"');
    expect(prompt.instructions).not.toContain('Harness');
    expect(prompt.instructions).not.toContain('"type": "skill_call"');
    expect(prompt.instructions).not.toContain('"type": "skill_reference_call"');
    expect(prompt.instructions).not.toContain('"type": "tool_call"');
    expect(prompt.instructions).toContain('send_text_with_face');
    expect(prompt.instructions).toContain('使用 `poke_sender` 时');
    expect(prompt.instructions.indexOf('## 2.1 Skill Prompt')).toBeLessThan(
      prompt.instructions.indexOf('## 2.2 Tool Prompt'),
    );
    expect(prompt.instructions).toContain('### 2.2.1 get_recent_messages');
    expect(prompt.input).not.toContain('# 第二章节: Outside Context Prompt');
    expect(prompt.input).toContain('<run_state>');
    expect(prompt.input).toContain('phase: initial_observe');
    expect(prompt.input).toContain('tool_budget: 0/3');
    expect(prompt.input).toContain('<decision_history>');
    expect(prompt.input).toContain('当前轮次：1/4');
    expect(prompt.input).not.toContain('可请求Skill目录');
    expect(prompt.input).not.toContain('用于 QQ 回复');
    expect(prompt.input).toContain('# 第三章节: Runtime Observation');
    expect(prompt.input).toContain('用户消息文本：你好');
  });

  test('Agent Prompt在Skill启用后仅在instruction第二章包含正文', () => {
    const event = createChatEvent();
    const rootPath = join(tmpdir(), `agent-skill-doc-${Date.now()}`);
    mkdirSync(join(rootPath, 'references'), { recursive: true });
    writeFileSync(join(rootPath, 'references', 'examples.md'), '参考正文不应提前读取。');

    const prompt = composeAgentPrompt('叶猫猫', {
      event,
      availableSkills: [
        {
          name: 'qq-chat',
          description: '用于 QQ 回复',
          rootPath,
        },
      ],
      enabledSkills: [
        {
          metadata: {
            name: 'qq-chat',
            description: '用于 QQ 回复',
            rootPath,
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
              rootPath,
            },
            body: '群聊回复短一点。',
          },
        },
      ],
      promptState: createPromptState({
        phase: 'skill_loaded',
        enabledSkillNames: ['qq-chat'],
        decisionHistory: [
          {
            turnIndex: 1,
            decisionType: 'skill_call',
            target: 'qq-chat',
            success: true,
            reason: '需要群聊方法论',
          },
        ],
      }),
      turnIndex: 2,
      maxTurns: 4,
      toolCallCount: 0,
      maxToolCalls: 3,
    });

    expect(prompt.instructions).toContain('可请求Skill目录');
    expect(prompt.instructions).toContain('<skill_document name="qq-chat"');
    expect(prompt.instructions).not.toContain('能力说明：');
    expect(prompt.instructions).toContain('群聊回复短一点。');
    expect(prompt.instructions).toContain('"schemaVersion": "ye-kitty.skill.prompt.v1"');
    expect(prompt.instructions).toContain('skill:qq-chat#body');
    expect(prompt.instructions).toContain(
      '当你需要读取 reference 文件时，调用 `skill` Tool 并提供 `reference`',
    );
    expect(prompt.instructions).toContain('"referenceAccess"');
    expect(prompt.instructions).toContain('"type": "tool"');
    expect(prompt.instructions).toContain('"path": "examples.md"');
    expect(prompt.instructions).toContain('<skill_body format="markdown">');
    expect(prompt.instructions).not.toContain('参考正文不应提前读取。');
    expect(prompt.input).not.toContain('可请求Skill目录');
    expect(prompt.input).not.toContain('<skill_document name="qq-chat"');
    expect(prompt.input).not.toContain('群聊回复短一点。');
  });

  test('Agent Prompt在reference读取后注入结构化引用文档', () => {
    const event = createChatEvent();
    const prompt = composeAgentPrompt('叶猫猫', {
      event,
      availableSkills: [],
      enabledSkills: [],
      tools: [],
      toolResults: [],
      conversationMessages: [
        { type: 'user_event', event },
        {
          type: 'skill_reference',
          reference: {
            skill: {
              name: 'chat-style',
              description: '聊天风格',
              rootPath: '/tmp/skills/chat-style',
            },
            referencePath: 'examples.md',
            absolutePath: '/tmp/skills/chat-style/references/examples.md',
            content: '参考示例正文。',
          },
        },
      ],
      promptState: createPromptState({
        phase: 'reference_loaded',
        loadedReferenceKeys: ['chat-style:examples.md'],
      }),
      turnIndex: 3,
      maxTurns: 4,
      toolCallCount: 0,
      maxToolCalls: 3,
    });

    expect(prompt.instructions).toContain(
      '<skill_reference_document skill="chat-style" path="examples.md"',
    );
    expect(prompt.instructions).toContain('"schemaVersion": "ye-kitty.skill.reference.v1"');
    expect(prompt.instructions).toContain('<reference_body format="markdown">');
    expect(prompt.instructions).toContain('参考示例正文。');
    expect(prompt.input).not.toContain('参考示例正文。');
  });

  test('Outside Context中Skill Prompt位于Tool Prompt之前', () => {
    const prompt = composeAgentPrompt('叶猫猫', {
      event: createChatEvent(),
      availableSkills: [],
      enabledSkills: [],
      tools: [
        {
          name: 'get_recent_messages',
          description: '读取最近消息',
          riskLevel: 'low',
          inputSchemaDescription: '{}',
        },
      ],
      toolResults: [],
      conversationMessages: [
        { type: 'user_event', event: createChatEvent() },
        { type: 'skill_catalog', skills: [] },
      ],
      promptState: createPromptState(),
      turnIndex: 1,
      maxTurns: 4,
      toolCallCount: 0,
      maxToolCalls: 3,
    });

    expect(prompt.instructions.indexOf('## 2.1 Skill Prompt')).toBeLessThan(
      prompt.instructions.indexOf('## 2.2 Tool Prompt'),
    );
    expect(prompt.input).not.toContain('## 2.1 Skill Prompt');
    expect(prompt.input).not.toContain('## 2.2 Tool Prompt');
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

function createPromptState(
  input: {
    readonly phase?:
      | 'initial_observe'
      | 'skill_loaded'
      | 'reference_loaded'
      | 'tool_observing'
      | 'ready_to_decide'
      | 'finalized'
      | 'fallback'
      | 'human_review';
    readonly enabledSkillNames?: readonly string[];
    readonly loadedReferenceKeys?: readonly string[];
    readonly decisionHistory?: readonly {
      readonly turnIndex: number;
      readonly decisionType:
        'tool_call' | 'skill_call' | 'skill_reference_call' | 'reply' | 'ignore' | 'human_review';
      readonly target?: string;
      readonly success?: boolean;
      readonly reason: string;
    }[];
  } = {},
) {
  return {
    traceId: 'agent-run:test',
    phase: input.phase ?? 'initial_observe',
    budget: {
      turnIndex: 1,
      maxTurns: 4,
      toolCallCount: 0,
      maxToolCalls: 3,
      skillReferenceCount: input.loadedReferenceKeys?.length ?? 0,
      maxSkillReferences: 3,
      decisionErrorCount: 0,
    },
    context: {
      availableSkillNames: ['qq-chat'],
      enabledSkillNames: input.enabledSkillNames ?? [],
      loadedReferenceKeys: input.loadedReferenceKeys ?? [],
      visibleToolNames: ['get_recent_messages'],
      latestObservation: '尚无工具结果或错误观察。',
    },
    decisionHistory: input.decisionHistory ?? [],
  };
}
