import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { ConversationMessage } from '@kitty/services/conversation/domain/message';
import type { Persona } from '@kitty/services/persona/domain/persona';
import type { PolicyDecision } from '@kitty/services/policy/domain/policy';

export interface ReplyGenerationRequest {
  readonly event: ChatEventContract;
  readonly recentMessages: readonly ConversationMessage[];
  readonly persona: Persona;
  readonly policyDecision: PolicyDecision;
}

export interface ReplyGenerationResult {
  readonly text: string;
  readonly tone: 'normal' | 'warm' | 'serious' | 'playful';
  readonly confidence: number;
  readonly riskHints: readonly string[];
}

export interface LlmProviderPort {
  generateReply(request: ReplyGenerationRequest): Promise<ReplyGenerationResult>;
}
