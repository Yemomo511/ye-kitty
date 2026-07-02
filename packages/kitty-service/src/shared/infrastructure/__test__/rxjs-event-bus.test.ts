import { describe, expect, test } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { RxjsEventBus } from '../rxjs-event-bus';
import type { EventEnvelope } from '../../types/event-bus';

describe('RxjsEventBus', () => {
  test('通过泛型 publish 同时驱动 subscribe 和 events$', async () => {
    const eventBus = new RxjsEventBus();
    const receivedByStream = firstValueFrom(
      eventBus.events$.pipe(filter(isMessageReceivedEnvelope)),
    );

    let receivedBySubscriber = '';
    await eventBus.subscribe<EventEnvelope<{ readonly text: string }>>(async (event) => {
      if (event.eventType !== 'message.received') return;
      receivedBySubscriber = event.payload.text;
    });

    await eventBus.publish({
      eventId: 'event-1',
      eventType: 'message.received',
      occurredAt: new Date('2026-07-02T00:00:00.000Z'),
      payload: { text: '你好' },
    });

    await expect(receivedByStream).resolves.toMatchObject({
      eventId: 'event-1',
      eventType: 'message.received',
    });
    expect(receivedBySubscriber).toBe('你好');
  });

  test('支持不遵循 EventEnvelope 的轻量事件', async () => {
    const eventBus = new RxjsEventBus();
    let receivedChannel = '';

    await eventBus.subscribe<{ readonly channel: string; readonly connected: boolean }>(async (event) => {
      if (!event.connected) return;
      receivedChannel = event.channel;
    });

    await eventBus.publish({
      channel: 'onebot',
      connected: true,
    });

    expect(receivedChannel).toBe('onebot');
  });
});

// 判断是否为消息接收信封事件，测试里用它模拟订阅方自行筛选事件流。
function isMessageReceivedEnvelope(event: unknown): event is EventEnvelope<{ readonly text: string }> {
  return (
    typeof event === 'object' &&
    event !== null &&
    'eventType' in event &&
    event.eventType === 'message.received'
  );
}
