import type { FinishAction } from '../action';
import type { Observation } from '../observation';

/** Action 调度结果。 */
export type ScheduleResult<TOutput = unknown> =
  | { readonly type: 'finished'; readonly action: FinishAction<TOutput> }
  | { readonly type: 'observed'; readonly observation: Observation };
