export interface Capability<TInput, TOutput> {
  readonly capabilityName: string;
  canHandle(input: TInput): boolean | Promise<boolean>;
  handle(input: TInput): Promise<TOutput>;
}

export interface CapabilityDescriptor {
  readonly name: string;
  readonly description: string;
  readonly version: string;
}
