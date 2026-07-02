import type { Strategy } from '@kitty/shared/types/strategy';

export class StrategyRegistry<TInput, TOutput> {
  private readonly strategies = new Map<string, Strategy<TInput, TOutput>>();

  register(strategy: Strategy<TInput, TOutput>): void {
    this.strategies.set(strategy.strategyName, strategy);
  }

  list(): readonly Strategy<TInput, TOutput>[] {
    return [...this.strategies.values()].sort((left, right) => {
      return right.priority - left.priority;
    });
  }

  async select(input: TInput): Promise<Strategy<TInput, TOutput> | null> {
    for (const strategy of this.list()) {
      if (await strategy.canApply(input)) return strategy;
    }

    return null;
  }

  async execute(input: TInput): Promise<TOutput> {
    const strategy = await this.select(input);
    if (!strategy) {
      throw new Error('No strategy can handle the current input');
    }

    return strategy.execute(input);
  }
}
