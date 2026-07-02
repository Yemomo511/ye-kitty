import type { TemplateExecutionContext } from '@kitty/shared/types/template-method';
import type { UseCase } from '@kitty/shared/types/use-case';

export abstract class TemplateUseCase<TInput, TOutput>
  implements UseCase<TInput, TOutput>
{
  async execute(input: TInput): Promise<TOutput> {
    const context = this.createContext(input);

    try {
      await this.beforeExecute(context);
      await this.validate(context);
      const output = await this.executeCore(context);
      await this.afterExecute(context, output);
      return output;
    } catch (error) {
      await this.onError(context, error as Error);
      throw error;
    }
  }

  protected createContext(input: TInput): TemplateExecutionContext<TInput> {
    return {
      input,
      startedAt: new Date(),
    };
  }

  protected async beforeExecute(
    _context: TemplateExecutionContext<TInput>,
  ): Promise<void> {}

  protected async validate(
    _context: TemplateExecutionContext<TInput>,
  ): Promise<void> {}

  protected abstract executeCore(
    context: TemplateExecutionContext<TInput>,
  ): Promise<TOutput>;

  protected async afterExecute(
    _context: TemplateExecutionContext<TInput>,
    _output: TOutput,
  ): Promise<void> {}

  protected async onError(
    _context: TemplateExecutionContext<TInput>,
    _error: Error,
  ): Promise<void> {}
}
