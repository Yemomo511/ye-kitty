import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { PolicyDecision } from '../domain/policy';

export interface PolicyEvaluatorPort {
  evaluate(event: ChatEventContract): Promise<PolicyDecision>;
}
