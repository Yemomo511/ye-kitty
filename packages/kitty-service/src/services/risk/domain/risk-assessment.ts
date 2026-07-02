export type RiskDecision = 'allow' | 'block' | 'human_review';

export interface RiskAssessment {
  readonly decision: RiskDecision;
  readonly reasons: readonly string[];
  readonly score: number;
}
