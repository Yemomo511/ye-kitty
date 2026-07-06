import { isFinalAgentDecision } from '../domain/agent-decision';
import type { AgentDecision } from '../domain/agent-decision';
import type { AgentObservation } from '../domain/agent-observation';
import type { SkillContent } from '../domain/skill';
import type { ToolExecutionResult } from '../domain/tool';
import type { AgentRunnerPort } from '../ports/agent-runner.port';
import type {
  AgentRuntimeHarnessPort,
  AgentRuntimeRunInput,
  AgentRuntimeRunResult,
} from '../ports/agent-runtime-harness.port';
import type { ConversationHistoryPort } from '../ports/conversation-history.port';
import type { SkillContentLoaderPort } from '../ports/skill-content-loader.port';
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
}

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
    let toolCallCount = 0;

    // 1. 先写入当前消息，让本轮工具也能读取到刚进入的上下文。
    this.conversationHistory.recordMessage(input.event);
    console.info(
      `🚧 [AgentRuntime-Harness-run] 开始Harness循环 traceId=${traceId} conversationType=${input.event.conversationType} messageId=${maskId(
        input.event.message.id,
      )}`,
    );

    for (let turnIndex = 1; turnIndex <= this.config.maxTurns; turnIndex += 1) {
      const observation: AgentObservation = {
        event: input.event,
        availableSkills: input.availableSkills ?? [],
        enabledSkills: [...enabledSkills],
        tools: this.toolRegistry.listTools(),
        toolResults,
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
          return toRunResult(decision, traceId);
        }

        if (decision.type === 'skill_call') {
          toolResults.push(await this.enableSkill(decision, input, enabledSkills, traceId));
          continue;
        }

        if (toolCallCount >= this.config.maxToolCalls) {
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
          continue;
        }

        toolCallCount += 1;
        console.info(
          `🚧 [AgentRuntime-Harness-tool] 开始执行工具 traceId=${traceId} tool=${tool.name} turn=${turnIndex}`,
        );
        toolResults.push(
          await this.toolExecutor.execute({
            event: input.event,
            toolName: decision.toolName,
            input: decision.input,
          }),
        );
      } catch (error) {
        const reason = formatError(error);
        console.warn(
          `⚠️ [AgentRuntime-Harness-run] Agent决策失败，已转为下一轮观察 traceId=${traceId} turn=${turnIndex} reason=${reason}`,
        );
        toolResults.push({
          toolName: 'agent_decision',
          success: false,
          observation: `上一轮模型输出不可用，原因：${reason}。请重新输出合法 JSON 决策。`,
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
