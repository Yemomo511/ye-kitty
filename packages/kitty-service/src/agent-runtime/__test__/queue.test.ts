import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PlatformMessage } from '@kitty/platforms/message';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';
import { AdmissionQueue } from '../queue';

describe('AdmissionQueue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each([
    {
      config: { maxConcurrency: 0, maxQueueSize: 10 },
      errorMessage: 'Agent准入最大并发数必须是正整数',
    },
    {
      config: { maxConcurrency: 2, maxQueueSize: 0 },
      errorMessage: 'Agent准入队列容量必须是正整数',
    },
  ])('拒绝无效准入配置：$errorMessage', ({ config, errorMessage }) => {
    expect(() => new AdmissionQueue(config)).toThrow(errorMessage);
  });

  test('全局最多同时执行两条消息，第三条等待令牌', async () => {
    const queue = new AdmissionQueue({
      maxConcurrency: 2,
      maxQueueSize: 10,
    });
    const gates = [createDeferred(), createDeferred(), createDeferred()];
    const started: string[] = [];
    let activeCount = 0;
    let maxActiveCount = 0;

    const tasks = gates.map((gate, index) =>
      queue.enqueue({
        event: createChatEvent({ index, conversationType: 'private' }),
        mentionsAgent: false,
        async execute() {
          started.push(`task-${index}`);
          activeCount += 1;
          maxActiveCount = Math.max(maxActiveCount, activeCount);
          await gate.promise;
          activeCount -= 1;
        },
      }),
    );

    await waitForAsyncWork();
    expect(started).toEqual(['task-0', 'task-1']);
    expect(maxActiveCount).toBe(2);

    gates[0].resolve();
    await waitForAsyncWork();
    expect(started).toEqual(['task-0', 'task-1', 'task-2']);

    gates[1].resolve();
    gates[2].resolve();
    await expect(Promise.all(tasks)).resolves.toEqual([
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
    ]);
  });

  test('等待消息按私聊、群聊被@、普通群聊和入队顺序执行', async () => {
    const queue = new AdmissionQueue({
      maxConcurrency: 2,
      maxQueueSize: 10,
    });
    const blockerA = createDeferred();
    const blockerB = createDeferred();
    const executionOrder: string[] = [];
    const runningTasks = [
      enqueueBlockedTask(queue, createChatEvent({ index: 100 }), blockerA),
      enqueueBlockedTask(queue, createChatEvent({ index: 101 }), blockerB),
    ];
    await waitForAsyncWork();

    const queuedTasks = [
      enqueueRecordedTask(
        queue,
        createChatEvent({ index: 1 }),
        false,
        '普通群聊-1',
        executionOrder,
      ),
      enqueueRecordedTask(queue, createChatEvent({ index: 2 }), true, '群聊被@-1', executionOrder),
      enqueueRecordedTask(
        queue,
        createChatEvent({ index: 3, conversationType: 'private' }),
        false,
        '私聊-1',
        executionOrder,
      ),
      enqueueRecordedTask(
        queue,
        createChatEvent({ index: 4, conversationType: 'private' }),
        false,
        '私聊-2',
        executionOrder,
      ),
      enqueueRecordedTask(queue, createChatEvent({ index: 5 }), true, '群聊被@-2', executionOrder),
      enqueueRecordedTask(
        queue,
        createChatEvent({ index: 6 }),
        false,
        '普通群聊-2',
        executionOrder,
      ),
    ];

    blockerA.resolve();
    await Promise.all(queuedTasks);
    expect(executionOrder).toEqual([
      '私聊-1',
      '私聊-2',
      '群聊被@-1',
      '群聊被@-2',
      '普通群聊-1',
      '普通群聊-2',
    ]);

    blockerB.resolve();
    await Promise.all(runningTasks);
  });

  test('同一会话严格串行，其他会话可以使用第二个令牌', async () => {
    const queue = new AdmissionQueue({
      maxConcurrency: 2,
      maxQueueSize: 10,
    });
    const firstGate = createDeferred();
    const otherGate = createDeferred();
    const started: string[] = [];
    const firstEvent = createChatEvent({ index: 1, conversationType: 'private' });
    const secondEvent = createChatEvent({
      index: 2,
      conversationType: 'private',
      conversationId: firstEvent.conversationId,
    });

    const firstTask = queue.enqueue({
      event: firstEvent,
      mentionsAgent: false,
      async execute() {
        started.push('同会话-1');
        await firstGate.promise;
      },
    });
    const secondTask = queue.enqueue({
      event: secondEvent,
      mentionsAgent: false,
      async execute() {
        started.push('同会话-2');
      },
    });
    const otherTask = queue.enqueue({
      event: createChatEvent({ index: 3, conversationType: 'private' }),
      mentionsAgent: false,
      async execute() {
        started.push('其他会话');
        await otherGate.promise;
      },
    });

    await waitForAsyncWork();
    expect(started).toEqual(['同会话-1', '其他会话']);

    firstGate.resolve();
    await expect(secondTask).resolves.toEqual({ status: 'completed' });
    expect(started).toEqual(['同会话-1', '其他会话', '同会话-2']);

    otherGate.resolve();
    await Promise.all([firstTask, otherTask]);
  });

  test('等待队列满载时高优先级替换最低级最新消息，同级新消息被拒绝', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const queue = new AdmissionQueue({
      maxConcurrency: 2,
      maxQueueSize: 10,
    });
    const blockerA = createDeferred();
    const blockerB = createDeferred();
    const runningTasks = [
      enqueueBlockedTask(queue, createChatEvent({ index: 100 }), blockerA),
      enqueueBlockedTask(queue, createChatEvent({ index: 101 }), blockerB),
    ];
    await waitForAsyncWork();

    const lowPriorityTasks = Array.from({ length: 10 }, (_, index) =>
      queue.enqueue({
        event: createChatEvent({ index }),
        mentionsAgent: false,
        async execute() {},
      }),
    );
    const privateTask = queue.enqueue({
      event: createChatEvent({ index: 200, conversationType: 'private' }),
      mentionsAgent: false,
      async execute() {},
    });

    await expect(lowPriorityTasks[9]).resolves.toEqual({
      status: 'dropped',
      reason: 'replaced_by_higher_priority',
    });

    const rejectedLowPriorityTask = queue.enqueue({
      event: createChatEvent({ index: 201 }),
      mentionsAgent: false,
      async execute() {},
    });
    await expect(rejectedLowPriorityTask).resolves.toEqual({
      status: 'dropped',
      reason: 'queue_full',
    });

    blockerA.resolve();
    blockerB.resolve();
    await Promise.all([...runningTasks, ...lowPriorityTasks.slice(0, 9), privateTask]);
  });

  test('任务异常后释放全局令牌和会话锁', async () => {
    const queue = new AdmissionQueue({
      maxConcurrency: 1,
      maxQueueSize: 10,
    });
    const failureGate = createDeferred();
    const event = createChatEvent({ index: 1, conversationType: 'private' });
    const started: string[] = [];
    const failedTask = queue.enqueue({
      event,
      mentionsAgent: false,
      async execute() {
        started.push('失败任务');
        await failureGate.promise;
        throw new Error('Agent执行失败');
      },
    });
    const recoveredTask = queue.enqueue({
      event: createChatEvent({
        index: 2,
        conversationType: 'private',
        conversationId: event.conversationId,
      }),
      mentionsAgent: false,
      async execute() {
        started.push('后续任务');
      },
    });

    await waitForAsyncWork();
    expect(started).toEqual(['失败任务']);

    const failureAssertion = expect(failedTask).rejects.toThrow('Agent执行失败');
    failureGate.resolve();
    await failureAssertion;
    await expect(recoveredTask).resolves.toEqual({ status: 'completed' });
    expect(started).toEqual(['失败任务', '后续任务']);
  });
});

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve() {
      resolvePromise?.();
    },
  };
}

function enqueueBlockedTask(queue: AdmissionQueue, event: PlatformMessage, gate: Deferred) {
  return queue.enqueue({
    event,
    mentionsAgent: false,
    async execute() {
      await gate.promise;
    },
  });
}

function enqueueRecordedTask(
  queue: AdmissionQueue,
  event: PlatformMessage,
  mentionsAgent: boolean,
  label: string,
  executionOrder: string[],
) {
  return queue.enqueue({
    event,
    mentionsAgent,
    async execute() {
      executionOrder.push(label);
    },
  });
}

function createChatEvent(options: {
  readonly index: number;
  readonly conversationType?: PlatformMessage['conversationType'];
  readonly conversationId?: PlatformMessage['conversationId'];
}): PlatformMessage {
  const conversationType = options.conversationType ?? 'group';
  return {
    id: `chat-event-${options.index}` as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId:
      options.conversationId ??
      (`qq:conversation:${conversationType}-${options.index}` as ConversationId),
    conversationType,
    senderId: `qq:participant:${options.index}` as ParticipantId,
    message: {
      id: `message-${options.index}` as MessageId,
      type: 'text',
      text: `消息${options.index}`,
      mentions: [],
    },
    receivedAt: new Date('2026-07-14T00:00:00.000Z'),
  };
}

function waitForAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
