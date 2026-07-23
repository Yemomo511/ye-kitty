import {
  Agent as SdkAgent,
  Runner,
  type FunctionTool,
  type RunContext,
  type RunToolApprovalItem,
} from '@openai/agents';
import type { ToolRuntimeContext } from '../tools';
import type { ModelPoolRunner, ModelRequestPriority } from './model';
import { ModelRequestError } from './error';

/** LM运行配置。 */
export interface LMConfig {
  /** Agent展示名称 */
  readonly agentName: string;
  /** 整次Agent运行超时毫秒 */
  readonly timeoutMs: number;
}

/** 官方Agent循环请求。 */
export interface LMRunRequest {
  /** 系统运行上下文 */
  readonly context: ToolRuntimeContext;
  /** 初始用户输入 */
  readonly input: string;
  /** 动态系统指令 */
  readonly instructions: (context: ToolRuntimeContext) => string;
  /** 本轮官方FunctionTool */
  readonly tools: readonly FunctionTool<ToolRuntimeContext>[];
  /** 最大模型轮次 */
  readonly maxTurns: number;
  /** 请求优先级 */
  readonly priority: ModelRequestPriority;
  /** 外层取消信号 */
  readonly signal?: AbortSignal;
}

/** 需要系统处理的审批中断。 */
export interface LMApprovalInterruption {
  /** 工具名称 */
  readonly toolName: string;
  /** SDK调用ID */
  readonly callId: string;
}

/** 官方Agent循环结果。 */
export interface LMRunResult {
  /** SDK最终输出，仅用于诊断；业务终态由finish工具维护 */
  readonly finalOutput?: unknown;
  /** 未决审批 */
  readonly interruptions: readonly LMApprovalInterruption[];
  /** 可用于后续审批恢复的SDK状态 */
  readonly state?: unknown;
}

/** Agent只依赖这一项语言模型循环能力。 */
export interface LMRunner {
  /**
   * 运行官方Agents SDK循环
   * @param request 系统构造的运行请求
   * @returns 终止输出或审批中断
   */
  run(request: LMRunRequest): Promise<LMRunResult>;
}

/**
 * Agent语言模型入口
 *
 * 工具选择和多轮调用交给官方Runner；Tool结算、权限、预算、Effect与终态
 * 仍由Ye-Kitty运行时维护。
 */
export class LM implements LMRunner {
  private readonly runner = new Runner({
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
    toolNotFoundBehavior: 'return_error_to_model',
  });

  constructor(
    private readonly config: LMConfig,
    private readonly modelPool: ModelPoolRunner,
  ) {}

  /**
   * 运行官方工具循环
   * @param request 单次运行参数
   * @returns 官方循环结果
   */
  async run(request: LMRunRequest): Promise<LMRunResult> {
    const model = this.modelPool.acquireModel({
      priority: request.priority,
      source: 'agent-runtime',
    });
    const agent = new SdkAgent<ToolRuntimeContext>({
      name: this.config.agentName,
      model,
      instructions: (runContext: RunContext<ToolRuntimeContext>) =>
        request.instructions(runContext.context),
      tools: [...request.tools],
      toolUseBehavior: { stopAtToolNames: ['finish'] },
      modelSettings: {
        parallelToolCalls: false,
      },
    });
    const cancellation = createRunCancellation(this.config.timeoutMs, request.signal);

    try {
      const result = await this.runner.run(agent, request.input, {
        context: request.context,
        maxTurns: request.maxTurns,
        signal: cancellation.signal,
      });
      const interruptions = result.interruptions.map(toApprovalInterruption);
      return {
        finalOutput: interruptions.length > 0 ? undefined : result.finalOutput,
        interruptions,
        state: interruptions.length > 0 ? result.state : undefined,
      };
    } catch (error) {
      if (cancellation.timedOut()) {
        throw new ModelRequestError(`Agent运行超过 ${this.config.timeoutMs}ms`, {
          reason: '请求超时',
        });
      }
      throw error;
    } finally {
      cancellation.dispose();
    }
  }
}

// 从SDK审批项提取系统继续处理所需的稳定字段。
function toApprovalInterruption(item: RunToolApprovalItem): LMApprovalInterruption {
  const raw = item.rawItem;
  const callId = 'callId' in raw && typeof raw.callId === 'string' ? raw.callId : 'unknown';
  return {
    toolName: item.name ?? 'unknown',
    callId,
  };
}

// 合并外层取消与整次运行超时。
function createRunCancellation(
  timeoutMs: number,
  external?: AbortSignal,
): {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  let timeoutReached = false;
  const onExternalAbort = () => controller.abort(external?.reason);
  external?.addEventListener('abort', onExternalAbort, { once: true });
  if (external?.aborted) controller.abort(external.reason);

  const timeout = setTimeout(() => {
    timeoutReached = true;
    controller.abort(new Error('Agent运行超时'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      clearTimeout(timeout);
      external?.removeEventListener('abort', onExternalAbort);
    },
  };
}
