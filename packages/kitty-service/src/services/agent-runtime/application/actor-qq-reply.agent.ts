import type {
  QqReplyAgentInput,
  QqReplyAgentPort,
  QqReplyAgentResult,
} from '../ports/qq-reply-agent.port';
import { ConversationActorSupervisor } from './conversation-actor-supervisor';

/**
 * Actor QQ 回复 Agent
 *
 * 把 ConversationActorSupervisor.dispatch() 适配为现有 QqReplyAgentPort 接口。
 * QqReplyEventSubscriber 只知道 QqReplyAgentPort，不感知 Supervisor。
 */
export class ActorQqReplyAgent implements QqReplyAgentPort {
  constructor(private readonly supervisor: ConversationActorSupervisor) {}

  /**
   * 生成 QQ 回复
   * @param input 标准消息事件
   * @returns 回复文本或动作
   */
  async generateReply(input: QqReplyAgentInput): Promise<QqReplyAgentResult> {
    const result = await this.supervisor.dispatch(
      input.event,
      input.availableSkills,
    );

    if (result.type === 'reply') {
      return { text: result.text, actions: result.actions };
    }

    // ignore / human_review / capacity_error → 静默
    return {};
  }
}
