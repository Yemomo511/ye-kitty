/**
 * Code Agent 失败分类
 *
 * 9 类失败码及其 retryable 标记。
 * 对照 open-design run-failure-classification.ts / run-result.ts:31-49 的 error code 回退链模式。
 */

import type { FailureCode } from '@kitty/contracts/code-agent/code-agent-event.contract';

export type { FailureCode } from '@kitty/contracts/code-agent/code-agent-event.contract';

/** 结构化失败信息 */
export interface CodeAgentFailure {
  readonly code: FailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly detail?: string;
}

/** 每类失败码的 retryable 常量表（与 failure-classifier 输出保持一致） */
export const FAILURE_RETRYABLE: Record<FailureCode, boolean> = {
  spawn_failure: false,
  auth_failure: false,
  inactivity_timeout: true,
  session_timeout: false,
  process_exit: false,
  protocol_mismatch: false,
  workspace_failure: false,
  pipe_broken: false,
  queue_timeout: true,
};
