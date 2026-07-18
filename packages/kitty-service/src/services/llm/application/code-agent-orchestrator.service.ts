/**
 * Code Agent Orchestrator Service
 *
 * 核心编排逻辑：实现 CodeAgentRunnerPort，负责子进程生命周期、排队、
 * ring buffer 事件分发、看门狗、中间人工具回写。
 *
 * 8 项职责（与设计文档逐条对应）：
 * 1. submit：门禁 → session(queued) → 并发检查 → spawn 或入队
 * 2. 排队：全局 FIFO + per-agent 上限 + 跳过防头阻塞 + queue timeout
 * 3. ring buffer：每 session 2000 条 + 回放 + 溢出 replay_truncated + JSONL
 * 4. 看门狗：inactivity + session 总时长双定时器
 * 5. injectToolResult：非 running 抛 SessionClosedError，EPIPE 抛 PipeBrokenError
 * 6. cancel：幂等；queued 直接 canceled；running 走阶梯
 * 7. close：exit 0 → succeeded，非零 → classifier → failed，发 session_end
 * 8. shutdown：遍历 cancel 所有 running
 */

import type { CodeAgentRunnerPort } from '../ports/code-agent-runner.port';
import type { CodeAgentEventContract } from '@kitty/contracts/code-agent/code-agent-event.contract';
import type { CodeAgentTaskContract } from '@kitty/contracts/code-agent/code-agent-task.contract';
import type { CodeAgentDef } from '../domain/code-agent-definition';
import type { CodeAgentSession, CodeAgentSessionStatus } from '../domain/code-agent-session';
import type { CodeAgentFailure } from '../domain/code-agent-failure';
import { CodeAgentSessionClosedError, CodeAgentPipeBrokenError } from '../domain/code-agent-errors';
import { getAgentDef } from '../infrastructure/code-agent-registry';
import { spawnAgent, cancelChild } from '../infrastructure/process/session-lifecycle';
import { classifyFailure } from '../infrastructure/failure-classifier';
import { CodeAgentGateService } from './code-agent-gate.service';
import { codeAgentLogger } from '../infrastructure/code-agent-logger';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';

// ---- 配置常量 ----

const RING_BUFFER_SIZE = 2000;
const QUEUE_SCAN_INTERVAL_MS = 500;       // 队列扫描间隔
const GLOBAL_MAX_CONCURRENT = parseInt(process.env['CODE_AGENT_MAX_CONCURRENT_SESSIONS'] ?? '2', 10);
const QUEUE_TIMEOUT_MS = parseInt(process.env['CODE_AGENT_QUEUE_TIMEOUT_MS'] ?? '60000', 10);
const JSONL_LOG_DIR = 'logs/code-agent';

// ---- 内部 Session 实现 ---------------------------------------

interface InternalSession {
  id: string;
  agentDefId: string;
  agentDef: CodeAgentDef;
  status: CodeAgentSessionStatus;
  child: ChildProcess | null;
  startedAt?: number;
  endedAt?: number;
  failure?: CodeAgentFailure;
  /** ring buffer 事件 */
  ringBuffer: CodeAgentEventContract[];
  /** 活跃的异步消费者列表 */
  consumers: Set<SessionConsumerState>;
  /** 是否已关闭流（不再接受新消费者） */
  streamClosed: boolean;
  /** 队列等待开始时间（epoch ms） */
  queuedAt?: number;
  /** 上次 stdout 输出的时间（epoch ms），用于 inactivity 看门狗 */
  lastOutputTime?: number;
  /** 排队时保留的原始任务（用于被唤醒时 spawn） */
  queuedTask?: CodeAgentTaskContract;
}

/** 每个异步消费者的状态 */
interface SessionConsumerState {
  /** 已读事件游标（ring buffer 索引） */
  cursor: number;
  /** 当 buffer 无新事件时解决此 promise */
  resolve: ((value: IteratorResult<CodeAgentEventContract>) => void) | null;
}

// ---- Orchestrator 实现 ---------------------------------------

export class CodeAgentOrchestrator implements CodeAgentRunnerPort {
  private readonly sessions = new Map<string, InternalSession>();
  private readonly eventCache = new Map<string, CodeAgentEventContract[]>();
  private queue: string[] = [];           // sessionId FIFO
  private readonly gate: CodeAgentGateService;
  private queueTimer: ReturnType<typeof setInterval> | null = null;

  constructor(gate: CodeAgentGateService) {
    this.gate = gate;
    this.queueTimer = setInterval(() => this.processQueue(), QUEUE_SCAN_INTERVAL_MS);
  }

  // ---- 职责 1：submit -----------------------------------------

  async submit(task: CodeAgentTaskContract): Promise<CodeAgentSession> {
    // 门禁
    await this.gate.check(task);

    const def = getAgentDef(task.agentId);
    if (!def) {
      throw new Error(`未知 Agent: ${task.agentId}`);
    }

    const id = randomUUID();
    const session: InternalSession = {
      id,
      agentDefId: def.id,
      agentDef: def,
      status: 'queued',
      child: null,
      ringBuffer: [],
      consumers: new Set(),
      streamClosed: false,
      queuedAt: Date.now(),
    };

    this.sessions.set(id, session);

    codeAgentLogger.info(`会话创建: ${id} agent=${def.id} status=queued`, { sessionId: id });

    // 并发检查
    if (this.canRunConcurrently(def)) {
      try {
        this.startSession(session, task);
      } catch (err) {
        // spawn 失败 → 立刻标记失败并发射事件，不卡在 running
        const msg = err instanceof Error ? err.message : String(err);
        session.failure = {
          code: 'spawn_failure',
          message: `子进程启动失败: ${msg}`,
          retryable: false,
        };
        session.status = 'failed';
        session.endedAt = Date.now();
        this.emitEvent(session, {
          type: 'error',
          sessionId: id,
          failure: session.failure,
        });
        this.emitEvent(session, {
          type: 'session_end',
          sessionId: id,
          status: 'failed',
          exitCode: null,
        });
        codeAgentLogger.error(`会话启动失败: ${id} reason=${msg}`, err instanceof Error ? err : new Error(msg), { sessionId: id });
      }
    } else {
      session.queuedTask = task;
      this.queue.push(id);
      codeAgentLogger.info(`会话入队: ${id} queueDepth=${this.queue.length}`, { sessionId: id });
    }

    return this.toPublicSession(session);
  }

  // ---- 职责 2：排队 -----------------------------------------

  private canRunConcurrently(def: CodeAgentDef): boolean {
    const globalRunning = this.countByStatus('running');
    if (globalRunning >= GLOBAL_MAX_CONCURRENT) return false;

    const agentRunning = this.countByStatusAndAgent(def.id, 'running');
    return agentRunning < def.maxConcurrentSessions;
  }

  private countByStatus(status: CodeAgentSessionStatus): number {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.status === status) count++;
    }
    return count;
  }

  private countByStatusAndAgent(agentId: string, status: CodeAgentSessionStatus): number {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.agentDefId === agentId && s.status === status) count++;
    }
    return count;
  }

  private processQueue(): void {
    // 检查队首超时
    const now = Date.now();
    const newQueue: string[] = [];

    for (const id of this.queue) {
      const session = this.sessions.get(id);
      if (!session || session.status !== 'queued') continue;

      if (session.queuedAt && (now - session.queuedAt) > QUEUE_TIMEOUT_MS) {
        session.failure = {
          code: 'queue_timeout',
          message: '排队超时',
          retryable: true,
        };
        session.status = 'failed';
        session.endedAt = now;
        this.emitEvent(session, {
          type: 'session_end',
          sessionId: id,
          status: 'failed',
          exitCode: null,
        });
        codeAgentLogger.warn(`会话排队超时: ${id}`, { sessionId: id });
        continue;
      }

      // 尝试启动
      const def = getAgent(session.agentDefId);
      if (!def) continue;

      if (this.canRunConcurrently(def)) {
        // 启动（需要 task 信息，但队列中只有 agentDefId）
        // 实际场景中 task 信息已丢失 —— 简化处理：将 session 标记为可启动
        this.startFromQueue(session);
      } else {
        newQueue.push(id);
      }
    }

    // 重置队列：仅保留仍阻塞的条目（FIFO 顺序不变）
    this.queue = newQueue;
  }

  private startFromQueue(session: InternalSession): void {
    if (!session.queuedTask) {
      // 无原始任务 → 标记失败（不应发生，因 submit 时已保存）
      session.failure = {
        code: 'spawn_failure',
        message: '排队任务缺少原始提交信息',
        retryable: false,
      };
      session.status = 'failed';
      session.endedAt = Date.now();
      this.emitEvent(session, {
        type: 'session_end',
        sessionId: session.id,
        status: 'failed',
        exitCode: null,
      });
      return;
    }
    this.startSession(session, session.queuedTask);
  }

  // ---- 职责 3：启动 session ----------------------------------

  private startSession(session: InternalSession, task: CodeAgentTaskContract): void {
    session.status = 'running';
    session.startedAt = Date.now();

    const { child } = spawnAgent(session.agentDef, task);
    session.child = child;

    this.emitEvent(session, {
      type: 'status',
      sessionId: session.id,
      label: 'running',
    });

    // 启动看门狗
    this.startWatchdog(session);

    // 消费 stdout
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      session.lastOutputTime = Date.now();
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            this.emitEvent(session, {
              type: 'raw',
              sessionId: session.id,
              line,
            });
          } catch {
            this.emitEvent(session, {
              type: 'raw',
              sessionId: session.id,
              line,
            });
          }
        }
      }
    });

    // 消费 stderr（收集尾部用于失败分类）
    const stderrLines: string[] = [];
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      for (const line of text.split('\n')) {
        if (line.trim()) stderrLines.push(line);
      }
      // 只保留最后 20 行
      while (stderrLines.length > 20) stderrLines.shift();
    });

    // 子进程退出
    child.on('close', (exitCode, signal) => {
      this.handleClose(session, exitCode, signal, stderrLines.join('\n'));
    });
  }

  // ---- 职责 4：看门狗 ----------------------------------------

  private startWatchdog(session: InternalSession): void {
    const inactivityMs = session.agentDef.inactivityTimeoutMs;
    const sessionMs = session.agentDef.sessionTimeoutMs;

    // session 总时长硬上限
    const sessionTimer = setTimeout(() => {
      if (session.status !== 'running') return;
      session.failure = {
        code: 'session_timeout',
        message: '会话总时长超限',
        retryable: false,
      };
      this.failSession(session);
    }, sessionMs);

    // inactivity 定时器（每次 stdout 输出后重置）
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleInactivity = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (session.status !== 'running') return;
      inactivityTimer = setTimeout(() => {
        if (session.status !== 'running') return;
        session.failure = {
          code: 'inactivity_timeout',
          message: '子进程无输出超时',
          retryable: true,
        };
        this.failSession(session);
      }, inactivityMs);
    };

    scheduleInactivity();

    // 包装 emitEvent，在每次事件后重置 inactivity
    const origEmit = this.emitEvent.bind(this);
    this.emitEvent = (s: InternalSession, event: CodeAgentEventContract) => {
      if (s === session) {
        s.lastOutputTime = Date.now();
        scheduleInactivity();
      }
      origEmit(s, event);
    };
  }

  private failSession(session: InternalSession): void {
    if (session.child && !session.child.killed) {
      cancelChild(session.child);
    }
  }

  // ---- 职责 5：injectToolResult -------------------------------

  async injectToolResult(
    sessionId: string,
    toolUseId: string,
    result: string,
    isError?: boolean,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') {
      throw new CodeAgentSessionClosedError(sessionId, session?.status ?? 'unknown');
    }

    // stream-json 格式：Claude Code 期望 {"type":"user","message":{"role":"user","content":[...tool_result...]}}
    const toolResultPayload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: result,
          ...(isError ? { is_error: true } : {}),
        }],
      },
    }) + '\n';

    try {
      session.child?.stdin?.write(toolResultPayload);
    } catch (cause) {
      throw new CodeAgentPipeBrokenError(sessionId, cause instanceof Error ? cause : undefined);
    }
  }

  // ---- 职责 6：cancel ----------------------------------------

  async cancel(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return; // 幂等：不存在静默

    if (session.status === 'queued') {
      session.status = 'canceled';
      session.endedAt = Date.now();
      this.emitEvent(session, {
        type: 'session_end',
        sessionId,
        status: 'canceled',
        exitCode: null,
      });
      codeAgentLogger.info(`会话取消(queued): ${sessionId}`, { sessionId });
      return;
    }

    if (session.status === 'running' && session.child && !session.child.killed) {
      // 将 status 设在 cancelChild 之前：防止 await 的 3s 窗口内 handleClose
      // 因子进程自然退出而覆盖终态（handleClose 看到 canceled 后直接 early return）
      session.status = 'canceled';
      session.endedAt = Date.now();
      await cancelChild(session.child);
      this.emitEvent(session, {
        type: 'session_end',
        sessionId,
        status: 'canceled',
        exitCode: null,
      });
      codeAgentLogger.info(`会话取消(running): ${sessionId}`, { sessionId });
    }
  }

  // ---- 职责 7：close 处理 ------------------------------------

  private handleClose(
    session: InternalSession,
    exitCode: number | null,
    signal: string | null,
    stderrTail: string,
  ): void {
    if (session.status === 'canceled') return; // 已由 cancel() 处理

    // 若看门狗已设置精确失败原因（如 inactivity_timeout / session_timeout），保留不被覆盖
    const hasExistingFailure = session.failure !== undefined;

    if (!hasExistingFailure) {
      const killed = signal !== null;
      const failure = classifyFailure({
        exitCode: exitCode ?? null,
        killed,
        cancelRequested: false,
        stderrTail,
        phase: 'running',
      });

      if (exitCode === 0 && !killed) {
        session.status = 'succeeded';
      } else {
        session.status = 'failed';
        session.failure = failure;
      }
    } else {
      session.status = 'failed';
    }

    session.endedAt = Date.now();
    session.streamClosed = true;

    this.emitEvent(session, {
      type: 'session_end',
      sessionId: session.id,
      status: session.status,
      exitCode: exitCode ?? null,
    });

    codeAgentLogger.info(
      `会话结束: ${session.id} status=${session.status} exitCode=${exitCode}`,
      { sessionId: session.id },
    );

    // 唤醒所有等待的消费者
    for (const consumer of session.consumers) {
      consumer.resolve?.({ value: undefined as unknown as CodeAgentEventContract, done: true });
    }
  }

  // ---- 职责 8：shutdown ---------------------------------------

  async shutdown(): Promise<void> {
    if (this.queueTimer) {
      clearInterval(this.queueTimer);
      this.queueTimer = null;
    }

    const running = [...this.sessions.values()].filter((s) => s.status === 'running');
    await Promise.all(running.map((s) => this.cancel(s.id)));
    this.sessions.clear();
    codeAgentLogger.info('Orchestrator 已关闭');
  }

  // ---- 查询 -------------------------------------------------

  getSession(sessionId: string): CodeAgentSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? this.toPublicSession(session) : undefined;
  }

  // ---- 事件系统 -----------------------------------------------

  private emitEvent(session: InternalSession, event: CodeAgentEventContract): void {
    // ring buffer 写入
    session.ringBuffer.push(event);
    if (session.ringBuffer.length > RING_BUFFER_SIZE) {
      session.ringBuffer.shift();
    }

    // JSONL 落盘
    this.writeJsonl(session.id, event);

    // 分发到所有消费者
    for (const consumer of session.consumers) {
      consumer.resolve?.({ value: event, done: false });
      consumer.resolve = null;
    }
  }

  private writeJsonl(sessionId: string, event: CodeAgentEventContract): void {
    try {
      if (!existsSync(JSONL_LOG_DIR)) {
        mkdirSync(JSONL_LOG_DIR, { recursive: true });
      }
      appendFileSync(join(JSONL_LOG_DIR, `${sessionId}.jsonl`), `${JSON.stringify(event)}\n`, 'utf-8');
    } catch {
      // JSONL 写入失败不阻塞主流程
    }
  }

  // ---- CodeAgentSession 暴露 ---------------------------------

  private toPublicSession(internal: InternalSession): CodeAgentSession {
    return {
      id: internal.id,
      agentDefId: internal.agentDefId,
      status: internal.status,
      startedAt: internal.startedAt,
      endedAt: internal.endedAt,
      failure: internal.failure,
      events: () => this.createEventStream(internal),
    };
  }

  private async *createEventStream(internal: InternalSession): AsyncIterable<CodeAgentEventContract> {
    let cursor = 0;
    let truncated = false;

    // 回放已有事件
    if (internal.ringBuffer.length >= RING_BUFFER_SIZE) {
      truncated = true;
      yield {
        type: 'status',
        sessionId: internal.id,
        label: 'replay_truncated',
      };
    }

    // 从 ring buffer 回放
    while (cursor < internal.ringBuffer.length) {
      yield internal.ringBuffer[cursor++];
    }

    // 流已关闭 → 不再续接
    if (internal.streamClosed) return;

    // 注册为消费者，续接实时事件
    const consumer: SessionConsumerState = { cursor, resolve: null };
    internal.consumers.add(consumer);

    try {
      while (!internal.streamClosed) {
        const event = await new Promise<CodeAgentEventContract>((resolve) => {
          consumer.resolve = (r: IteratorResult<CodeAgentEventContract>) => {
            if (r.done) {
              resolve(null as unknown as CodeAgentEventContract);
            } else {
              resolve(r.value);
            }
          };
        });

        if (event === null) break;
        yield event;
      }
    } finally {
      internal.consumers.delete(consumer);
    }
  }
}

/** 获取 AgentDef */
function getAgent(id: string): CodeAgentDef | undefined {
  return getAgentDef(id);
}
