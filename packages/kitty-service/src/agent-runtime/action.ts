import { randomUUID } from 'node:crypto';

/** Agent 已完成本次运行。 */
export interface FinishAction<TOutput = unknown> {
  /** 动作类型 */
  readonly type: 'finish';
  /** 最终处理方式 */
  readonly result: 'reply' | 'ignore' | 'review';
  /** 回复或其他最终产物 */
  readonly output?: TOutput;
  /** 动作原因 */
  readonly reason: string;
}

/** Agent 请求执行一个已注册工具。 */
export interface ToolAction {
  /** 动作类型 */
  readonly type: 'tool';
  /** 单次调用ID */
  readonly callId: string;
  /** 工具名称 */
  readonly name: string;
  /** 工具输入 */
  readonly input: unknown;
  /** 调用原因 */
  readonly reason: string;
}

/** Agent 单轮只输出最终结果或工具调用。 */
export type AgentAction<TOutput = unknown> = FinishAction<TOutput> | ToolAction;

/** 兼容解析配置。 */
export interface AgentActionNormalizeOptions {
  /** 生成旧动作缺失的调用ID */
  readonly createCallId?: () => string;
}

/**
 * 归一化 Agent Action
 *
 * 接受新协议和迁移前的 Decision 协议。旧 Skill 请求会转换为普通 `skill`
 * ToolAction，确保后续循环只保留一种调度分支。
 *
 * @param input 模型结构化输出
 * @param options 兼容解析配置
 * @returns 统一 AgentAction
 */
export function normalizeAgentAction(
  input: unknown,
  options: AgentActionNormalizeOptions = {},
): AgentAction {
  const action = toAgentAction(input, options.createCallId ?? randomUUID);
  if (!action) throw new Error('Agent Action 不符合协议');
  return action;
}

// 将已确认是普通对象的输入收敛为动作。
function toAgentAction(input: unknown, createCallId: () => string): AgentAction | undefined {
  if (!isRecord(input) || typeof input.type !== 'string') return undefined;

  if (input.type === 'finish') return readFinishAction(input);
  if (input.type === 'tool') return readToolAction(input, createCallId);
  if (input.type === 'reply') return readLegacyReply(input);
  if (input.type === 'ignore' || input.type === 'human_review') {
    return {
      type: 'finish',
      result: input.type === 'ignore' ? 'ignore' : 'review',
      reason: readReason(input.reason),
    };
  }
  if (input.type === 'tool_call') {
    return readToolAction(
      { ...input, type: 'tool', name: input.toolName, callId: input.callId },
      createCallId,
    );
  }
  if (input.type === 'skill_call') return readLegacySkillAction(input, createCallId);
  if (input.type === 'skill_reference_call') {
    return readLegacySkillReferenceAction(input, createCallId);
  }
  return undefined;
}

// 读取新最终动作。
function readFinishAction(input: Record<string, unknown>): FinishAction | undefined {
  if (input.result !== 'reply' && input.result !== 'ignore' && input.result !== 'review') {
    return undefined;
  }
  return {
    type: 'finish',
    result: input.result,
    ...(input.output === undefined ? {} : { output: input.output }),
    reason: readReason(input.reason),
  };
}

// 读取新工具动作。
function readToolAction(
  input: Record<string, unknown>,
  createCallId: () => string,
): ToolAction | undefined {
  const name = readRequiredText(input.name);
  if (!name) return undefined;
  return {
    type: 'tool',
    callId: readRequiredText(input.callId) ?? createCallId(),
    name,
    input: input.input ?? {},
    reason: readReason(input.reason),
  };
}

// 将旧回复结构保留为最终产物。
function readLegacyReply(input: Record<string, unknown>): FinishAction | undefined {
  const text = readRequiredText(input.text);
  const actions = Array.isArray(input.actions) ? input.actions : undefined;
  if (!text && (!actions || actions.length === 0)) return undefined;
  return {
    type: 'finish',
    result: 'reply',
    output: {
      ...(text ? { text } : {}),
      ...(actions ? { actions } : {}),
    },
    reason: readReason(input.reason),
  };
}

// 将旧 Skill 正文请求转换为普通工具调用。
function readLegacySkillAction(
  input: Record<string, unknown>,
  createCallId: () => string,
): ToolAction | undefined {
  const name = readRequiredText(input.skillName);
  if (!name) return undefined;
  return {
    type: 'tool',
    callId: createCallId(),
    name: 'skill',
    input: { name, input: input.input ?? {} },
    reason: readReason(input.reason),
  };
}

// 将旧 Skill 引用请求转换为普通工具调用。
function readLegacySkillReferenceAction(
  input: Record<string, unknown>,
  createCallId: () => string,
): ToolAction | undefined {
  const name = readRequiredText(input.skillName);
  const reference = readRequiredText(input.referencePath);
  if (!name || !reference) return undefined;
  return {
    type: 'tool',
    callId: createCallId(),
    name: 'skill',
    input: { name, reference },
    reason: readReason(input.reason),
  };
}

// 读取必要非空文本。
function readRequiredText(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined;
}

// 读取可选原因，保证日志和追踪始终可解释。
function readReason(input: unknown): string {
  return readRequiredText(input) ?? '未说明';
}

// 判断未知输入是否为普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
