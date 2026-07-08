import { isFinalAgentDecision } from '../domain/agent-decision';
import type { AgentDecision } from '../domain/agent-decision';
import type { AgentConversationMessage } from '../domain/agent-conversation-message';
import type { AgentObservation } from '../domain/agent-observation';
import type {
  HarnessPromptDecisionHistoryItem,
  HarnessPromptPhase,
  HarnessPromptState,
} from '../domain/harness-prompt-state';
import type { SkillContent } from '../domain/skill';
import type { SkillReferenceContent } from '../domain/skill-reference';
import type { ToolExecutionResult } from '../domain/tool';
import type { AgentRunnerPort } from '../ports/agent-runner.port';
import type {
  AgentRuntimeHarnessPort,
  AgentRuntimeRunInput,
  AgentRuntimeRunResult,
} from '../ports/agent-runtime-harness.port';
import type { ConversationHistoryPort } from '../ports/conversation-history.port';
import type { SkillContentLoaderPort } from '../ports/skill-content-loader.port';
import type { SkillReferenceLoaderPort } from '../ports/skill-reference-loader.port';
import type { RuntimeToolExecutorPort } from '../ports/tool-executor.port';
import type { RuntimeToolRegistryPort } from '../ports/tool-registry.port';
import type {
  QqReplyAgentInput,
  QqReplyAgentPort,
  QqReplyAgentResult,
} from '../ports/qq-reply-agent.port';

/**
 * Harness运行配置
 *
 * 控制单次 Agent 循环的轮次、工具调用预算和降级路径。
 */
export interface AgentRuntimeHarnessConfig {
  /** 最大轮次 */
  readonly maxTurns: number;
  /** 最大工具次数 */
  readonly maxToolCalls: number;
  /** 最大Skill引用读取数 */
  readonly maxSkillReferences?: number;
}

const DEFAULT_MAX_SKILL_REFERENCES = 3;

/**
 * Agent Runtime Harness
 *
 * 负责把模型响应控制在循环中治理：模型只输出决策，工具调用和最终动作都由 Harness 收敛。
 */
export class AgentRuntimeHarness implements AgentRuntimeHarnessPort {
  constructor(
    private readonly runner: AgentRunnerPort,
    private readonly toolRegistry: RuntimeToolRegistryPort,
    private readonly toolExecutor: RuntimeToolExecutorPort,
    private readonly conversationHistory: ConversationHistoryPort,
    private readonly skillContentLoader: SkillContentLoaderPort | undefined,
    private readonly skillReferenceLoader: SkillReferenceLoaderPort | undefined,
    private readonly fallbackAgent: QqReplyAgentPort,
    private readonly config: AgentRuntimeHarnessConfig,
  ) {}

  /**
   * 运行Harness循环
   * @param input 平台事件和Skill
   * @returns 最终决策
   */
  async run(input: AgentRuntimeRunInput): Promise<AgentRuntimeRunResult> {
    const traceId = createTraceId(input.event.id);
    const toolResults: ToolExecutionResult[] = [];
    const enabledSkills: SkillContent[] = [];
    const loadedReferences: SkillReferenceContent[] = [];
    const decisionHistory: HarnessPromptDecisionHistoryItem[] = [];
    const conversationMessages: AgentConversationMessage[] = [
      { type: 'user_event', event: input.event },
      { type: 'skill_catalog', skills: input.availableSkills ?? [] },
    ];
    let phase: HarnessPromptPhase = 'initial_observe';
    let toolCallCount = 0;
    let decisionErrorCount = 0;
    const maxSkillReferences = this.config.maxSkillReferences ?? DEFAULT_MAX_SKILL_REFERENCES;

    // 1. 先写入当前消息，让本轮工具也能读取到刚进入的上下文。
    this.conversationHistory.recordMessage(input.event);
    console.info(
      `🚧 [AgentRuntime-Harness-run] 开始Harness循环 traceId=${traceId} conversationType=${input.event.conversationType} messageId=${maskId(
        input.event.message.id,
      )}`,
    );

    for (let turnIndex = 1; turnIndex <= this.config.maxTurns; turnIndex += 1) {
      const tools = this.toolRegistry.listTools();
      const observation: AgentObservation = {
        event: input.event,
        availableSkills: input.availableSkills ?? [],
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
          availableSkillNames: (input.availableSkills ?? []).map((skill) => skill.name),
          enabledSkillNames: enabledSkills.map((skill) => skill.metadata.name),
          loadedReferenceKeys: loadedReferences.map(toReferenceKey),
          visibleToolNames: tools.map((tool) => tool.name),
          latestObservation: getLatestObservation(conversationMessages),
          decisionHistory,
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
        const decision = await this.runner.decide(observation);
        console.info(
          `🔍 [AgentRuntime-Harness-run] 已获得Agent决策 traceId=${traceId} turn=${turnIndex} decisionType=${decision.type}`,
        );

        if (isFinalAgentDecision(decision)) {
          const requiredReplyViolation = validateRequiredGroupReply(decision, toolResults);
          if (input.replyIntent === 'required_group_reply' && requiredReplyViolation) {
            decisionErrorCount += 1;
            phase = 'ready_to_decide';
            decisionHistory.push(toDecisionHistoryItem(turnIndex, decision, false));
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
              `⚠️ [AgentRuntime-Harness-run] 强制群聊回复协议未满足，已转为下一轮观察 traceId=${traceId} turn=${turnIndex} decisionType=${decision.type}`,
            );
            continue;
          }

          phase = decision.type === 'human_review' ? 'human_review' : 'finalized';
          decisionHistory.push(toDecisionHistoryItem(turnIndex, decision, true));
          return toRunResult(decision, traceId);
        }

        if (decision.type === 'skill_call') {
          const result = await this.enableSkill(
            decision,
            input,
            enabledSkills,
            conversationMessages,
            traceId,
          );
          toolResults.push(result);
          conversationMessages.push({ type: 'tool_result', result });
          phase = result.success ? 'skill_loaded' : 'ready_to_decide';
          decisionHistory.push(toDecisionHistoryItem(turnIndex, decision, result.success));
          continue;
        }

        if (decision.type === 'skill_reference_call') {
          const result = await this.loadSkillReference(
            decision,
            enabledSkills,
            loadedReferences,
            conversationMessages,
            traceId,
            maxSkillReferences,
          );
          toolResults.push(result);
          conversationMessages.push({ type: 'tool_result', result });
          phase = result.success ? 'reference_loaded' : 'ready_to_decide';
          decisionHistory.push(toDecisionHistoryItem(turnIndex, decision, result.success));
          continue;
        }

        if (toolCallCount >= this.config.maxToolCalls) {
          phase = 'fallback';
          decisionHistory.push(toDecisionHistoryItem(turnIndex, decision, false));
          console.warn(
            `⚠️ [AgentRuntime-Harness-run] 工具调用已超出预算，执行降级 traceId=${traceId} maxToolCalls=${this.config.maxToolCalls}`,
          );
          return await this.fallback(input, traceId, enabledSkills);
        }

        const tool = this.toolRegistry.getTool(decision.toolName);
        if (!tool) {
          toolResults.push({
            toolName: decision.toolName,
            success: false,
            observation: `工具 ${decision.toolName} 未注册，不能执行。`,
            errorMessage: '工具未注册',
          });
          conversationMessages.push({
            type: 'decision_error',
            observation: `工具 ${decision.toolName} 未注册，不能执行。`,
            errorMessage: '工具未注册',
          });
          phase = 'ready_to_decide';
          decisionHistory.push(toDecisionHistoryItem(turnIndex, decision, false));
          continue;
        }

        toolCallCount += 1;
        console.info(
          `🚧 [AgentRuntime-Harness-tool] 开始执行工具 traceId=${traceId} tool=${tool.name} turn=${turnIndex}`,
        );
        const result = await this.toolExecutor.execute({
          event: input.event,
          toolName: decision.toolName,
          input: decision.input,
        });
        toolResults.push(result);
        conversationMessages.push({ type: 'tool_result', result });
        phase = result.success ? 'tool_observing' : 'ready_to_decide';
        decisionHistory.push(toDecisionHistoryItem(turnIndex, decision, result.success));
      } catch (error) {
        const reason = formatError(error);
        decisionErrorCount += 1;
        phase = 'ready_to_decide';
        console.warn(
          `⚠️ [AgentRuntime-Harness-run] Agent决策失败，已转为下一轮观察 traceId=${traceId} turn=${turnIndex} reason=${reason}`,
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
      `⚠️ [AgentRuntime-Harness-run] Harness达到最大轮次，执行降级 traceId=${traceId} maxTurns=${this.config.maxTurns}`,
    );
    return await this.fallback(input, traceId, enabledSkills);
  }

  // 调用旧降级Agent，确保循环失效时仍能产生可用回复。
  private async fallback(
    input: AgentRuntimeRunInput,
    traceId: string,
    enabledSkills: readonly SkillContent[],
  ): Promise<AgentRuntimeRunResult> {
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

  // 按需启用Skill正文，把方法论注入下一轮模型上下文。
  private async enableSkill(
    decision: Extract<AgentDecision, { readonly type: 'skill_call' }>,
    input: AgentRuntimeRunInput,
    enabledSkills: SkillContent[],
    conversationMessages: AgentConversationMessage[],
    traceId: string,
  ): Promise<ToolExecutionResult> {
    const availableSkill = input.availableSkills?.find(
      (skill) => skill.name === decision.skillName,
    );
    if (!availableSkill) {
      return {
        toolName: `skill_call:${decision.skillName}`,
        success: false,
        observation: `Skill ${decision.skillName} 当前不在本轮可用目录中。请基于可用 Skill 或可见 Tool 重新决策。`,
        errorMessage: 'Skill不可用',
      };
    }

    if (enabledSkills.some((skill) => skill.metadata.name === decision.skillName)) {
      return {
        toolName: `skill_call:${decision.skillName}`,
        success: true,
        observation: `Skill ${decision.skillName} 已在本轮启用，正文已注入当前上下文。请直接遵守该 Skill 正文。`,
      };
    }

    if (!this.skillContentLoader) {
      return {
        toolName: `skill_call:${decision.skillName}`,
        success: false,
        observation: `Skill ${decision.skillName} 当前无法启用，原因：Skill正文加载器未配置。请改用可见 Tool 或转人工。`,
        errorMessage: 'Skill正文加载器未配置',
      };
    }

    try {
      const content = await this.skillContentLoader.loadSkillContent(availableSkill.name);
      enabledSkills.push(content);
      conversationMessages.push({ type: 'skill_content', skill: content });
      console.info(
        `✅ [AgentRuntime-Harness-skill] Skill正文已注入 traceId=${traceId} skill=${availableSkill.name} bodyLength=${content.body.length}`,
      );
      return {
        toolName: `skill_call:${decision.skillName}`,
        success: true,
        observation: `Skill ${decision.skillName} 已启用，正文将在下一轮模型上下文中生效。`,
      };
    } catch (error) {
      const reason = formatError(error);
      console.warn(
        `⚠️ [AgentRuntime-Harness-skill] Skill正文加载失败，已转为下一轮观察 skill=${availableSkill.name} reason=${reason}`,
      );
      return {
        toolName: `skill_call:${decision.skillName}`,
        success: false,
        observation: `Skill ${decision.skillName} 启用失败，原因：${reason}。请改用其他可用 Skill、可见 Tool 或转人工。`,
        errorMessage: reason,
      };
    }
  }

  // 按需读取已启用Skill的references文件。
  private async loadSkillReference(
    decision: Extract<AgentDecision, { readonly type: 'skill_reference_call' }>,
    enabledSkills: readonly SkillContent[],
    loadedReferences: SkillReferenceContent[],
    conversationMessages: AgentConversationMessage[],
    traceId: string,
    maxSkillReferences: number,
  ): Promise<ToolExecutionResult> {
    const enabledSkill = enabledSkills.find((skill) => skill.metadata.name === decision.skillName);
    if (!enabledSkill) {
      return {
        toolName: `skill_reference_call:${decision.skillName}`,
        success: false,
        observation: `Skill ${decision.skillName} 尚未启用，不能读取 references。请先通过 skill_call 启用该 Skill。`,
        errorMessage: 'Skill未启用',
      };
    }

    const referenceKey = `${decision.skillName}:${decision.referencePath}`;
    if (
      loadedReferences.some(
        (reference) => `${reference.skill.name}:${reference.referencePath}` === referenceKey,
      )
    ) {
      return {
        toolName: `skill_reference_call:${decision.skillName}`,
        success: true,
        observation: `Skill ${decision.skillName} 的引用 ${decision.referencePath} 已读取，请直接使用现有引用观察。`,
      };
    }

    if (loadedReferences.length >= maxSkillReferences) {
      return {
        toolName: `skill_reference_call:${decision.skillName}`,
        success: false,
        observation: `Skill引用读取已达到本轮上限 ${maxSkillReferences}，请基于现有上下文决策。`,
        errorMessage: 'Skill引用读取超限',
      };
    }

    if (!this.skillReferenceLoader) {
      return {
        toolName: `skill_reference_call:${decision.skillName}`,
        success: false,
        observation: `Skill ${decision.skillName} 当前无法读取 references，原因：Skill引用加载器未配置。`,
        errorMessage: 'Skill引用加载器未配置',
      };
    }

    try {
      const reference = await this.skillReferenceLoader.loadSkillReference(
        enabledSkill,
        decision.referencePath,
      );
      loadedReferences.push(reference);
      conversationMessages.push({ type: 'skill_reference', reference });
      console.info(
        `✅ [AgentRuntime-Harness-skillReference] Skill引用已注入 traceId=${traceId} skill=${decision.skillName} reference=${reference.referencePath} length=${reference.content.length}`,
      );
      return {
        toolName: `skill_reference_call:${decision.skillName}`,
        success: true,
        observation: `Skill ${decision.skillName} 的引用 ${reference.referencePath} 已读取，并将在下一轮模型上下文中生效。`,
      };
    } catch (error) {
      const reason = formatError(error);
      console.warn(
        `⚠️ [AgentRuntime-Harness-skillReference] Skill引用加载失败，已转为下一轮观察 skill=${decision.skillName} reference=${decision.referencePath} reason=${reason}`,
      );
      return {
        toolName: `skill_reference_call:${decision.skillName}`,
        success: false,
        observation: `Skill ${decision.skillName} 的引用 ${decision.referencePath} 读取失败，原因：${reason}。`,
        errorMessage: reason,
      };
    }
  }
}

/**
 * Harness到旧QQ回复端口的适配器
 *
 * 让现有 QQ 订阅器继续复用动作执行逻辑，降低 MVP 迁移风险。
 */
export class HarnessQqReplyAgentAdapter implements QqReplyAgentPort {
  constructor(private readonly harness: AgentRuntimeHarnessPort) {}

  /**
   * 生成QQ回复
   * @param input 标准消息事件
   * @returns 旧端口结果
   */
  async generateReply(input: QqReplyAgentInput): Promise<QqReplyAgentResult> {
    const result = await this.harness.run(input);

    if (result.type === 'reply') {
      return { text: result.text, actions: result.actions };
    }

    console.info(
      `⏭️ [AgentRuntime-HarnessAdapter-generateReply] Harness未产生外发动作 resultType=${result.type} reason=${result.reason}`,
    );
    return {};
  }
}

// 将最终决策转为运行结果。
function toRunResult(decision: AgentDecision, traceId: string): AgentRuntimeRunResult {
  if (decision.type === 'reply') {
    return {
      type: 'reply',
      text: decision.text,
      actions: decision.actions,
      traceId,
    };
  }

  if (decision.type === 'ignore') {
    return {
      type: 'ignore',
      reason: decision.reason,
      traceId,
    };
  }

  return {
    type: 'human_review',
    reason: decision.reason,
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
  readonly phase: HarnessPromptPhase;
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
  readonly decisionHistory: readonly HarnessPromptDecisionHistoryItem[];
}): HarnessPromptState {
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
    decisionHistory: input.decisionHistory,
  };
}

// 记录模型决策历史，供下一轮Prompt明确状态来源。
function toDecisionHistoryItem(
  turnIndex: number,
  decision: AgentDecision,
  success: boolean,
): HarnessPromptDecisionHistoryItem {
  return {
    turnIndex,
    decisionType: decision.type,
    target: getDecisionTarget(decision),
    success,
    reason: decision.reason,
  };
}

// 提取决策目标名称。
function getDecisionTarget(decision: AgentDecision): string | undefined {
  if (decision.type === 'skill_call' || decision.type === 'skill_reference_call') {
    return decision.skillName;
  }

  if (decision.type === 'tool_call') {
    return decision.toolName;
  }

  return undefined;
}

// 提取最近一条可读观察。
function getLatestObservation(messages: readonly AgentConversationMessage[]): string {
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
  decision: AgentDecision,
  toolResults: readonly ToolExecutionResult[],
): string | undefined {
  const hasRecentMessages = toolResults.some(
    (result) => result.toolName === 'get_recent_messages' && result.success,
  );

  if (!hasRecentMessages) {
    return '本轮由群聊节奏门控触发，必须先调用 get_recent_messages 读取最近100条群消息，再基于上下文回复。请先返回 tool_call。';
  }

  if (decision.type !== 'reply') {
    return '本轮由群聊节奏门控触发，已读取最近群消息后必须输出 reply，不能返回 ignore 或 human_review。请基于最近100条群消息给出一条自然短回复。';
  }

  if (!decision.text?.trim() && (!decision.actions || decision.actions.length === 0)) {
    return '本轮由群聊节奏门控触发，reply 必须包含文本或受控动作，不能返回空回复。';
  }

  return undefined;
}
