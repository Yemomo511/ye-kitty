import type { PlatformMessage } from '@kitty/platforms/message';
import { writeDebugLog } from '../shared/logging';
import type { QqReplyAction } from './runtime';
import type { SkillContent, SkillMetadata, SkillReferenceContent } from './skills';
import type {
  ToolAuthorizationRequest,
  ToolEffect,
  ToolRuntimeContext,
  ToolSettlement,
} from './tools';
import { GET_CUSTOM_FACES_TOOL_NAME, GET_RECENT_MESSAGES_TOOL_NAME } from './tools/messages';

/** Agent系统终态。 */
export type AgentTerminalResult =
  | { readonly type: 'reply'; readonly text?: string; readonly actions?: readonly QqReplyAction[] }
  | { readonly type: 'ignore'; readonly reason: string }
  | { readonly type: 'human_review'; readonly reason: string };

/** 单次Agent运行状态参数。 */
export interface AgentRunStateOptions {
  /** 运行ID */
  readonly runId: string;
  /** 追踪ID */
  readonly traceId: string;
  /** Agent名称 */
  readonly agentName: string;
  /** 平台事件 */
  readonly event: PlatformMessage;
  /** 可请求Skill */
  readonly availableSkills: readonly SkillMetadata[];
  /** 预启用Skill */
  readonly enabledSkills: readonly SkillContent[];
  /** 回复意图 */
  readonly replyIntent: 'normal' | 'required_group_reply';
  /** 最大普通工具数 */
  readonly maxToolCalls: number;
  /** 最大Skill引用数 */
  readonly maxSkillReferences: number;
}

/**
 * Agent单次运行状态
 *
 * 预算、审批、Skill、调用记录和终态都只保存在该系统对象中。
 * 模型只能通过Prompt与Tool投影获得完成任务所需的最小信息。
 */
export class AgentRunState {
  /** 平台事件 */
  readonly event: PlatformMessage;
  /** 可请求Skill */
  readonly availableSkills: readonly SkillMetadata[];
  /** 回复意图 */
  readonly replyIntent: 'normal' | 'required_group_reply';
  /** 最大Skill引用数 */
  readonly maxSkillReferences: number;

  private readonly settlements = new Map<string, ToolSettlement>();
  private readonly budgetedCalls = new Set<string>();
  private readonly customFaceFiles = new Set<string>();
  private readonly enabledSkillValues: SkillContent[];
  private readonly loadedReferenceValues: SkillReferenceContent[] = [];
  private readonly options: AgentRunStateOptions;
  private visibleToolNames: ReadonlySet<string> | undefined;
  private terminalValue: AgentTerminalResult | undefined;
  private recentMessagesReadyValue = false;

  constructor(options: AgentRunStateOptions) {
    this.options = options;
    this.event = options.event;
    this.availableSkills = Object.freeze(
      excludeEnabledSkills(options.availableSkills, options.enabledSkills),
    );
    this.enabledSkillValues = deduplicateSkills(options.enabledSkills);
    this.replyIntent = options.replyIntent;
    this.maxSkillReferences = options.maxSkillReferences;
  }

  /** 已启用Skill快照。 */
  get enabledSkills(): readonly SkillContent[] {
    return Object.freeze([...this.enabledSkillValues]);
  }

  /** 已读取引用快照。 */
  get loadedReferences(): readonly SkillReferenceContent[] {
    return Object.freeze([...this.loadedReferenceValues]);
  }

  /** Skill工具读取引用时使用的系统上限。 */
  get maxReferences(): number {
    return this.maxSkillReferences;
  }

  /** 系统终态。 */
  get terminal(): AgentTerminalResult | undefined {
    return this.terminalValue;
  }

  /** 最近消息前置观察是否成功。 */
  get recentMessagesReady(): boolean {
    return this.recentMessagesReadyValue;
  }

  /**
   * 绑定单次运行不可变Tool快照
   * @param names 本轮可执行工具名
   */
  bindToolSnapshot(names: readonly string[]): void {
    if (this.visibleToolNames) throw new Error('Agent Tool快照已经绑定');
    this.visibleToolNames = new Set(names);
  }

  /**
   * 创建Tool运行上下文
   * @param signal 运行取消信号
   * @param budgetExempt 是否免除普通预算
   * @returns 系统上下文
   */
  createToolContext(signal: AbortSignal, budgetExempt = false): ToolRuntimeContext {
    return {
      runId: this.options.runId,
      traceId: this.options.traceId,
      callId: '由SDK调用时补齐',
      agentName: this.options.agentName,
      signal,
      budgetExempt,
      authorize: async (request) => this.authorize(request),
      getSettlement: (callId) => this.settlements.get(callId),
      recordSettlement: (settlement) => this.recordSettlement(settlement),
      applyEffects: (effects) => this.applyEffects(effects),
    };
  }

  /**
   * 提交系统终态
   * @param result 已校验结果
   */
  finish(result: AgentTerminalResult): void {
    if (this.terminalValue) throw new Error('Agent终态已经提交');
    this.terminalValue = Object.freeze(result);
  }

  /**
   * 判断自定义表情来源
   * @param file 表情资源
   * @returns 是否来自本轮观察
   */
  hasCustomFace(file: string): boolean {
    return this.customFaceFiles.has(file);
  }

  // 执行风险、审批和预算校验。
  private authorize(request: ToolAuthorizationRequest) {
    if (this.visibleToolNames && !this.visibleToolNames.has(request.name)) {
      return { status: 'denied' as const, reason: '工具不属于本轮不可变快照' };
    }
    if (request.policy.approval === 'required' && !request.approvalGranted) {
      return { status: 'review' as const, reason: '该工具需要审批后才能执行' };
    }
    if (request.policy.risk !== 'low' && request.policy.approval !== 'required') {
      return { status: 'review' as const, reason: '非低风险工具必须配置系统审批' };
    }

    const consumesBudget = request.policy.consumesBudget ?? true;
    if (!consumesBudget || request.budgetExempt || this.budgetedCalls.has(request.callId)) {
      return { status: 'allowed' as const };
    }
    if (this.budgetedCalls.size >= this.options.maxToolCalls) {
      return { status: 'denied' as const, reason: '本轮普通工具调用已达到系统上限' };
    }
    this.budgetedCalls.add(request.callId);
    return { status: 'allowed' as const };
  }

  // 记录结算并提取后续系统校验所需事实。
  private recordSettlement(settlement: ToolSettlement): void {
    this.settlements.set(settlement.audit.callId, settlement);
    if (
      settlement.status === 'success' &&
      settlement.audit.toolName === GET_RECENT_MESSAGES_TOOL_NAME
    ) {
      this.recentMessagesReadyValue = true;
    }
    if (
      settlement.status === 'success' &&
      settlement.audit.toolName === GET_CUSTOM_FACES_TOOL_NAME
    ) {
      collectCustomFaceFiles(settlement.output?.data, this.customFaceFiles);
    }
    writeDebugLog(
      `🔍 [AgentRuntime-Tool-settle] 工具结算已记录 tool=${settlement.audit.toolName} callId=${settlement.audit.callId} status=${settlement.status}`,
    );
  }

  // 只应用Tool协议声明的Skill Effect。
  private applyEffects(effects: readonly ToolEffect[]): void {
    for (const effect of effects) {
      if (effect.type === 'enable_skill') {
        if (
          !this.enabledSkillValues.some(
            (skill) => skill.metadata.name === effect.skill.metadata.name,
          )
        ) {
          this.enabledSkillValues.push(effect.skill);
        }
        continue;
      }
      const key = `${effect.reference.skill.name}:${effect.reference.referencePath}`;
      if (
        !this.loadedReferenceValues.some(
          (item) => `${item.skill.name}:${item.referencePath}` === key,
        )
      ) {
        this.loadedReferenceValues.push(effect.reference);
      }
    }
  }
}

// 提取工具确认存在的自定义表情文件。
function collectCustomFaceFiles(data: unknown, target: Set<string>): void {
  if (!Array.isArray(data)) return;
  for (const item of data) {
    if (!isRecord(item) || typeof item.file !== 'string') continue;
    target.add(item.file);
  }
}

// 按名称去重预启用Skill。
function deduplicateSkills(skills: readonly SkillContent[]): SkillContent[] {
  const unique = new Map<string, SkillContent>();
  for (const skill of skills) unique.set(skill.metadata.name, skill);
  return [...unique.values()];
}

// 排除已经预启用的Skill目录项。
function excludeEnabledSkills(
  available: readonly SkillMetadata[],
  enabled: readonly SkillContent[],
): SkillMetadata[] {
  const names = new Set(enabled.map((skill) => skill.metadata.name));
  return available.filter((skill) => !names.has(skill.name));
}

// 判断普通对象。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
