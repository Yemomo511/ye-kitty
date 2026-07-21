import { describe, expect, test, vi } from 'vitest';
import type { XiaohongshuMessage } from '@kitty/platforms/xiaohongshu/event';
import { XiaohongshuMentionSource } from './source';
import type { XiaohongshuMentionPage } from './message';

describe('小红书被提及信息源', () => {
  test('首次只建立基线，后续新提醒按时间顺序广播并去重', async () => {
    const pages: XiaohongshuMentionPage[] = [
      createPage(['old-2', 'old-1']),
      createPage(['new-2', 'new-1', 'old-2']),
      createPage(['new-2', 'new-1', 'old-2']),
    ];
    const reader = { listMentions: vi.fn(async () => pages.shift() ?? createPage([])) };
    const repository = createRepository();
    const source = new XiaohongshuMentionSource({
      reader,
      checkpointRepository: repository,
      pollIntervalMs: 30_000,
      maxBackoffMs: 120_000,
      schedule: vi.fn(() => createTimerHandle()),
      cancelSchedule: vi.fn(),
    });
    const events: XiaohongshuMessage[] = [];
    await source.subscribe(async (event) => {
      events.push(event);
    });

    await source.pollNow();
    expect(events).toEqual([]);
    expect(repository.save).toHaveBeenLastCalledWith({
      initialized: true,
      recentMentionIds: ['old-2', 'old-1'],
    });

    await source.pollNow();
    await source.pollNow();
    expect(events.map((event) => event.mentionId)).toEqual(['new-1', 'new-2']);
    expect(events.every((event) => event.platform === 'xiaohongshu')).toBe(true);
  });

  test('恢复持久化检查点后只广播未见提醒', async () => {
    const repository = createRepository({ initialized: true, recentMentionIds: ['known'] });
    const source = new XiaohongshuMentionSource({
      reader: { listMentions: vi.fn(async () => createPage(['new', 'known'])) },
      checkpointRepository: repository,
      pollIntervalMs: 30_000,
      maxBackoffMs: 120_000,
      schedule: vi.fn(() => createTimerHandle()),
      cancelSchedule: vi.fn(),
    });
    const events: XiaohongshuMessage[] = [];
    await source.subscribe(async (event) => {
      events.push(event);
    });

    await source.start();
    await source.stop();

    expect(events.map((event) => event.mentionId)).toEqual(['new']);
  });

  test('失败指数退避且停止后不再调度', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const timerHandle = createTimerHandle();
    const schedule = vi.fn(() => timerHandle);
    const cancelSchedule = vi.fn();
    const reader = { listMentions: vi.fn(async () => Promise.reject(new Error('上游超时'))) };
    const source = new XiaohongshuMentionSource({
      reader,
      checkpointRepository: createRepository(),
      pollIntervalMs: 30_000,
      maxBackoffMs: 120_000,
      schedule,
      cancelSchedule,
    });

    await source.start();
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
    await source.pollNow();
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 120_000);

    await source.stop();
    expect(cancelSchedule).toHaveBeenCalledWith(timerHandle);
    const scheduleCount = schedule.mock.calls.length;
    await source.pollNow();
    expect(schedule).toHaveBeenCalledTimes(scheduleCount);
  });

  test('调度回调继续轮询，重复启停保持幂等', async () => {
    let scheduledHandler: (() => void) | undefined;
    const reader = { listMentions: vi.fn(async () => createPage([])) };
    const source = new XiaohongshuMentionSource({
      reader,
      checkpointRepository: createRepository(),
      pollIntervalMs: 30_000,
      maxBackoffMs: 120_000,
      schedule: vi.fn((handler) => {
        scheduledHandler = handler;
        return createTimerHandle();
      }),
      cancelSchedule: vi.fn(),
    });

    await source.start();
    await source.start();
    scheduledHandler?.();
    await vi.waitFor(() => expect(reader.listMentions).toHaveBeenCalledTimes(2));
    await source.stop();
    await source.stop();
  });

  test('缺失可选字段时使用标题、匿名发件人并保留可用来源', async () => {
    const repository = createRepository({ initialized: true, recentMentionIds: [] });
    const source = new XiaohongshuMentionSource({
      reader: {
        listMentions: vi.fn(async () => ({
          mentions: [
            {
              id: 'minimal',
              title: '后备标题',
              content: '',
              commentId: 'comment-minimal',
              url: 'https://www.xiaohongshu.com/notification',
            },
          ],
          hasMore: false,
        })),
      },
      checkpointRepository: repository,
      pollIntervalMs: 30_000,
      maxBackoffMs: 120_000,
      schedule: vi.fn(() => createTimerHandle()),
      cancelSchedule: vi.fn(),
      now: () => new Date('2026-07-16T00:00:00.000Z'),
    });
    const events: XiaohongshuMessage[] = [];
    await source.subscribe(async (event) => {
      events.push(event);
    });

    await source.pollNow();

    expect(events[0]).toMatchObject({
      senderId: 'xiaohongshu:participant:unknown:minimal',
      content: '后备标题',
      source: {
        commentId: 'comment-minimal',
        url: 'https://www.xiaohongshu.com/notification',
      },
      receivedAt: new Date('2026-07-16T00:00:00.000Z'),
    });
    expect(events[0]).not.toHaveProperty('senderDisplayName');
    expect(events[0]).not.toHaveProperty('occurredAt');
  });
});

function createPage(ids: readonly string[]): XiaohongshuMentionPage {
  return {
    mentions: ids.map((id, index) => ({
      id,
      actorId: `actor-${id}`,
      actorDisplayName: `用户${id}`,
      title: '提到了你',
      content: `内容${id}`,
      noteId: `note-${id}`,
      occurredAt: new Date(1_700_000_000_000 + index),
    })),
    hasMore: false,
  };
}

function createTimerHandle(): ReturnType<typeof setTimeout> {
  return {} as ReturnType<typeof setTimeout>;
}

function createRepository(initial?: { initialized: boolean; recentMentionIds: string[] }) {
  let state = initial;
  return {
    load: vi.fn(async () => state),
    save: vi.fn(async (nextState) => {
      state = nextState;
    }),
  };
}
