import type { CodeAgentEvent } from '../lm/code-agent/event';
import type { CodeAgentRunner } from '../lm/code-agent/runner';
import { z } from 'zod';
import { Tool, type Tool as CanonicalTool } from './tool';

/**
 * 创建Code Agent工具
 * @param codeAgent 受控Code Agent入口
 * @returns 需要审批的规范Tool
 */
export function createCodeTool(codeAgent: CodeAgentRunner): CanonicalTool {
  return Tool.make({
    description: '委托Code Agent在受控工作区内完成编码、分析或验证任务。',
    parameters: z
      .object({
        agentId: z.string().trim().min(1).describe('claude-code或codex'),
        prompt: z.string().trim().min(1).describe('编码任务'),
        workdir: z.string().trim().min(1).describe('受控工作区'),
        model: z.string().trim().min(1).optional().describe('可选模型'),
      })
      .strict(),
    policy: {
      source: 'code',
      risk: 'medium',
      approval: 'required',
      timeoutMs: 300000,
      consumesBudget: true,
    },
    execute: async (
      input: {
        agentId: string;
        prompt: string;
        workdir: string;
        model?: string;
      },
      context,
    ) => {
      const session = await codeAgent.submit({ ...input, source: 'agent-runtime' });
      const output: string[] = [];
      let failure: string | undefined;

      const abort = async (): Promise<void> => await codeAgent.cancel(session.id);
      context.signal.addEventListener('abort', abort, { once: true });
      try {
        for await (const event of session.events()) {
          collectEvent(event, output);
          if (event.type === 'error') failure = event.failure.message;
          if (event.type === 'tool_use') {
            await codeAgent.cancel(session.id);
            return {
              success: false,
              summary: `Code Agent 请求工具 ${event.name}，需要由外层Agent继续调度。`,
              data: { sessionId: session.id, tool: event },
              error: 'Code Agent请求外部工具',
            };
          }
        }
      } finally {
        context.signal.removeEventListener('abort', abort);
      }

      const text = output.join('').trim();
      if (failure || session.status === 'failed') {
        return {
          success: false,
          summary: 'Code Agent执行失败。',
          data: { sessionId: session.id, output: text },
          error: failure ?? session.failure?.message ?? 'Code Agent执行失败',
        };
      }
      return {
        success: true,
        summary: text || `Code Agent会话 ${session.id} 已完成。`,
        data: { sessionId: session.id, output: text },
      };
    },
  });
}

// 收集面向上层Agent的文本增量。
function collectEvent(event: CodeAgentEvent, output: string[]): void {
  if (event.type === 'text_delta') output.push(event.delta);
}
