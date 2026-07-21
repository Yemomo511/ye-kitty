import type { CodeAgentEvent } from '../lm/code-agent/event';
import type { CodeAgentRunner } from '../lm/code-agent/runner';
import type { Tool, ToolContext, ToolResult } from './tool';

/** Code Agent 工具输入。 */
interface CodeInput {
  readonly agentId: string;
  readonly prompt: string;
  readonly workdir: string;
  readonly model?: string;
}

/**
 * Code Agent 工具。
 *
 * 普通 Agent 只能通过该工具提交编码任务；创建会话、门禁和子进程生命周期仍由
 * LM 的 Code Agent 子模块负责，Schedule 继续拥有权限与审计入口。
 */
export class CodeTool implements Tool {
  readonly name = 'code';
  readonly description = '委托Code Agent在受控工作区内完成编码、分析或验证任务。';
  readonly risk = 'medium' as const;
  readonly input =
    '{"agentId":"claude-code或codex","prompt":"任务","workdir":"受控工作区","model":"可选模型"}';

  constructor(private readonly codeAgent: CodeAgentRunner) {}

  /** 提交任务并把终态输出转换为统一 ToolResult。 */
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const task = parseCodeInput(input);
    if (!task) {
      return {
        success: false,
        summary: 'Code工具输入无效，需要提供agentId、prompt和workdir。',
        error: 'Code工具输入无效',
      };
    }

    const session = await this.codeAgent.submit({ ...task, source: 'agent-runtime' });
    const output: string[] = [];
    let failure: string | undefined;

    const abort = async (): Promise<void> => await this.codeAgent.cancel(session.id);
    context.signal?.addEventListener('abort', abort, { once: true });
    try {
      for await (const event of session.events()) {
        collectEvent(event, output);
        if (event.type === 'error') failure = event.failure.message;
        if (event.type === 'tool_use') {
          await this.codeAgent.cancel(session.id);
          return {
            success: false,
            summary: `Code Agent 请求工具 ${event.name}，需要由外层 Agent 继续调度。`,
            data: { sessionId: session.id, tool: event },
            error: 'Code Agent请求外部工具',
          };
        }
      }
    } finally {
      context.signal?.removeEventListener('abort', abort);
    }

    const text = output.join('').trim();
    if (failure || session.status === 'failed') {
      return {
        success: false,
        summary: `Code Agent执行失败：${failure ?? session.failure?.message ?? '未知错误'}`,
        data: { sessionId: session.id, output: text },
        error: failure ?? session.failure?.message ?? 'Code Agent执行失败',
      };
    }
    return {
      success: true,
      summary: text || `Code Agent会话 ${session.id} 已完成。`,
      data: { sessionId: session.id, output: text },
    };
  }
}

// 只收集面向上层 Agent 的文本增量。
function collectEvent(event: CodeAgentEvent, output: string[]): void {
  if (event.type === 'text_delta') output.push(event.delta);
}

// 从不可信 Action 输入读取受控任务字段。
function parseCodeInput(input: unknown): CodeInput | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as Record<string, unknown>;
  const agentId = readString(value.agentId);
  const prompt = readString(value.prompt);
  const workdir = readString(value.workdir);
  const model = readString(value.model);
  if (!agentId || !prompt || !workdir) return undefined;
  return { agentId, prompt, workdir, ...(model ? { model } : {}) };
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result || undefined;
}
