import type { AgentMessage } from './message';
import type { AgentContext } from './state';
import type { PromptHistoryItem, PromptPhase, PromptState } from './prompt/state';
import type {
  SkillContent,
  SkillContentReader,
  SkillMetadata,
  SkillReferenceContent,
  SkillReferenceReader,
} from './skills';
import type { ToolExecutionResult } from '../services/agent-runtime/domain/tool';
import type { LMRunner } from './lm/lm';
import type { ConversationHistoryPort } from '../services/agent-runtime/ports/conversation-history.port';
import type { RuntimeToolExecutorPort } from '../services/agent-runtime/ports/tool-executor.port';
import type { RuntimeToolRegistryPort } from '../services/agent-runtime/ports/tool-registry.port';
import { GET_RECENT_MESSAGES_TOOL_NAME } from '../services/agent-runtime/application/runtime-tools';
import type {
  QqReplyAgentInput,
  QqReplyAgentPort,
  QqReplyAgentResult,
  QqReplyAction,
} from '../services/agent-runtime/ports/qq-reply-agent.port';
import { normalizeAgentAction, type AgentAction, type FinishAction } from './action';
import type { Observation } from './observation';
import { Schedule } from './schedule';
import {
  createRuntimeTools,
  RiskToolPermission,
  SkillTool,
  ToolExecutor,
  ToolRegistry,
  type Tool,
} from './tools';
import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';

/** Agent单次运行输入。 */
export interface AgentInput {
  /** 标准聊天事件。 */
  readonly event: ChatEventContract;
  /** 本轮可请求的Skill目录。 */
  readonly availableSkills?: readonly SkillMetadata[];
  /** 平台边界预启用的Skill正文。 */
  readonly skills?: readonly SkillContent[];
  /** 本轮回复意图。 */
  readonly replyIntent?: 'normal' | 'required_group_reply';
  /** 本轮必须完成的工具调用。 */
  readonly requiredToolCalls?: readonly string[];
  /** 最近消息窗口提示。 */
  readonly recentMessageLimitHint?: 100;
}

/** Agent完成一次循环后的结果。 */
export type AgentResult =
  | {
      readonly type: 'reply';
      readonly text?: string;
      readonly actions?: readonly QqReplyAction[];
      readonly traceId: string;
    }
  | { readonly type: 'ignore'; readonly reason: string; readonly traceId: string }
  | { readonly type: 'human_review'; readonly reason: string; readonly traceId: string };

/**
 * Agent运行配置
 *
 * 控制单次 Agent 循环的轮次、工具调用预算和降级路径。
 */
export interface AgentConfig {
  /** 最大轮次 */
  readonly maxTurns: number;
  /** 最大工具次数 */
  readonly maxToolCalls: number;
  /** 最大Skill引用读取数 */
  readonly maxSkillReferences?: number;
  /** 由 Bootstrap 注入的平台、MCP或Code Agent工具。 */
  readonly tools?: readonly Tool[];
}

const DEFAULT_MAX_SKILL_REFERENCES = 3;

/**
 * Agent运行循环
 *
 * 负责把模型响应控制在循环中治理：模型只输出Action，工具调用和最终动作由Agent收敛。
 */
export class Agent {
  constructor(
    private readonly lm: LMRunner,
    private readonly toolRegistry: RuntimeToolRegistryPort,
    private readonly toolExecutor: RuntimeToolExecutorPort,
    private readonly conversationHistory: ConversationHistoryPort,
    private readonly skillContentLoader: SkillContentReader | undefined,
    private readonly skillReferenceLoader: SkillReferenceReader | undefined,
    private readonly fallbackAgent: QqReplyAgentPort,
    private readonly config: AgentConfig,
  ) {}

  /**
   * 运行Agent循环
   * @param input 平台事件和Skill
   * @returns 最终决策
   */
  async run(input: AgentInput): Promise<AgentResult> {
    const traceId = createTraceId(input.event.id);
    const toolResults: ToolExecutionResult[] = [];
    const enabledSkills = deduplicateSkills(input.skills ?? []);
    const requestableSkills = excludeEnabledSkills(input.availableSkills ?? [], enabledSkills);
    const loadedReferences: SkillReferenceContent[] = [];
    const actionHistory: PromptHistoryItem[] = [];
    const conversationMessages: AgentMessage[] = [
      { type: 'user_event', event: input.event },
      { type: 'skill_catalog', skills: requestableSkills },
      ...enabledSkills.map((skill) => ({ type: 'skill_content' as const, skill })),
    ];
    let toolCallCount = 0;
    let decisionErrorCount = 0;
    const maxSkillReferences = this.config.maxSkillReferences ?? DEFAULT_MAX_SKILL_REFERENCES;
    const tools = this.createTools(input);
    const schedule = new Schedule(
      new ToolRegistry(tools),
      new ToolExecutor(),
      new RiskToolPermission(),
    );

    // 1. 先写入当前消息，让前置观察能包含本次请求。
    this.conversationHistory.recordMessage(input.event);
    const initialContextResult = await this.observeRecentMessagesBeforeDecision(
      schedule,
      traceId,
      requestableSkills,
      enabledSkills,
      loadedReferences,
      maxSkillReferences,
    );
    toolResults.push(initialContextResult);
    conversationMessages.push({ type: 'tool_result', result: initialContextResult });
    let phase: PromptPhase = initialContextResult.success ? 'tool_observing' : 'ready_to_decide';
    console.info(
      `🚧 [AgentRuntime-Agent-run] 开始Agent循环 traceId=${traceId} conversationType=${input.event.conversationType} preEnabledSkillCount=${enabledSkills.length} recentMessagesReady=${initialContextResult.success} messageId=${maskId(
        input.event.message.id,
      )}`,
    );

    for (let turnIndex = 1; turnIndex <= this.config.maxTurns; turnIndex += 1) {
      const observation: AgentContext = {
        event: input.event,
        availableSkills: requestableSkills,
        enabledSkills: [...enabledSkills],
        tools,
        toolResults,
        conversationMessages: [...conversationMessages],
        promptState: buildPromptState({
          traceId,
          phase,
          turnIndex,
          maxTurns: this.config.maxTurns,
          toolCallCount,
          maxToolCalls: this.config.maxToolCalls,
          skillReferenceCount: loadedReferences.length,
          maxSkillReferences,
          decisionErrorCount,
          availableSkillNames: requestableSkills.map((skill) => skill.name),
          enabledSkillNames: enabledSkills.map((skill) => skill.metadata.name),
          loadedReferenceKeys: loadedReferences.map(toReferenceKey),
          visibleToolNames: tools.map((tool) => tool.name),
          latestObservation: getLatestObservation(conversationMessages),
          actionHistory,
        }),
        replyIntent: input.replyIntent,
        requiredToolCalls: input.requiredToolCalls,
        recentMessageLimitHint: input.recentMessageLimitHint,
        turnIndex,
        maxTurns: this.config.maxTurns,
        toolCallCount,
        maxToolCalls: this.config.maxToolCalls,
      };

      try {
        const action = normalizeAgentAction(await this.lm.run(observation));
        console.info(
          `🔍 [AgentRuntime-Agent-run] 已获得Agent Action traceId=${traceId} turn=${turnIndex} actionType=${action.type} target=${getActionTarget(action) ?? 'final'}`,
        );

        if (action.type === 'finish') {
          const requiredReplyViolation = validateRequiredGroupReply(action, toolResults);
          if (input.replyIntent === 'required_group_reply' && requiredReplyViolation) {
            decisionErrorCount += 1;
            phase = 'ready_to_decide';
            actionHistory.push(toActionHistoryItem(turnIndex, action, false));
            const result = {
              toolName: 'required_group_reply',
              success: false,
              observation: requiredReplyViolation,
              errorMessage: '强制群聊回复协议未满足',
            };
            toolResults.push(result);
            conversationMessages.push({
              type: 'decision_error',
              observation: result.observation,
              errorMessage: result.errorMessage,
            });
            console.warn(
              `⚠️ [AgentRuntime-Agent-run] 强制群聊回复协议未满足，已转为下一轮观察 traceId=${traceId} turn=${turnIndex} result=${action.result}`,
            );
            continue;
          }

          phase = action.result === 'review' ? 'human_review' : 'finalized';
          actionHistory.push(toActionHistoryItem(turnIndex, action, true));
          return toRunResult(action, traceId);
        }

        if (action.name !== 'skill' && toolCallCount >= this.config.maxToolCalls) {
          phase = 'fallback';
          actionHistory.push(toActionHistoryItem(turnIndex, action, false));
          console.warn(
            `⚠️ [AgentRuntime-Agent-run] 工具调用已超出预算，执行降级 traceId=${traceId} maxToolCalls=${this.config.maxToolCalls}`,
          );
          return await this.fallback(input, traceId, enabledSkills);
        }

        const scheduled = await schedule.dispatch(action, {
          availableSkills: requestableSkills,
          enabledSkills,
          loadedSkillReferences: loadedReferences,
          maxSkillReferences,
        });
        if (scheduled.type !== 'observed') {
          throw new Error('ToolAction未产生Observation');
        }
        if (action.name !== 'skill') toolCallCount += 1;
        appendObservationContext(
          scheduled.observation,
          conversationMessages,
          enabledSkills,
          loadedReferences,
        );
        const result = toToolExecutionResult(scheduled.observation);
        toolResults.push(result);
        conversationMessages.push({ type: 'tool_result', result });
        phase = resolveObservationPhase(scheduled.observation);
        actionHistory.push(toActionHistoryItem(turnIndex, action, result.success));
      } catch (error) {
        const reason = formatError(error);
        decisionErrorCount += 1;
        phase = 'ready_to_decide';
        console.warn(
          `⚠️ [AgentRuntime-Agent-run] Agent Action失败，已转为下一轮观察 traceId=${traceId} turn=${turnIndex} reason=${reason}`,
        );
        const result = {
          toolName: 'agent_decision',
          success: false,
          observation: `上一轮模型输出不可用，原因：${reason}。请重新输出合法 JSON 决策。`,
          errorMessage: reason,
        };
        toolResults.push(result);
        conversationMessages.push({
          type: 'decision_error',
          observation: result.observation,
          errorMessage: reason,
        });
      }
    }

    console.warn(
      `⚠️ [AgentRuntime-Agent-run] Agent达到最大轮次，执行降级 traceId=${traceId} maxTurns=${this.config.maxTurns}`,
    );
    return await this.fallback(input, traceId, enabledSkills);
  }

  // 在首轮模型决策前固定读取会话历史，避免模型为必需上下文额外消耗一轮决策。
  private async observeRecentMessagesBeforeDecision(
    schedule: Schedule,
    traceId: string,
    availableSkills: readonly SkillMetadata[],
    enabledSkills: readonly SkillContent[],
    loadedReferences: readonly SkillReferenceContent[],
    maxSkillReferences: number,
  ): Promise<ToolExecutionResult> {
    const scheduled = await schedule.dispatch(
      {
        type: 'tool',
        callId: `${traceId}:initial-context`,
        name: GET_RECENT_MESSAGES_TOOL_NAME,
        input: {},
        reason: '首轮决策前固定读取会话历史',
      },
      {
        availableSkills,
        enabledSkills,
        loadedSkillReferences: loadedReferences,
        maxSkillReferences,
      },
    );
    if (scheduled.type !== 'observed') throw new Error('前置工具未产生Observation');
    const result = toToolExecutionResult(scheduled.observation);
    if (!result.success) {
      console.warn(
        `⚠️ [AgentRuntime-Agent-context] 前置最近消息读取失败，已注入失败观察 traceId=${traceId} tool=${GET_RECENT_MESSAGES_TOOL_NAME} reason=${result.errorMessage ?? result.observation}`,
      );
    }
    return result;
  }

  // 将迁移中的旧工具和Skill能力统一注册为Tool，执行只经过Schedule。
  private createTools(input: AgentInput): Tool[] {
    const tools = [
      ...createRuntimeTools(this.toolRegistry, this.toolExecutor, input.event),
      ...(this.config.tools ?? []),
    ];
    if (!this.skillContentLoader) return tools;

    const skillTool = new SkillTool({
      load: async (name) => await this.skillContentLoader!.loadSkillContent(name),
      loadReference: async (skill, reference) => {
        if (!this.skillReferenceLoader) throw new Error('Skill引用读取器未配置');
        return await this.skillReferenceLoader.loadSkillReference(skill, reference);
      },
    });
    return [...tools, skillTool];
  }

  // 调用旧降级Agent，确保循环失效时仍能产生可用回复。
  private async fallback(
    input: AgentInput,
    traceId: string,
    enabledSkills: readonly SkillContent[],
  ): Promise<AgentResult> {
    const fallback = await this.fallbackAgent.generateReply({
      event: input.event,
      skills: enabledSkills,
      availableSkills: input.availableSkills,
    });
    return {
      type: 'reply',
      text: fallback.text,
      actions: fallback.actions,
      traceId,
    };
  }
}

// 将Schedule观察转换为迁移期Prompt仍使用的工具结果结构。
function toToolExecutionResult(observation: Observation): ToolExecutionResult {
  return {
    toolName: observation.tool,
    success: observation.status === 'success',
    observation: observation.summary,
    ...(observation.data === undefined ? {} : { structuredData: observation.data }),
    ...(observation.error === undefined ? {} : { errorMessage: observation.error }),
  };
}

// 只接受Tool显式返回的上下文消息，并同步本轮Skill快照。
function appendObservationContext(
  observation: Observation,
  messages: AgentMessage[],
  enabledSkills: SkillContent[],
  loadedReferences: SkillReferenceContent[],
): void {
  const contextMessages = readContextMessages(observation.data);
  for (const message of contextMessages) {
    if (message.type === 'skill_content') {
      if (enabledSkills.some((skill) => skill.metadata.name === message.skill.metadata.name)) {
        continue;
      }
      enabledSkills.push(message.skill);
    }
    if (message.type === 'skill_reference') {
      const key = toReferenceKey(message.reference);
      if (loadedReferences.some((reference) => toReferenceKey(reference) === key)) continue;
      loadedReferences.push(message.reference);
    }
    messages.push(message);
  }
}

// 从未知Tool数据中提取受支持的上下文消息。
function readContextMessages(data: unknown): AgentMessage[] {
  if (!isRecord(data) || !Array.isArray(data.contextMessages)) return [];
  const messages: AgentMessage[] = [];
  for (const message of data.contextMessages) {
    if (!isRecord(message)) continue;
    if (message.type === 'skill_content' && isSkillContent(message.skill)) {
      messages.push({ type: 'skill_content', skill: message.skill });
      continue;
    }
    if (message.type === 'skill_reference' && isSkillReference(message.reference)) {
      messages.push({ type: 'skill_reference', reference: message.reference });
    }
  }
  return messages;
}

// 校验Skill正文消息的最小形状。
function isSkillContent(input: unknown): input is SkillContent {
  return (
    isRecord(input) &&
    typeof input.body === 'string' &&
    isRecord(input.metadata) &&
    typeof input.metadata.name === 'string'
  );
}

// 校验Skill引用消息的最小形状。
function isSkillReference(input: unknown): input is SkillReferenceContent {
  return (
    isRecord(input) &&
    typeof input.referencePath === 'string' &&
    typeof input.content === 'string' &&
    isRecord(input.skill) &&
    typeof input.skill.name === 'string'
  );
}

// 根据统一Observation推进Prompt阶段，不区分具体Tool实现。
function resolveObservationPhase(observation: Observation): PromptPhase {
  if (observation.status !== 'success') return 'ready_to_decide';
  const contextMessages = readContextMessages(observation.data);
  if (contextMessages.some((message) => message.type === 'skill_reference')) {
    return 'reference_loaded';
  }
  if (contextMessages.some((message) => message.type === 'skill_content')) return 'skill_loaded';
  return 'tool_observing';
}

// 提取Action的日志和历史目标。
function getActionTarget(action: AgentAction): string | undefined {
  return action.type === 'tool' ? action.name : action.result;
}

// 读取未知对象中的非空文本。
function readText(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined;
}

// 判断未知值是否为普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

// 按名称去重平台预启用Skill，避免重复正文污染首轮上下文。
function deduplicateSkills(skills: readonly SkillContent[]): SkillContent[] {
  const skillByName = new Map<string, SkillContent>();
  for (const skill of skills) {
    if (!skillByName.has(skill.metadata.name)) skillByName.set(skill.metadata.name, skill);
  }
  return [...skillByName.values()];
}

// 已预启用Skill不再暴露为可请求目录，防止模型重复调用。
function excludeEnabledSkills(
  availableSkills: readonly SkillMetadata[],
  enabledSkills: readonly SkillContent[],
): SkillMetadata[] {
  const enabledSkillNames = new Set(enabledSkills.map((skill) => skill.metadata.name));
  return availableSkills.filter((skill) => !enabledSkillNames.has(skill.name));
}

/**
 * Agent到迁移期QQ回复入口的适配器
 *
 * 让现有 QQ 订阅器继续复用动作执行逻辑，降低 MVP 迁移风险。
 */
export class AgentAdapter implements QqReplyAgentPort {
  constructor(private readonly agent: Pick<Agent, 'run'>) {}

  /**
   * 生成QQ回复
   * @param input 标准消息事件
   * @returns 旧端口结果
   */
  async generateReply(input: QqReplyAgentInput): Promise<QqReplyAgentResult> {
    const result = await this.agent.run(input);

    if (result.type === 'reply') {
      return { text: result.text, actions: result.actions };
    }

    console.info(
      `⏭️ [AgentRuntime-Agent-generateReply] Agent未产生外发动作 resultType=${result.type} reason=${result.reason}`,
    );
    return {};
  }
}

// 将最终决策转为运行结果。
function toRunResult(action: FinishAction, traceId: string): AgentResult {
  if (action.result === 'reply') {
    const output = isRecord(action.output) ? action.output : {};
    return {
      type: 'reply',
      text: readText(output.text),
      actions: Array.isArray(output.actions)
        ? (output.actions as readonly QqReplyAction[])
        : undefined,
      traceId,
    };
  }

  if (action.result === 'ignore') {
    return {
      type: 'ignore',
      reason: action.reason,
      traceId,
    };
  }

  return {
    type: 'human_review',
    reason: action.reason,
    traceId,
  };
}

// 生成轻量追踪ID。
function createTraceId(eventId: string): string {
  return `agent-run:${eventId}:${Date.now().toString(36)}`;
}

// 脱敏消息ID。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}

// 压缩错误内容。
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// 构造本轮Prompt状态快照。
function buildPromptState(input: {
  readonly traceId: string;
  readonly phase: PromptPhase;
  readonly turnIndex: number;
  readonly maxTurns: number;
  readonly toolCallCount: number;
  readonly maxToolCalls: number;
  readonly skillReferenceCount: number;
  readonly maxSkillReferences: number;
  readonly decisionErrorCount: number;
  readonly availableSkillNames: readonly string[];
  readonly enabledSkillNames: readonly string[];
  readonly loadedReferenceKeys: readonly string[];
  readonly visibleToolNames: readonly string[];
  readonly latestObservation: string;
  readonly actionHistory: readonly PromptHistoryItem[];
}): PromptState {
  return {
    traceId: input.traceId,
    phase: input.phase,
    budget: {
      turnIndex: input.turnIndex,
      maxTurns: input.maxTurns,
      toolCallCount: input.toolCallCount,
      maxToolCalls: input.maxToolCalls,
      skillReferenceCount: input.skillReferenceCount,
      maxSkillReferences: input.maxSkillReferences,
      decisionErrorCount: input.decisionErrorCount,
    },
    context: {
      availableSkillNames: input.availableSkillNames,
      enabledSkillNames: input.enabledSkillNames,
      loadedReferenceKeys: input.loadedReferenceKeys,
      visibleToolNames: input.visibleToolNames,
      latestObservation: input.latestObservation,
    },
    actionHistory: input.actionHistory,
  };
}

// 记录模型决策历史，供下一轮Prompt明确状态来源。
function toActionHistoryItem(
  turnIndex: number,
  action: AgentAction,
  success: boolean,
): PromptHistoryItem {
  return {
    turnIndex,
    actionType: action.type,
    target: getActionTarget(action),
    success,
    reason: action.reason,
  };
}

// 提取最近一条可读观察。
function getLatestObservation(messages: readonly AgentMessage[]): string {
  const latest = [...messages].reverse().find((message) => {
    return message.type === 'tool_result' || message.type === 'decision_error';
  });

  if (!latest) return '尚无工具结果或错误观察。';
  if (latest.type === 'tool_result') return latest.result.observation;
  return latest.observation;
}

// 生成Skill引用状态键。
function toReferenceKey(reference: SkillReferenceContent): string {
  return `${reference.skill.name}:${reference.referencePath}`;
}

// 校验节奏门控触发的强制群聊回复是否已读取上下文并最终回复。
function validateRequiredGroupReply(
  action: FinishAction,
  toolResults: readonly ToolExecutionResult[],
): string | undefined {
  const hasRecentMessages = toolResults.some(
    (result) => result.toolName === 'get_recent_messages' && result.success,
  );

  if (!hasRecentMessages) {
    return '本轮由群聊节奏门控触发，但前置最近消息观察没有成功。必须重新调用 get_recent_messages 读取最近100条群消息，再基于上下文回复。请先返回 tool_call。';
  }

  if (action.result !== 'reply') {
    return '本轮由群聊节奏门控触发，已读取最近群消息后必须输出 reply，不能返回 ignore 或 human_review。请基于最近100条群消息给出一条自然短回复。';
  }

  const output = isRecord(action.output) ? action.output : {};
  const text = readText(output.text);
  const actions = Array.isArray(output.actions) ? output.actions : [];
  if (!text && actions.length === 0) {
    return '本轮由群聊节奏门控触发，reply 必须包含文本或受控动作，不能返回空回复。';
  }

  return undefined;
}
