import type {
  QqReplyAgentInput,
  QqReplyAgentPort,
  QqReplyAgentResult,
} from '../ports/qq-reply-agent.port';

/**
 * QQ安全回复Agent
 *
 * 包装真实 Agent，任何异常都会降级到默认回复。
 * 这样 QQ 平台链路不会因为模型超时、鉴权失败或 SDK 异常而中断。
 */
export class SafeQqReplyAgent implements QqReplyAgentPort {
  constructor(
    private readonly primaryAgent: QqReplyAgentPort,
    private readonly fallbackAgent: QqReplyAgentPort,
  ) {}

  /**
   * 生成安全回复
   * @param input 标准消息事件
   * @returns 真实或降级回复
   */
  async generateReply(input: QqReplyAgentInput): Promise<QqReplyAgentResult> {
    try {
      return await this.primaryAgent.generateReply(input);
    } catch (error) {
      console.warn(
        `⚠️ [AgentRuntime-SafeQqReplyAgent] Agent回复失败，已降级默认回复 conversationType=${input.event.conversationType} messageId=${maskId(
          input.event.message.id,
        )} reason=${formatError(error)}`,
      );
      return await this.fallbackAgent.generateReply(input);
    }
  }
}

// 脱敏消息ID，仅保留排障所需的尾部特征。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}

// 压缩错误内容，避免日志输出大对象或敏感上下文。
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
