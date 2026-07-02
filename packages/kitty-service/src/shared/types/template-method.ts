export interface TemplateExecutionContext<TInput> {
  readonly input: TInput;
  readonly startedAt: Date;
}

export interface TemplateExecutionResult<TOutput> {
  readonly output: TOutput;
  readonly finishedAt: Date;
}

export interface TemplateFailureContext<TInput> extends TemplateExecutionContext<TInput> {
  readonly error: Error;
}
