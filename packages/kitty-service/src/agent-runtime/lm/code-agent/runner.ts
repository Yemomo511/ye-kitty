/**
 * Code Agent运行能力
 *
 * 智能供应端的低级抽象：启动 agent 子进程并获得事件流。
 * 向 Tool 和本地控制入口提供统一的会话执行接口。
 */

import type { CodeAgentSession } from './session';
import type { CodeAgentTask } from '@kitty/agent-runtime/lm/code-agent/task';

export interface CodeAgentRunner {
  /**
   * 提交任务。
   *
   * 门禁拒绝时抛 CodeAgentGateRejectedError。
   * session 创建即 queued（若并发超限），否则立即 spawn。
   */
  submit(task: CodeAgentTask): Promise<CodeAgentSession>;

  /**
   * 查询 session（不存在返回 undefined）。
   *
   * 用于监控/恢复场景。
   */
  getSession(sessionId: string): CodeAgentSession | undefined;

  /**
   * 取消会话。
   *
   * 幂等：不存在或已结束静默返回。
   * queued 状态直接置 canceled 不 spawn。
   * running 状态走阶梯取消。
   */
  cancel(sessionId: string): Promise<void>;

  /**
   * 中间人模式回写通道。
   *
   * 外层 Agent 执行完工具后将结果注回子进程 stdin。
   *
   * 会 reject：
   * - session 非 running 时抛 CodeAgentSessionClosedError
   * - stdin 写入失败（EPIPE）时抛 CodeAgentPipeBrokenError
   */
  injectToolResult(
    sessionId: string,
    toolUseId: string,
    result: string,
    isError?: boolean,
  ): Promise<void>;

  /** 优雅关闭：cancel 所有 running session */
  shutdown(): Promise<void>;
}
