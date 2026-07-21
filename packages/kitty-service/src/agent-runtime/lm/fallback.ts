import type { QqReplyAgentInput, QqReplyAgentPort, QqReplyAgentResult } from '../runtime';

/**
 * QQ默认回复Agent
 *
 * 在没有模型配置或真实 Agent 失败时保持 QQ 收发闭环。
 * 该实现不访问外部服务，适合作为所有策略的最终兜底。
 */
export class FallbackQqReplyAgent implements QqReplyAgentPort {
  /**
   * 返回默认回显回复
   * @param input 标准消息事件
   * @returns 默认文本
   */
  async generateReply(input: QqReplyAgentInput): Promise<QqReplyAgentResult> {
    return { text: `叶猫猫收到：${input.event.message.text}` };
  }
}
