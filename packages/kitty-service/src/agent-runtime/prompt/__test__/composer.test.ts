import type { PlatformMessage } from '@kitty/platforms/message';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';
import { describe, expect, test } from 'vitest';
import { AgentRunState } from '../../state';
import { composeAgentInput, composeAgentInstructions } from '../composer';

describe('Agent Prompt最小投影', () => {
  test('模型能看到任务、Skill和工具使用原则，但看不到系统治理字段', () => {
    const state = createState();
    const instructions = composeAgentInstructions('叶猫猫', state);
    const input = composeAgentInput(state, {
      status: 'success',
      summary: '最近有一条问候。',
      data: [{ text: '你好' }],
    });
    const prompt = `${instructions}\n${input}`;

    expect(prompt).toContain('每次处理必须通过 `finish` 工具');
    expect(prompt).toContain('qq-chat');
    expect(prompt).toContain('最近有一条问候');
    expect(prompt).not.toContain('callId');
    expect(prompt).not.toContain('tool_budget');
    expect(prompt).not.toContain('maxToolCalls');
    expect(prompt).not.toContain('approvalGranted');
    expect(prompt).not.toContain('trace_id');
  });

  test('强制回复只向模型说明业务目标，不暴露系统预算', () => {
    const state = createState('required_group_reply');
    const input = composeAgentInput(state, {
      status: 'error',
      summary: '最近消息读取失败。',
      retryable: true,
    });

    expect(input).toContain('需要基于最近消息给出一条自然短回复');
    expect(input).toContain('重新调用 get_recent_messages');
    expect(input).not.toContain('最大轮次');
  });
});

function createState(replyIntent: 'normal' | 'required_group_reply' = 'normal'): AgentRunState {
  return new AgentRunState({
    runId: 'run-secret',
    traceId: 'trace-secret',
    agentName: '叶猫猫',
    event: createMessage(),
    availableSkills: [
      {
        name: 'qq-chat',
        description: 'QQ聊天方法',
        rootPath: '/tmp/not-exists',
        allowedTools: [],
      },
    ],
    enabledSkills: [],
    replyIntent,
    maxToolCalls: 3,
    maxSkillReferences: 3,
  });
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
