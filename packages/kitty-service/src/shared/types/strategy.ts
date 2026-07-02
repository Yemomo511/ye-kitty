export interface Strategy<TInput, TOutput> {
  readonly strategyName: string;
  readonly priority: number;
  canApply(input: TInput): boolean | Promise<boolean>;
  execute(input: TInput): Promise<TOutput>;
}

export interface StrategySelection<TInput, TOutput> {
  readonly input: TInput;
  readonly strategy: Strategy<TInput, TOutput>;
}
