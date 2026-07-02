import type { OutgoingActionContract } from '@kitty/contracts/actions/outgoing-action.contract';

export interface ActionDispatcherPort {
  dispatch(action: OutgoingActionContract): Promise<OutgoingActionContract>;
}
