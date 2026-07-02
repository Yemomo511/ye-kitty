import type { ReplyGenerationResult } from '@kitty/services/llm/ports/llm-provider.port';
import type { RiskAssessment } from '../domain/risk-assessment';

export interface RiskGuardPort {
  assessReply(result: ReplyGenerationResult): Promise<RiskAssessment>;
}
