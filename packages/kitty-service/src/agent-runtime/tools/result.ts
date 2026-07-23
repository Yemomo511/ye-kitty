import type { SkillContent, SkillReferenceContent } from '../skills';

/** 工具风险等级。 */
export type ToolRisk = 'low' | 'medium' | 'high';

/** 工具来源。 */
export type ToolSource = 'builtin' | 'skill' | 'code' | 'mcp' | 'finish';

/** 审批模式。 */
export type ToolApproval = 'never' | 'required';

/** 系统维护的工具策略。 */
export interface ToolPolicy {
  /** 能力来源 */
  readonly source: ToolSource;
  /** 风险等级 */
  readonly risk: ToolRisk;
  /** 审批模式 */
  readonly approval: ToolApproval;
  /** 执行超时毫秒 */
  readonly timeoutMs: number;
  /** 是否消耗普通工具预算 */
  readonly consumesBudget?: boolean;
}

/** 系统允许的Skill状态变更。 */
export type ToolEffect =
  | { readonly type: 'enable_skill'; readonly skill: SkillContent }
  | { readonly type: 'load_skill_reference'; readonly reference: SkillReferenceContent };

/** 工具实现返回值。 */
export interface ToolExecutionOutput {
  /** 是否成功 */
  readonly success: boolean;
  /** 面向运行时的结果摘要 */
  readonly summary: string;
  /** 完整结构化结果 */
  readonly data?: unknown;
  /** 内部错误 */
  readonly error?: string;
  /** 模型是否适合调整后重试 */
  readonly retryable?: boolean;
  /** 受控状态变更 */
  readonly effects?: readonly ToolEffect[];
}

/** 工具授权结果。 */
export type ToolAuthorization =
  | { readonly status: 'allowed' }
  | { readonly status: 'denied' | 'review'; readonly reason: string };

/** 工具授权输入。 */
export interface ToolAuthorizationRequest {
  /** 注册名称 */
  readonly name: string;
  /** 系统策略 */
  readonly policy: ToolPolicy;
  /** 已校验输入 */
  readonly input: unknown;
  /** SDK调用ID */
  readonly callId: string;
  /** SDK审批是否已经通过 */
  readonly approvalGranted: boolean;
  /** 是否免除普通预算 */
  readonly budgetExempt: boolean;
}

/** 工具调用审计。 */
export interface ToolAudit {
  /** 运行ID */
  readonly runId: string;
  /** 追踪ID */
  readonly traceId: string;
  /** SDK调用ID */
  readonly callId: string;
  /** 注册名称 */
  readonly toolName: string;
  /** 开始时间戳 */
  readonly startedAt: number;
  /** 完成时间戳 */
  readonly finishedAt: number;
}

/** 工具结算错误。 */
export interface ToolError {
  /** 稳定错误码 */
  readonly code:
    | 'invalid_input'
    | 'permission_denied'
    | 'approval_required'
    | 'invalid_output'
    | 'execution_failed'
    | 'unexpected_error'
    | 'timeout'
    | 'cancelled';
  /** 系统错误详情 */
  readonly message: string;
  /** 是否适合调整后重试 */
  readonly retryable: boolean;
}

/** 完整工具结算。 */
export interface ToolSettlement {
  /** 终态 */
  readonly status: 'success' | 'error' | 'denied' | 'review' | 'cancelled' | 'timeout';
  /** 执行输出 */
  readonly output?: ToolExecutionOutput;
  /** 已应用Effect */
  readonly effects?: readonly ToolEffect[];
  /** 错误详情 */
  readonly error?: ToolError;
  /** 调用审计 */
  readonly audit: ToolAudit;
}

/** 模型可见工具观察。 */
export interface ToolModelOutput {
  /** 工具终态 */
  readonly status: ToolSettlement['status'];
  /** 安全摘要 */
  readonly summary: string;
  /** 有界结构化结果 */
  readonly data?: unknown;
  /** 是否适合调整后重试 */
  readonly retryable?: boolean;
}

/**
 * 工具系统运行上下文
 *
 * 该上下文只由Agent Runtime构造，不进入模型Prompt。Tool只能通过这些能力
 * 请求授权、查询幂等结算和提交受控Effect。
 */
export interface ToolRuntimeContext {
  /** 运行ID */
  readonly runId: string;
  /** 追踪ID */
  readonly traceId: string;
  /** 当前SDK调用ID */
  readonly callId: string;
  /** Agent名称 */
  readonly agentName: string;
  /** 取消信号 */
  readonly signal: AbortSignal;
  /** SDK审批是否已经通过 */
  readonly approvalGranted?: boolean;
  /** 是否免除普通工具预算 */
  readonly budgetExempt?: boolean;
  /**
   * 执行资源级授权
   * @param request 工具与输入
   * @returns 授权结果
   */
  readonly authorize: (request: ToolAuthorizationRequest) => Promise<ToolAuthorization>;
  /**
   * 查询已有结算
   * @param callId SDK调用ID
   * @returns 已有结算
   */
  readonly getSettlement: (callId: string) => ToolSettlement | undefined;
  /**
   * 记录完整结算
   * @param settlement 完整结算
   */
  readonly recordSettlement: (settlement: ToolSettlement) => void;
  /**
   * 提交受控Effect
   * @param effects 状态变更
   */
  readonly applyEffects: (effects: readonly ToolEffect[]) => Promise<void> | void;
}
