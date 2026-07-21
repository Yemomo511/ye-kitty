/** 旧回复风险评估仍使用的模型生成摘要，迁移完成后并入 AgentResult。 */
export interface ReplyGenerationResult {
  readonly text: string;
  readonly tone: 'normal' | 'warm' | 'serious' | 'playful';
  readonly confidence: number;
  readonly riskHints: readonly string[];
}
