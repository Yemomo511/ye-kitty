import { randomUUID } from 'node:crypto';
import type { PlatformMessage } from '@kitty/platforms/message';
import type { ConversationHistoryPort } from './history-type';
import type { LMRunner } from './lm/lm';
import { composeAgentInput, composeAgentInstructions } from './prompt/composer';
import type {
  QqReplyAgentInput,
  QqReplyAgentPort,
  QqReplyAgentResult,
  QqReplyAction,
} from './runtime';
import type { SkillRuntime } from './skills';
import { AgentRunState, type AgentTerminalResult } from './state';
import {
  createFinishTool,
  createMessageTools,
  createSkillTool,
  GET_RECENT_MESSAGES_TOOL_NAME,
  materializeTool,
  mergeToolSources,
  Tool,
  ToolRegistry,
  type CanonicalTool,
  type MessageToolDependencies,
  type ToolSource,
} from './tools';

/** Agent单次运行输入。 */
export interface AgentInput {
  /** 标准聊天事件 */
  readonly event: PlatformMessage;
  /** 本轮可请求的Skill目录 */
  readonly availableSkills?: QqReplyAgentInput['availableSkills'];
  /** 平台边界预启用的Skill正文 */
  readonly skills?: QqReplyAgentInput['skills'];
  /** 本轮回复意图 */
  readonly replyIntent?: QqReplyAgentInput['replyIntent'];
  /** 兼容平台入口的必要工具提示，由系统自行执行 */
  readonly requiredToolCalls?: readonly string[];
  /** 最近消息窗口提示 */
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

/** Agent运行配置。 */
export interface AgentConfig {
  /** 官方Runner最大模型轮次 */
  readonly maxTurns: number;
  /** 最大普通工具次数 */
  readonly maxToolCalls: number;
  /** 最大Skill引用读取数 */
  readonly maxSkillReferences?: number;
  /** 由Bootstrap注入并命名的静态Tool */
  readonly tools?: Readonly<Record<string, CanonicalTool>>;
}

/** Agent依赖。 */
export interface AgentDependencies {
  /** 官方工具循环 */
  readonly lm: LMRunner;
  /** 会话历史 */
  readonly conversationHistory: ConversationHistoryPort;
  /** Skill渐进读取 */
  readonly skillRuntime?: Pick<SkillRuntime, 'load' | 'loadReference'>;
  /** 模型不可用时的降级入口 */
  readonly fallbackAgent: QqReplyAgentPort;
  /** MCP等动态Tool来源 */
  readonly toolSources?: readonly ToolSource[];
  /** 消息工具依赖 */
  readonly messageTools?: MessageToolDependencies;
  /** 运行配置 */
  readonly config: AgentConfig;
  /** Agent展示名称 */
  readonly agentName: string;
}

const DEFAULT_MAX_SKILL_REFERENCES = 3;

/**
 * Agent运行编排
 *
 * 官方Runner维护模型与FunctionTool循环。本类只创建系统状态、固定本轮Tool快照、
 * 执行必要前置观察并读取finish提交的可信终态。
 */
export class Agent {
  constructor(private readonly dependencies: AgentDependencies) {}

  /**
   * 运行Agent
   * @param input 平台事件和Skill
   * @returns 系统确认的最终结果
   */
  async run(input: AgentInput): Promise<AgentResult> {
    const runId = randomUUID();
    const traceId = createTraceId(input.event.id, runId);
    const controller = new AbortController();
    const state = new AgentRunState({
      runId,
      traceId,
      agentName: this.dependencies.agentName,
      event: input.event,
      availableSkills: input.availableSkills ?? [],
      enabledSkills: input.skills ?? [],
      replyIntent: input.replyIntent ?? 'normal',
      maxToolCalls: this.dependencies.config.maxToolCalls,
      maxSkillReferences:
        this.dependencies.config.maxSkillReferences ?? DEFAULT_MAX_SKILL_REFERENCES,
    });

    this.dependencies.conversationHistory.recordMessage(input.event);
    const registry = this.createToolRegistry(state, input.event);
    const toolSnapshot = registry.snapshot();
    state.bindToolSnapshot(toolSnapshot.names());
    const recentMessages = await this.observeRecentMessages(registry, state, controller.signal);
    const sdkTools = [...toolSnapshot.entries].map(([name, tool]) => materializeTool(name, tool));
    console.info(
      `🚧 [AgentRuntime-Agent-run] 开始官方工具循环 traceId=${traceId} conversationType=${input.event.conversationType} toolCount=${sdkTools.length} enabledSkillCount=${state.enabledSkills.length} recentMessagesReady=${state.recentMessagesReady} messageId=${maskId(input.event.message.id)}`,
    );

    try {
      const result = await this.dependencies.lm.run({
        context: state.createToolContext(controller.signal),
        input: composeAgentInput(state, recentMessages),
        instructions: () => composeAgentInstructions(this.dependencies.agentName, state),
        tools: sdkTools,
        maxTurns: this.dependencies.config.maxTurns,
        priority: resolvePriority(input),
        signal: controller.signal,
      });

      if (result.interruptions.length > 0) {
        const targets = result.interruptions.map((item) => item.toolName).join('、');
        console.warn(
          `⚠️ [AgentRuntime-Agent-approval] 工具调用等待审批 traceId=${traceId} tools=${targets}`,
        );
        return {
          type: 'human_review',
          reason: `工具 ${targets} 需要人工审批后继续`,
          traceId,
        };
      }
      if (state.terminal) return attachTraceId(state.terminal, traceId);

      console.warn(
        `⚠️ [AgentRuntime-Agent-fallback] 官方循环未通过finish提交终态，执行降级 traceId=${traceId}`,
      );
      return await this.fallback(input, state, traceId);
    } catch (error) {
      console.warn(
        `⚠️ [AgentRuntime-Agent-fail] 官方工具循环失败，执行降级 traceId=${traceId} reason=${formatError(error)}`,
      );
      return await this.fallback(input, state, traceId);
    } finally {
      controller.abort(new Error('Agent运行已结束'));
    }
  }

  // 构造单次运行唯一注册表，动态来源在此刻冻结为快照。
  private createToolRegistry(state: AgentRunState, event: PlatformMessage): ToolRegistry {
    const registry = new ToolRegistry();
    registry.registerMany(
      createMessageTools(
        event,
        this.dependencies.conversationHistory,
        this.dependencies.messageTools,
      ),
    );
    registry.registerMany(mergeToolSources(this.dependencies.toolSources ?? []));
    registry.registerMany(this.dependencies.config.tools ?? {});
    if (this.dependencies.skillRuntime) {
      registry.register('skill', createSkillTool(this.dependencies.skillRuntime, state));
    }
    registry.register('finish', createFinishTool(state));
    return registry;
  }

  // 首轮模型请求前固定读取最近消息，并免除普通工具预算。
  private async observeRecentMessages(
    registry: ToolRegistry,
    state: AgentRunState,
    signal: AbortSignal,
  ) {
    const tool = registry.get(GET_RECENT_MESSAGES_TOOL_NAME);
    if (!tool) throw new Error(`缺少必要工具 ${GET_RECENT_MESSAGES_TOOL_NAME}`);
    const settlement = await Tool.settle(
      GET_RECENT_MESSAGES_TOOL_NAME,
      tool,
      {},
      {
        ...state.createToolContext(signal, true),
        callId: `system-${randomUUID()}`,
      },
    );
    if (settlement.status !== 'success') {
      console.warn(
        `⚠️ [AgentRuntime-Agent-context] 前置最近消息读取失败 traceId=${settlement.audit.traceId} status=${settlement.status}`,
      );
    }
    return Tool.toModelOutput(tool, settlement);
  }

  // 调用降级Agent，保证主模型失效时仍能产生可用回复。
  private async fallback(
    input: AgentInput,
    state: AgentRunState,
    traceId: string,
  ): Promise<AgentResult> {
    const fallback = await this.dependencies.fallbackAgent.generateReply({
      event: input.event,
      skills: state.enabledSkills,
      availableSkills: state.availableSkills,
    });
    return {
      type: 'reply',
      text: fallback.text,
      actions: fallback.actions,
      traceId,
    };
  }
}

/**
 * Agent到QQ回复入口的适配器。
 */
export class AgentAdapter implements QqReplyAgentPort {
  constructor(private readonly agent: Pick<Agent, 'run'>) {}

  /**
   * 生成QQ回复
   * @param input 标准消息事件
   * @returns 文本或受控动作
   */
  async generateReply(input: QqReplyAgentInput): Promise<QqReplyAgentResult> {
    const result = await this.agent.run(input);
    if (result.type === 'reply') {
      return { text: result.text, actions: result.actions };
    }
    console.info(
      `⏭️ [AgentRuntime-Agent-adapter] Agent未产生外发动作 resultType=${result.type} reason=${result.reason}`,
    );
    return {};
  }
}

// 为系统终态补充运行追踪ID。
function attachTraceId(result: AgentTerminalResult, traceId: string): AgentResult {
  return { ...result, traceId };
}

// 根据平台触发语义确定系统模型调度优先级。
function resolvePriority(input: AgentInput): 'high' | 'normal' | 'low' {
  if (input.event.conversationType === 'private') return 'high';
  if (input.event.message.mentions.length > 0) return 'high';
  if (input.replyIntent === 'required_group_reply') return 'low';
  return 'normal';
}

// 生成不进入模型Prompt的追踪ID。
function createTraceId(eventId: string, runId: string): string {
  return `agent-run:${eventId}:${runId.slice(0, 8)}`;
}

// 脱敏消息ID。
function maskId(value: string): string {
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`;
}

// 压缩错误内容用于日志。
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
