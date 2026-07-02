import type { Capability, CapabilityDescriptor } from '@kitty/shared/types/capability';

export abstract class CapabilityBase<TInput, TOutput>
  implements Capability<TInput, TOutput>
{
  protected constructor(readonly descriptor: CapabilityDescriptor) {}

  get capabilityName(): string {
    return this.descriptor.name;
  }

  async canHandle(_input: TInput): Promise<boolean> {
    return true;
  }

  abstract handle(input: TInput): Promise<TOutput>;
}
