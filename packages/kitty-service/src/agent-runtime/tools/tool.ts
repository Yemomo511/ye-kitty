import { decodeToolInput, isZodToolParameters, type ToolParameters } from './schema';
import {
  type ToolAudit,
  type ToolExecutionOutput,
  type ToolModelOutput,
  type ToolPolicy,
  type ToolRuntimeContext,
  type ToolSettlement,
} from './result';
import { projectToolSettlement } from './output';

const TOOL_TYPE = Symbol('YeKitty.Tool');
const implementations = new WeakMap<Tool, ToolImplementation>();
const pendingSettlements = new WeakMap<object, Map<string, Promise<ToolSettlement>>>();

/** 规范Tool的不透明身份。 */
export interface Tool {
  /** 仅由Tool.make写入的运行时身份。 */
  readonly [TOOL_TYPE]: true;
}

/** 模型可见Tool定义。 */
export interface ToolModelDefinition {
  /** 能力说明 */
  readonly description: string;
  /** 输入结构 */
  readonly parameters: ToolParameters;
  /** 是否启用严格Schema */
  readonly strict: boolean;
}

/** 创建规范Tool的参数。 */
export interface ToolOptions<TInput = unknown> {
  /** 能力说明 */
  readonly description: string;
  /** 输入结构 */
  readonly parameters: ToolParameters;
  /** 是否启用严格Schema，Zod默认开启 */
  readonly strict?: boolean;
  /** 系统治理策略 */
  readonly policy: ToolPolicy;
  /**
   * 执行受控能力
   * @param input 已校验输入
   * @param context 系统运行上下文
   * @returns 工具执行结果
   */
  readonly execute: (
    input: TInput,
    context: ToolRuntimeContext,
  ) => Promise<ToolExecutionOutput> | ToolExecutionOutput;
  /**
   * 生成模型观察
   * @param settlement 完整系统结算
   * @returns 脱敏模型输出
   */
  readonly toModelOutput?: (settlement: ToolSettlement) => ToolModelOutput;
}

interface ToolImplementation {
  readonly definition: ToolModelDefinition;
  readonly policy: ToolPolicy;
  readonly execute: ToolOptions['execute'];
  readonly toModelOutput: (settlement: ToolSettlement) => ToolModelOutput;
}

/**
 * 规范Tool能力
 *
 * Tool内部实现保存在私有WeakMap中。调用方只能通过公开能力创建、检查、
 * 结算和投影，无法用普通对象绕过系统治理。
 */
export const Tool = {
  /**
   * 创建规范Tool
   * @param options 模型定义与系统实现
   * @returns 不透明Tool
   */
  make<TInput>(options: ToolOptions<TInput>): Tool {
    validateToolOptions(options);
    const tool = Object.freeze({ [TOOL_TYPE]: true }) as Tool;
    implementations.set(tool, {
      definition: Object.freeze({
        description: options.description.trim(),
        parameters: options.parameters,
        strict: options.strict ?? isZodToolParameters(options.parameters),
      }),
      policy: Object.freeze({ ...options.policy }),
      execute: options.execute as ToolOptions['execute'],
      toModelOutput: options.toModelOutput ?? projectToolSettlement,
    });
    return tool;
  },

  /**
   * 判断规范Tool身份
   * @param input 待判断值
   * @returns 是否由Tool.make创建
   */
  is(input: unknown): input is Tool {
    return typeof input === 'object' && input !== null && implementations.has(input as Tool);
  },

  /**
   * 读取模型定义
   * @param tool 规范Tool
   * @returns 只读模型定义
   */
  definition(tool: Tool): ToolModelDefinition {
    return getImplementation(tool).definition;
  },

  /**
   * 读取系统策略
   * @param tool 规范Tool
   * @returns 只读治理策略
   */
  policy(tool: Tool): ToolPolicy {
    return getImplementation(tool).policy;
  },

  /**
   * 结算单次工具调用
   * @param name 注册名称
   * @param tool 规范Tool
   * @param input 不可信输入
   * @param context 系统运行上下文
   * @returns 完整系统结算
   */
  async settle(
    name: string,
    tool: Tool,
    input: unknown,
    context: ToolRuntimeContext,
  ): Promise<ToolSettlement> {
    const existing = context.getSettlement(context.callId);
    if (existing) return existing;

    const pendingByCall = getPendingSettlements(context);
    const pending = pendingByCall.get(context.callId);
    if (pending) return await pending;

    const settlement = settleToolCall(name, tool, input, context);
    pendingByCall.set(context.callId, settlement);
    try {
      return await settlement;
    } finally {
      pendingByCall.delete(context.callId);
    }
  },

  /**
   * 投影模型观察
   * @param tool 规范Tool
   * @param settlement 完整系统结算
   * @returns 有界模型输出
   */
  toModelOutput(tool: Tool, settlement: ToolSettlement): ToolModelOutput {
    return getImplementation(tool).toModelOutput(settlement);
  },
};

// 创建期固定系统策略，避免运行中出现无法由SDK暂停的高风险工具。
function validateToolOptions<TInput>(options: ToolOptions<TInput>): void {
  if (!options.description.trim()) throw new Error('Tool说明不能为空');
  if (!Number.isInteger(options.policy.timeoutMs) || options.policy.timeoutMs <= 0) {
    throw new Error('Tool超时必须是正整数');
  }
  if (options.policy.risk !== 'low' && options.policy.approval !== 'required') {
    throw new Error('中高风险Tool必须启用系统审批');
  }
}

// 执行输入、权限、副作用和审计结算。
async function settleToolCall(
  name: string,
  tool: Tool,
  input: unknown,
  context: ToolRuntimeContext,
): Promise<ToolSettlement> {
  const implementation = getImplementation(tool);
  const startedAt = Date.now();
  const decoded = decodeToolInput(implementation.definition.parameters, input);
  if (!decoded.success) {
    return recordSettlement(
      context,
      createSettlement('error', context, name, startedAt, {
        error: {
          code: 'invalid_input',
          message: decoded.error,
          retryable: true,
        },
      }),
    );
  }

  if (implementation.policy.approval === 'required' && !context.approvalGranted) {
    return recordSettlement(
      context,
      createSettlement('review', context, name, startedAt, {
        error: {
          code: 'approval_required',
          message: '该工具需要审批后才能执行',
          retryable: false,
        },
      }),
    );
  }

  const authorization = await context.authorize({
    name,
    policy: implementation.policy,
    input: decoded.data,
    callId: context.callId,
    approvalGranted: context.approvalGranted ?? false,
    budgetExempt: context.budgetExempt ?? false,
  });
  if (authorization.status !== 'allowed') {
    return recordSettlement(
      context,
      createSettlement(authorization.status, context, name, startedAt, {
        error: {
          code: authorization.status === 'review' ? 'approval_required' : 'permission_denied',
          message: authorization.reason,
          retryable: false,
        },
      }),
    );
  }

  try {
    const output = validateExecutionOutput(
      await executeWithTimeout(
        implementation,
        decoded.data,
        context,
        implementation.policy.timeoutMs,
      ),
      implementation.policy,
    );
    if (!output.success) {
      return recordSettlement(
        context,
        createSettlement('error', context, name, startedAt, {
          output,
          error: {
            code: 'execution_failed',
            message: output.error ?? output.summary,
            retryable: output.retryable ?? false,
          },
        }),
      );
    }

    const effects = output.effects ?? [];
    await context.applyEffects(effects);
    return recordSettlement(
      context,
      createSettlement('success', context, name, startedAt, { output, effects }),
    );
  } catch (error) {
    const status = classifyExecutionError(error);
    return recordSettlement(
      context,
      createSettlement(status, context, name, startedAt, {
        error: {
          code:
            status === 'timeout'
              ? 'timeout'
              : status === 'cancelled'
                ? 'cancelled'
                : error instanceof ToolInvalidOutputError
                  ? 'invalid_output'
                  : 'unexpected_error',
          message: formatError(error),
          retryable: status === 'timeout',
        },
      }),
    );
  }
}

// 使用系统AbortSignal统一治理取消和超时。
async function executeWithTimeout(
  implementation: ToolImplementation,
  input: unknown,
  context: ToolRuntimeContext,
  timeoutMs: number,
): Promise<ToolExecutionOutput> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(new ToolCancelledError());
  context.signal.addEventListener('abort', onAbort, { once: true });
  let rejectExecutionAbort: (reason: unknown) => void = () => undefined;
  const abortTask = new Promise<never>((_, reject) => {
    rejectExecutionAbort = reject;
  });
  const rejectOnExecutionAbort = () =>
    rejectExecutionAbort(controller.signal.reason ?? new ToolCancelledError());
  controller.signal.addEventListener('abort', rejectOnExecutionAbort, { once: true });

  let timeout: NodeJS.Timeout | undefined;
  const timeoutTask = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new ToolExecutionTimeoutError(timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    if (context.signal.aborted) throw new ToolCancelledError();
    const executionContext = { ...context, signal: controller.signal };
    return await Promise.race([
      implementation.execute(input, executionContext),
      timeoutTask,
      abortTask,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    context.signal.removeEventListener('abort', onAbort);
    controller.signal.removeEventListener('abort', rejectOnExecutionAbort);
  }
}

// 创建统一结算。
function createSettlement(
  status: ToolSettlement['status'],
  context: ToolRuntimeContext,
  name: string,
  startedAt: number,
  values: Pick<ToolSettlement, 'output' | 'effects' | 'error'>,
): ToolSettlement {
  const audit: ToolAudit = {
    runId: context.runId,
    traceId: context.traceId,
    callId: context.callId,
    toolName: name,
    startedAt,
    finishedAt: Date.now(),
  };
  const output =
    values.output === undefined
      ? undefined
      : Object.freeze({
          ...values.output,
          ...(values.output.effects ? { effects: Object.freeze([...values.output.effects]) } : {}),
        });
  return Object.freeze({
    status,
    audit: Object.freeze(audit),
    ...(output === undefined ? {} : { output }),
    ...(values.effects === undefined ? {} : { effects: Object.freeze([...values.effects]) }),
    ...(values.error === undefined ? {} : { error: Object.freeze(values.error) }),
  });
}

// 持久化结算后返回同一对象。
function recordSettlement(context: ToolRuntimeContext, settlement: ToolSettlement): ToolSettlement {
  context.recordSettlement(settlement);
  return settlement;
}

// 读取私有实现。
function getImplementation(tool: Tool): ToolImplementation {
  const implementation = implementations.get(tool);
  if (!implementation) throw new Error('目标不是规范Tool');
  return implementation;
}

// 获取同一运行上下文的在途调用。
function getPendingSettlements(context: ToolRuntimeContext): Map<string, Promise<ToolSettlement>> {
  const existing = pendingSettlements.get(context);
  if (existing) return existing;
  const created = new Map<string, Promise<ToolSettlement>>();
  pendingSettlements.set(context, created);
  return created;
}

// 分类工具执行错误。
function classifyExecutionError(error: unknown): ToolSettlement['status'] {
  if (error instanceof ToolExecutionTimeoutError) return 'timeout';
  if (error instanceof ToolCancelledError) return 'cancelled';
  return 'error';
}

// 验证Tool实现返回值，防止实现错误伪造Effect或破坏结算管线。
function validateExecutionOutput(output: unknown, policy: ToolPolicy): ToolExecutionOutput {
  if (
    !isRecord(output) ||
    typeof output.success !== 'boolean' ||
    typeof output.summary !== 'string' ||
    !output.summary.trim() ||
    (output.error !== undefined && typeof output.error !== 'string') ||
    (output.retryable !== undefined && typeof output.retryable !== 'boolean') ||
    (output.effects !== undefined &&
      (!Array.isArray(output.effects) ||
        output.effects.some((effect) => !isValidEffect(effect)) ||
        (output.effects.length > 0 && policy.source !== 'skill')))
  ) {
    throw new ToolInvalidOutputError();
  }
  return output as unknown as ToolExecutionOutput;
}

// Effect只允许两种带最小可信形状的系统状态变更。
function isValidEffect(effect: unknown): boolean {
  if (!isRecord(effect) || typeof effect.type !== 'string') return false;
  if (effect.type === 'enable_skill') {
    return (
      isRecord(effect.skill) &&
      typeof effect.skill.body === 'string' &&
      isRecord(effect.skill.metadata) &&
      typeof effect.skill.metadata.name === 'string'
    );
  }
  if (effect.type === 'load_skill_reference') {
    return (
      isRecord(effect.reference) &&
      typeof effect.reference.referencePath === 'string' &&
      typeof effect.reference.content === 'string' &&
      isRecord(effect.reference.skill) &&
      typeof effect.reference.skill.name === 'string'
    );
  }
  return false;
}

// 压缩内部错误。
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class ToolExecutionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`工具执行超过 ${timeoutMs}ms`);
  }
}

class ToolCancelledError extends Error {
  constructor() {
    super('工具调用已取消');
  }
}

class ToolInvalidOutputError extends Error {
  constructor() {
    super('工具实现返回值不符合系统协议');
  }
}

// 判断普通对象。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type {
  ToolEffect,
  ToolExecutionOutput,
  ToolModelOutput,
  ToolPolicy,
  ToolRuntimeContext,
  ToolSettlement,
} from './result';
export type { ToolJsonObjectSchema, ToolParameters } from './schema';
