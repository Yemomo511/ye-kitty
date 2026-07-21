/**
 * Code Agent 会话
 *
 * 会话状态机：queued → running → succeeded / failed / canceled（queued 也可直接 → canceled）。
 * ring buffer 由 CodeAgent 持有，本文件只定义事件流读取接口。
 */

import type { CodeAgentEvent } from '@kitty/agent-runtime/lm/code-agent/event';
import type { CodeAgentFailure } from './failure';

/** 会话状态 */
export type CodeAgentSessionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

/**
 * 事件流读取器接口
 *
 * CodeAgent 的 ring buffer 实现此接口。
 * 多消费者：每次调用 events() 返回独立游标，各自回放 + 续接，互不瓜分事件。
 */
export interface EventStreamReader {
  /** 先回放已有事件（可能空），再阻塞续接实时事件，直到 session_end */
  read(): AsyncIterable<CodeAgentEvent>;
}

/** 会话句柄 */
export interface CodeAgentSession {
  /** 会话 ID（llm 生成 uuid，与 agent 内部 sessionId 分离） */
  readonly id: string;
  /** 关联的 AgentDef ID */
  readonly agentDefId: string;
  /** 当前状态 */
  readonly status: CodeAgentSessionStatus;
  /**
   * 事件流。
   *
   * queued 状态即可订阅：先回放已有事件（可能空），再阻塞续接直到 session_end。
   * 多次调用返回独立游标，互不瓜分事件。
   * 回放只保证 ring buffer 内最近 2000 条；溢出时回放流第一个事件为
   * { type: 'status', label: 'replay_truncated' }。
   * 背压是消费者的责任，断连不阻塞子进程。
   */
  events(): AsyncIterable<CodeAgentEvent>;
  /** 会话启动时间（epoch ms），queued 状态为 undefined */
  readonly startedAt?: number;
  /** 会话结束时间（epoch ms），终态之前为 undefined */
  readonly endedAt?: number;
  /** 失败详情（status=failed 时非空） */
  readonly failure?: CodeAgentFailure;
}
