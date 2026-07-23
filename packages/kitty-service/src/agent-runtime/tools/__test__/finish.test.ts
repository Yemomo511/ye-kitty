import type { PlatformMessage } from '@kitty/platforms/message';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { AgentRunState } from '../../state';
import { createFinishTool } from '../finish';
import { Tool } from '../tool';

describe('finish终止工具', () => {
  test('合法回复由系统写入Agent终态', async () => {
    const state = createState();
    const settlement = await Tool.settle(
      'finish',
      createFinishTool(state),
      { result: 'reply', text: '你好呀', reason: '回应当前消息' },
      withCallId(state, 'finish-1'),
    );

    expect(settlement.status).toBe('success');
    expect(state.terminal).toEqual({ type: 'reply', text: '你好呀', actions: undefined });
  });

  test('任一QQ动作不合法时拒绝整个终态', async () => {
    const state = createState();
    const settlement = await Tool.settle(
      'finish',
      createFinishTool(state),
      {
        result: 'reply',
        reason: '发送消息',
        actions: [
          { type: 'send_text', text: '合法' },
          {
            type: 'send_text_with_face',
            segments: [
              { type: 'text', text: '缺少表情' },
              { type: 'text', text: '仍然是文本' },
            ],
          },
        ],
      },
      withCallId(state, 'finish-2'),
    );

    expect(settlement.status).toBe('error');
    expect(settlement.output?.summary).toContain('第 2 个QQ动作不合法');
    expect(state.terminal).toBeUndefined();
  });

  test('未通过工具观察的自定义表情不能外发', async () => {
    const state = createState();
    const settlement = await Tool.settle(
      'finish',
      createFinishTool(state),
      {
        result: 'reply',
        reason: '发送表情',
        actions: [{ type: 'send_custom_image', file: '/tmp/untrusted.gif' }],
      },
      withCallId(state, 'finish-3'),
    );

    expect(settlement.status).toBe('error');
    expect(settlement.output?.summary).toContain('不属于本轮已确认目录');
  });

  test('强制群聊回复不能忽略', async () => {
    const state = createState('required_group_reply');
    const settlement = await Tool.settle(
      'finish',
      createFinishTool(state),
      { result: 'ignore', reason: '不想参与' },
      withCallId(state, 'finish-4'),
    );

    expect(settlement.status).toBe('error');
    expect(settlement.output?.summary).toContain('必须回复');
    expect(state.terminal).toBeUndefined();
  });

  test('戳一戳不能与其他外发内容组合', async () => {
    const state = createState();
    const settlement = await Tool.settle(
      'finish',
      createFinishTool(state),
      {
        result: 'reply',
        text: '同时回复',
        reason: '互动',
        actions: [{ type: 'poke_sender' }],
      },
      withCallId(state, 'finish-5'),
    );

    expect(settlement.status).toBe('error');
    expect(settlement.output?.summary).toContain('戳一戳必须单独使用');
  });

  test.each([
    {
      input: { result: 'ignore', reason: '无需参与' },
      terminal: { type: 'ignore', reason: '无需参与' },
    },
    {
      input: { result: 'review', reason: '存在隐私风险' },
      terminal: { type: 'human_review', reason: '存在隐私风险' },
    },
  ])('接受合法ignore和review终态', async ({ input, terminal }) => {
    const state = createState();
    const settlement = await Tool.settle(
      'finish',
      createFinishTool(state),
      input,
      withCallId(state, `finish-${input.result}`),
    );

    expect(settlement.status).toBe('success');
    expect(state.terminal).toEqual(terminal);
  });

  test('空回复和缺少最近消息的强制回复都会被拒绝', async () => {
    const normal = createState();
    const required = createState('required_group_reply');

    await expect(
      Tool.settle(
        'finish',
        createFinishTool(normal),
        { result: 'reply', reason: '空回复' },
        withCallId(normal, 'finish-empty'),
      ),
    ).resolves.toMatchObject({ status: 'error' });
    await expect(
      Tool.settle(
        'finish',
        createFinishTool(required),
        { result: 'reply', text: '回复', reason: '强制回复' },
        withCallId(required, 'finish-required'),
      ),
    ).resolves.toMatchObject({
      status: 'error',
      output: { summary: expect.stringContaining('最近消息观察尚未成功') },
    });
  });

  test('已由表情目录确认的图片可以作为send_msg资源', async () => {
    const state = createState();
    const faceTool = Tool.make({
      description: '测试表情目录',
      parameters: z.object({}).strict(),
      policy: {
        source: 'builtin',
        risk: 'low',
        approval: 'never',
        timeoutMs: 1000,
      },
      execute: async () => ({
        success: true,
        summary: '已读取',
        data: [{ file: 'custom-face://cat' }],
      }),
    });
    await Tool.settle('get_custom_faces', faceTool, {}, withCallId(state, 'face-1'));

    const settlement = await Tool.settle(
      'finish',
      createFinishTool(state),
      {
        result: 'reply',
        reason: '发送确认过的表情',
        actions: [
          {
            type: 'send_msg',
            message: [{ type: 'image', data: { file: 'custom-face://cat' } }],
          },
        ],
      },
      withCallId(state, 'finish-image'),
    );

    expect(settlement.status).toBe('success');
    expect(state.terminal).toMatchObject({
      type: 'reply',
      actions: [
        {
          type: 'send_msg',
          message: [{ type: 'image', file: 'custom-face://cat' }],
        },
      ],
    });
  });
});

function createState(replyIntent: 'normal' | 'required_group_reply' = 'normal'): AgentRunState {
  return new AgentRunState({
    runId: 'run-1',
    traceId: 'trace-1',
    agentName: '叶猫猫',
    event: createMessage(),
    availableSkills: [],
    enabledSkills: [],
    replyIntent,
    maxToolCalls: 3,
    maxSkillReferences: 3,
  });
}

function withCallId(state: AgentRunState, callId: string) {
  return { ...state.createToolContext(new AbortController().signal), callId };
}

function createMessage(): PlatformMessage {
  return {
    id: 'event-1' as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: 'group-1' as ConversationId,
    conversationType: 'group',
    senderId: 'user-1' as ParticipantId,
    senderDisplayName: '测试用户',
    message: {
      id: 'message-1' as MessageId,
      type: 'text',
      text: '你好',
      mentions: [],
    },
    receivedAt: new Date('2026-07-23T00:00:00.000Z'),
  };
}
