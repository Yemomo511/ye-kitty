import { describe, expect, test } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { RxjsEventBus } from './rxjs-event-bus';

describe('RxjsEventBus', () => {
  test('通过 publish 同时驱动 subscribe 和 events$', async () => {
    const eventBus = new RxjsEventBus();
    const receivedByStream = firstValueFrom(
      eventBus.events$.pipe(filter((event) => event.eventType === 'message.received')),
    );

    let receivedBySubscriber = '';
    await eventBus.subscribe<{ readonly text: string }>('message.received', async (event) => {
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
});
