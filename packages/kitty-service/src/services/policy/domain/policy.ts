import type { PolicyId } from '@kitty/shared/types/ids';

export type PolicyActionType = 'allow_reply' | 'ignore' | 'refuse' | 'human_review';

export interface PolicyRule {
  readonly id: string;
  readonly type: 'reply_trigger' | 'content_boundary' | 'escalation';
  readonly priority: number;
  readonly condition: Record<string, unknown>;
  readonly actionType: PolicyActionType;
}

export interface Policy {
  readonly id: PolicyId;
  readonly name: string;
  readonly version: string;
  readonly rules: readonly PolicyRule[];
  readonly isActive: boolean;
}

export interface PolicyDecision {
  readonly shouldReply: boolean;
  readonly actionType: PolicyActionType;
  readonly reason: string;
  readonly confidence: number;
}
