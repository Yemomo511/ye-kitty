/**
 * Code Agent 失败分类器
 *
 * 对照 open-design run-failure-classification.ts（11 类 30+ 正则模式），
 * 本实现覆盖 MVP 9 类失败码。
 * 通用认证正则抄 open-design runtimes/auth.ts:206-267。
 */

import type { CodeAgentFailure } from './failure';
import { FAILURE_RETRYABLE } from './failure';

/** 分类器输入 */
export interface ClassifyInput {
  /** 子进程退出码（null = 被信号/强制终止） */
  readonly exitCode: number | null;
  /** 是否被 kill(SIGTERM/taskkill) 终止 */
  readonly killed: boolean;
  /** 是否被定时器取消（取消/kill 不属错误） */
  readonly cancelRequested: boolean;
  /** stderr 尾部（最多 20 行） */
  readonly stderrTail: string;
  /** 当前阶段 */
  readonly phase: 'spawning' | 'running' | 'terminating';
  /** 超时类型 */
  readonly timedOutKind?: 'inactivity' | 'session' | 'queue';
}

// ---- 通用认证失败正则（抄 open-design auth.ts:206-267） ----

const AUTH_FAILURE_RE =
  /(?:invalid.*(?:api[ -]?key|token|credential|auth)|not\s+logged\s+in|unauthorized|401|403|forbidden\b|auth.*fail|login.*fail|credential.*invalid|apikey.*invalid|api_key.*invalid|insufficient[_\s]permission|access[_\s]denied)/i;
const RATE_FAILURE_RE =
  /(?:rate[_\s]limit|too\s+many\s+requests|429|quota\s+exceed|billing|insufficient[_\s]quota|billing\s+not\s+active|usage\s+limit)/i;
// ---- 子进程退出码通用噪声跳过行 ----

const NOISE_LINES_RE =
  /(?:^\s*$|^\s*at\s+|debug:|info\b|trace:|sqlite|migration|listening|deprecation|notice:|warn(?:ing)?\b)/i;

/**
 * 分类子进程结果。
 */
export function classifyFailure(input: ClassifyInput): CodeAgentFailure {
  const { exitCode, killed, cancelRequested, stderrTail, phase, timedOutKind } = input;

  // 1. 取消优先于所有分类
  if (cancelRequested) {
    return {
      code: 'process_exit',
      message: '会话被取消',
      retryable: false,
      detail: stderrTail.slice(-500) || undefined,
    };
  }

  // 2. 超时分类
  if (timedOutKind === 'inactivity') {
    return {
      code: 'inactivity_timeout',
      message: '子进程无输出超时（inactivity timeout）',
      retryable: FAILURE_RETRYABLE.inactivity_timeout,
    };
  }
  if (timedOutKind === 'session') {
    return {
      code: 'session_timeout',
      message: '会话总时长超限（session timeout）',
      retryable: FAILURE_RETRYABLE.session_timeout,
    };
  }
  if (timedOutKind === 'queue') {
    return {
      code: 'queue_timeout',
      message: '任务排队超时，未获得执行槽位',
      retryable: FAILURE_RETRYABLE.queue_timeout,
    };
  }

  // 3. spawn 阶段失败
  if (phase === 'spawning') {
    if (killed) {
      return {
        code: 'spawn_failure',
        message: '子进程启动被操作系统终止',
        retryable: false,
        detail: stderrTail.slice(-500) || undefined,
      };
    }
    return {
      code: 'spawn_failure',
      message: `子进程启动失败（exit ${exitCode}）`,
      retryable: false,
      detail: stderrTail.slice(-500) || undefined,
    };
  }

  // 4. 强制终止
  if (killed) {
    return {
      code: 'process_exit',
      message: '子进程被强制终止',
      retryable: false,
      detail: stderrTail.slice(-500) || undefined,
    };
  }

  // 5. stderr 内容分析
  const relevantStderr = filterNoise(stderrTail);

  if (AUTH_FAILURE_RE.test(relevantStderr)) {
    return {
      code: 'auth_failure',
      message: 'Agent CLI 认证失败（未登录或凭据无效）',
      retryable: false,
      detail: relevantStderr.slice(-500),
    };
  }

  if (RATE_FAILURE_RE.test(relevantStderr)) {
    return {
      code: 'auth_failure', // 限流归入认证类（需用户手动处理配额）
      message: 'API 配额不足或限流',
      retryable: false,
      detail: relevantStderr.slice(-500),
    };
  }

  // 6. 正常退出（exit 0）
  if (exitCode === 0) {
    return {
      code: 'process_exit',
      message: '子进程异常退出（exit 0 但引擎判定失败，可能是流解析异常）',
      retryable: false,
      detail: relevantStderr.slice(-500) || undefined,
    };
  }

  // 7. 非零退出 → 通用错误
  return {
    code: 'process_exit',
    message: `子进程异常退出（exit ${exitCode}）`,
    retryable: false,
    detail: relevantStderr.slice(-500),
  };
}

/** 从 stderr 中过滤噪音行 */
function filterNoise(stderrText: string): string {
  if (!stderrText) return '';
  const lines = stderrText.split('\n');
  const relevant = lines.filter((line) => !NOISE_LINES_RE.test(line));
  // 如果有足够多的非噪音行，只返回它们；否则返回所有内容
  if (relevant.length >= 3) return relevant.join('\n');
  return stderrText;
}

/**
 * 连续解析失败 → protocol_mismatch
 *
 * adapter 连续 N 行解析失败时触发。
 */
export function classifyProtocolMismatch(failedCount: number): CodeAgentFailure {
  return {
    code: 'protocol_mismatch',
    message: `连续 ${failedCount} 行解析失败，CLI 协议可能已变更`,
    retryable: FAILURE_RETRYABLE.protocol_mismatch,
  };
}

/** workspace 相关失败 */
export function classifyWorkspaceFailure(reason: string): CodeAgentFailure {
  return {
    code: 'workspace_failure',
    message: `工作区不可用: ${reason}`,
    retryable: false,
    detail: reason,
  };
}

/** pipe_broken */
export function classifyPipeBroken(sessionId: string, cause?: string): CodeAgentFailure {
  return {
    code: 'pipe_broken',
    message: `会话 ${sessionId} stdin 管道断开`,
    retryable: false,
    detail: cause,
  };
}
