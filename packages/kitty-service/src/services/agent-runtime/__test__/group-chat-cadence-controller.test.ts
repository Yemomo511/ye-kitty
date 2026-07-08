import { describe, expect, test } from 'vitest';
import { GroupChatCadenceController } from '../application/group-chat-cadence-controller';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type {
  ChatEventId,
  ConversationId,
  MessageId,
  ParticipantId,
} from '@kitty/shared/types/ids';

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

  test('命中随机回复片段时要求强制群聊回复', () => {
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => new Date('2026-07-08T07:05:00.000+08:00'),
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

  test('回复后计时器到点且消息数达标时要求强制群聊回复', () => {
    let now = new Date('2026-07-08T07:00:00.000+08:00');
    const cadence = new GroupChatCadenceController({
      selfQqId: '10000',
      now: () => now,
      random: () => 0.9,
      postReplyInitialDelayMs: 10000,
    });
    const trigger = createChatEvent('触发回复');
    cadence.markReplySent(trigger);

    now = new Date('2026-07-08T07:00:10.000+08:00');
    const event = createChatEvent('爆发消息');
    cadence.recordMessage(event);

    expect(cadence.shouldTrigger(event)).toMatchObject({
      type: 'trigger',
      triggerMode: 'post_reply_counter',
      replyRequired: true,
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
  } = {},
): ChatEventContract {
  return {
    id: `chat-event-${text}` as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: 'qq:conversation:123456' as ConversationId,
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
