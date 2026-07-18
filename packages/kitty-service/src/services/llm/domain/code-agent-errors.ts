/**
 * Code Agent 错误类
 *
 * 用于端口契约中的异常语义：
 * - CodeAgentGateRejectedError：submit 时门禁 Hook 拒绝
 * - CodeAgentSessionClosedError：injectToolResult 时 session 非 running
 * - CodeAgentPipeBrokenError：injectToolResult 时 stdin EPIPE（子进程已死）
 */

/** 门禁拒绝错误 */
export class CodeAgentGateRejectedError extends Error {
  public readonly cause: string;

  constructor(reason: string) {
    super(`任务被门禁拒绝: ${reason}`);
    this.name = 'CodeAgentGateRejectedError';
    this.cause = reason;
  }
}

/** 会话已关闭错误（injectToolResult 时 session 非 running 状态） */
export class CodeAgentSessionClosedError extends Error {
  public readonly sessionId: string;
  public readonly currentStatus: string;

  constructor(sessionId: string, currentStatus: string) {
    super(`会话 ${sessionId} 已关闭（状态: ${currentStatus}），无法注入工具结果`);
    this.name = 'CodeAgentSessionClosedError';
    this.sessionId = sessionId;
    this.currentStatus = currentStatus;
  }
}

/** 管道断开错误（stdin 写入失败，子进程已死） */
export class CodeAgentPipeBrokenError extends Error {
  public readonly sessionId: string;

  constructor(sessionId: string, cause?: Error) {
    super(`会话 ${sessionId} 的 stdin 管道已断开（子进程可能已退出）`);
    this.name = 'CodeAgentPipeBrokenError';
    this.sessionId = sessionId;
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}
