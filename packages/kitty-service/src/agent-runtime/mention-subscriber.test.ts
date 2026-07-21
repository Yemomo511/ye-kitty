import { describe, expect, test, vi } from 'vitest';
import type { XiaohongshuMessage } from '@kitty/platforms/xiaohongshu/event';
import { PlatformMessageService } from '@kitty/platforms/channel';
import { XiaohongshuMentionEventSubscriber } from './mention-subscriber';

describe('Agent Runtime小红书被提及订阅器', () => {
  test('收到事件后只记录跳过，不需要Agent或动作依赖', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const channel = new TestMentionChannel();
    const subscriber = new XiaohongshuMentionEventSubscriber(channel);

    await subscriber.start();
    await expect(channel.emit(createEvent())).resolves.toBeUndefined();

    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('已注册小红书被提及事件订阅'),
    );
  });
});

class TestMentionChannel extends PlatformMessageService<XiaohongshuMessage> {
  async emit(event: XiaohongshuMessage): Promise<void> {
    await this.publishMessage(event);
  }
}

function createEvent(): XiaohongshuMessage {
  return {
    id: 'xiaohongshu:mention:mention-1',
    platform: 'xiaohongshu',
    eventType: 'mention.received',
    mentionId: 'mention-1',
    senderId: 'xiaohongshu:participant:user-1',
    senderDisplayName: '小红薯',
    content: '@叶猫猫',
    source: { noteId: 'note-1' },
    occurredAt: new Date('2026-07-16T00:00:00.000Z'),
    receivedAt: new Date('2026-07-16T00:00:30.000Z'),
  };
}
