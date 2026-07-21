import type { ReplyGenerationResult } from '@kitty/agent-runtime/lm/reply';
import type { RiskAssessment } from '../domain/risk-assessment';

export interface RiskGuardPort {
  assessReply(result: ReplyGenerationResult): Promise<RiskAssessment>;
}
