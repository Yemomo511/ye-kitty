import { describe, expect, test } from 'vitest';
import { GroupChatCadenceController } from '../cadence';
import type { PlatformMessage } from '@kitty/platforms/message';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';

describe('GroupChatCadenceController', () => {
  test('休息时段未@群聊不触发', () => {
    const now = new Date('2026-07-08T02:00:00.000+08:00');
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => now,
    });

    const event = createChatEvent('凌晨消息');
    cadence.recordMessage(event);

    expect(cadence.shouldTrigger(event)).toMatchObject({
      type: 'ignore',
      replyRequired: false,
    });
  });

  test('@叶猫猫的群聊立即触发', () => {
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => new Date('2026-07-08T02:00:00.000+08:00'),
    });
    const event = createChatEvent('@消息', { mentions: ['10000'] });

    expect(cadence.shouldTrigger(event)).toMatchObject({
      type: 'trigger',
      triggerMode: 'mention',
      replyRequired: false,
    });
  });

  test('工作时段命中两分钟随机片段时要求强制群聊回复', () => {
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => new Date('2026-07-08T07:01:00.000+08:00'),
      random: () => 0,
    });
    const event = createChatEvent('早上消息');
    cadence.recordMessage(event);

    expect(cadence.shouldTrigger(event)).toMatchObject({
      type: 'trigger',
      triggerMode: 'random_window',
      replyRequired: true,
      recentMessageLimit: 100,
    });
  });

  test('未命中随机回复片段时继续等待', () => {
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => new Date('2026-07-08T07:20:00.000+08:00'),
      random: () => 0,
    });
    const event = createChatEvent('错过片段');
    cadence.recordMessage(event);

    expect(cadence.shouldTrigger(event)).toMatchObject({
      type: 'wait',
      replyRequired: false,
    });
  });

  test('回复后默认等待十分钟且累计十条消息才触发', () => {
    let now = new Date('2026-07-08T07:00:00.000+08:00');
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => now,
      random: () => 0.9,
    });
    const trigger = createChatEvent('触发回复');
    cadence.markReplySent(trigger);

    const messages = recordMessages(cadence, 10, '首轮爆发');
    now = new Date('2026-07-08T07:09:59.999+08:00');
    expect(cadence.shouldTrigger(messages.at(-1)!)).toMatchObject({
      type: 'wait',
      replyRequired: false,
    });

    now = new Date('2026-07-08T07:10:00.000+08:00');
    expect(cadence.shouldTrigger(messages.at(-1)!)).toMatchObject({
      type: 'trigger',
      triggerMode: 'post_reply_counter',
      replyRequired: true,
    });
  });

  test('回复后门槛逐级增长并封顶六十分钟和五十条', () => {
    let now = new Date('2026-07-08T07:00:00.000+08:00');
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => now,
      random: () => 0.9,
    });
    cadence.markReplySent(createChatEvent('开始连续对话'));

    const stages = [
      { delayMinutes: 10, messageCount: 10 },
      { delayMinutes: 20, messageCount: 20 },
      { delayMinutes: 30, messageCount: 30 },
      { delayMinutes: 40, messageCount: 40 },
      { delayMinutes: 50, messageCount: 50 },
      { delayMinutes: 60, messageCount: 50 },
    ] as const;

    stages.forEach((stage, stageIndex) => {
      const messages = recordMessages(cadence, stage.messageCount, `第${stageIndex + 1}轮`);
      now = new Date(now.getTime() + stage.delayMinutes * 60 * 1000);

      expect(cadence.shouldTrigger(messages.at(-1)!)).toMatchObject({
        type: 'trigger',
        triggerMode: 'post_reply_counter',
      });
      cadence.markReplySent(messages.at(-1)!);
    });

    const cappedMessages = recordMessages(cadence, 50, '封顶轮');
    now = new Date(now.getTime() + 59 * 60 * 1000);
    expect(cadence.shouldTrigger(cappedMessages.at(-1)!)).toMatchObject({ type: 'wait' });

    now = new Date(now.getTime() + 60 * 1000);
    expect(cadence.shouldTrigger(cappedMessages.at(-1)!)).toMatchObject({
      type: 'trigger',
      triggerMode: 'post_reply_counter',
    });
  });

  test('回复后冷却期间不检查随机回复片段', () => {
    let now = new Date('2026-07-08T07:00:00.000+08:00');
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => now,
      random: () => 0,
    });
    cadence.markReplySent(createChatEvent('冷却开始'));

    now = new Date('2026-07-08T07:01:00.000+08:00');
    const event = createChatEvent('随机片段内消息');
    cadence.recordMessage(event);

    expect(cadence.shouldTrigger(event)).toMatchObject({
      type: 'wait',
      replyRequired: false,
    });
  });

  test('同一随机回复片段最多触发一次', () => {
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => new Date('2026-07-08T07:01:00.000+08:00'),
      random: () => 0,
    });
    const first = createChatEvent('片段第一条');
    const second = createChatEvent('片段第二条');
    cadence.recordMessage(first);
    cadence.recordMessage(second);

    expect(cadence.shouldTrigger(first)).toMatchObject({
      type: 'trigger',
      triggerMode: 'random_window',
    });
    expect(cadence.shouldTrigger(second)).toMatchObject({
      type: 'wait',
      replyRequired: false,
    });
  });

  test('跨群主动回复至少间隔两分钟', () => {
    let now = new Date('2026-07-08T12:00:30.000+08:00');
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => now,
      random: () => 0,
    });
    const firstGroup = createChatEvent('第一群消息', { conversationId: 'qq:conversation:1' });
    const secondGroup = createChatEvent('第二群消息', { conversationId: 'qq:conversation:2' });
    cadence.recordMessage(firstGroup);
    cadence.recordMessage(secondGroup);

    expect(cadence.shouldTrigger(firstGroup)).toMatchObject({ type: 'trigger' });
    expect(cadence.shouldTrigger(secondGroup)).toMatchObject({
      type: 'wait',
      replyRequired: false,
    });

    now = new Date('2026-07-08T12:02:30.000+08:00');
    const secondGroupNextMessage = createChatEvent('第二群后续消息', {
      conversationId: 'qq:conversation:2',
    });
    cadence.recordMessage(secondGroupNextMessage);
    expect(cadence.shouldTrigger(secondGroupNextMessage)).toMatchObject({
      type: 'trigger',
      triggerMode: 'random_window',
    });
  });

  test('回复后计时计数器同样服从跨群主动回复预算', () => {
    let now = new Date('2026-07-08T11:50:30.000+08:00');
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => now,
      random: () => 0,
    });
    const counterConversationId = 'qq:conversation:counter';
    cadence.markReplySent(createChatEvent('计数器开始', { conversationId: counterConversationId }));
    const counterMessages = recordMessages(cadence, 10, '计数器消息', counterConversationId);

    now = new Date('2026-07-08T12:00:30.000+08:00');
    const budgetOwner = createChatEvent('占用全局预算', {
      conversationId: 'qq:conversation:owner',
    });
    cadence.recordMessage(budgetOwner);
    expect(cadence.shouldTrigger(budgetOwner)).toMatchObject({ type: 'trigger' });
    expect(cadence.shouldTrigger(counterMessages.at(-1)!)).toMatchObject({
      type: 'wait',
      replyRequired: false,
    });

    now = new Date('2026-07-08T12:02:30.000+08:00');
    const nextCounterMessage = createChatEvent('预算恢复后的计数器消息', {
      conversationId: counterConversationId,
    });
    cadence.recordMessage(nextCounterMessage);
    expect(cadence.shouldTrigger(nextCounterMessage)).toMatchObject({
      type: 'trigger',
      triggerMode: 'post_reply_counter',
    });
  });

  test('@叶猫猫不受跨群主动回复预算限制', () => {
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => new Date('2026-07-08T12:00:30.000+08:00'),
      random: () => 0,
    });
    const proactive = createChatEvent('主动回复占用预算', {
      conversationId: 'qq:conversation:1',
    });
    const mention = createChatEvent('@叶猫猫', {
      mentions: ['10000'],
      conversationId: 'qq:conversation:2',
    });
    cadence.recordMessage(proactive);
    cadence.recordMessage(mention);

    expect(cadence.shouldTrigger(proactive)).toMatchObject({ type: 'trigger' });
    expect(cadence.shouldTrigger(mention)).toMatchObject({
      type: 'trigger',
      triggerMode: 'mention',
    });
  });

  test('回复后计时器到点但消息数不足时回到随机观察', () => {
    let now = new Date('2026-07-08T07:00:00.000+08:00');
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => now,
      random: () => 0.9,
      postReplyInitialDelayMs: 10000,
      postReplyInitialMessageCount: 2,
    });
    cadence.markReplySent(createChatEvent('触发回复'));

    now = new Date('2026-07-08T07:00:10.000+08:00');
    const event = createChatEvent('单条消息');
    cadence.recordMessage(event);

    expect(cadence.shouldTrigger(event)).toMatchObject({
      type: 'wait',
      replyRequired: false,
    });
  });
});

function createChatEvent(
  text: string,
  options: {
    readonly mentions?: readonly string[];
    readonly conversationId?: string;
  } = {},
): PlatformMessage {
  return {
    id: `chat-event-${text}` as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: (options.conversationId ?? 'qq:conversation:123456') as ConversationId,
    conversationType: 'group',
    senderId: 'qq:participant:20000' as ParticipantId,
    senderDisplayName: '测试用户',
    message: {
      id: `message-${text}` as MessageId,
      type: 'text',
      text,
      mentions: options.mentions ?? [],
    },
    receivedAt: new Date('2026-07-08T00:00:00.000Z'),
  };
}

function recordMessages(
  cadence: GroupChatCadenceController,
  count: number,
  prefix: string,
  conversationId?: string,
): PlatformMessage[] {
  return Array.from({ length: count }, (_, index) => {
    const event = createChatEvent(`${prefix}-${index + 1}`, { conversationId });
    cadence.recordMessage(event);
    return event;
  });
}
