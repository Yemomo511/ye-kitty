import type { AgentAction, ToolAction } from '../action';
import type { Observation } from '../observation';
import { writeDebugLog } from '../../shared/logging';
import type { ToolExecutor } from '../tools/executor';
import type { ToolPermission } from '../tools/permission';
import type { ToolRegistry } from '../tools/registry';
import type { AgentToolContext, ToolContext } from '../tools/tool';
import type { ScheduleResult } from './result';
import { ToolDispatcher } from './dispatcher';

/**
 * Agent Action 调度器
 *
 * 负责把 FinishAction 转为最终结果，把 ToolAction 依次经过工具定位、权限判断
 * 和执行器转换为 Observation。调度器不依赖任何具体工具实现。
 */
export class Schedule {
  private readonly dispatcher: ToolDispatcher;

  constructor(
    registry: ToolRegistry,
    private readonly executor: ToolExecutor,
    private readonly permission: ToolPermission,
  ) {
    this.dispatcher = new ToolDispatcher(registry);
  }

  /**
   * 调度 Agent Action
   * @param action Agent 单轮动作
   * @param agentContext 本轮Agent运行上下文
   * @returns 最终结果或工具观察
   */
  async dispatch<TOutput>(
    action: AgentAction<TOutput>,
    agentContext: AgentToolContext = {},
  ): Promise<ScheduleResult<TOutput>> {
    if (action.type === 'finish') return { type: 'finished', action };

    writeDebugLog(
      `🔍 [AgentRuntime-Schedule-dispatch] 开始调度工具 action=${action.name} callId=${action.callId}`,
    );
    return { type: 'observed', observation: await this.dispatchTool(action, agentContext) };
  }

  // 调度单次工具调用并归一化结果。
  private async dispatchTool(
    action: ToolAction,
    agentContext: AgentToolContext,
  ): Promise<Observation> {
    const tool = this.dispatcher.find(action.name);
    if (!tool) {
      return {
        callId: action.callId,
        tool: action.name,
        status: 'error',
        summary: `工具 ${action.name} 未注册，不能执行。`,
        error: '工具未注册',
      };
    }

    const context: ToolContext = { ...agentContext, callId: action.callId };
    const permission = await this.permission.check(tool, context);
    if (permission.status !== 'allowed') {
      return {
        callId: action.callId,
        tool: action.name,
        status: permission.status,
        summary: permission.reason,
      };
    }

    const result = await this.executor.execute(tool, action.input, context);
    const observation: Observation = {
      callId: action.callId,
      tool: action.name,
      status: result.success ? 'success' : 'error',
      summary: result.summary,
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(result.retryable === undefined ? {} : { retryable: result.retryable }),
    };
    writeDebugLog(
      `🔍 [AgentRuntime-Schedule-dispatch] 工具调度完成 action=${action.name} callId=${action.callId} status=${observation.status}`,
    );
    return observation;
  }
}
