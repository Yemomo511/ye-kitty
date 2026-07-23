import { vi } from 'vitest';
import type { ToolRuntimeContext, ToolSettlement } from '../tool';

/** 创建只用于Tool单元测试的系统上下文。 */
export function createToolTestContext(
  overrides: Partial<ToolRuntimeContext> = {},
): ToolRuntimeContext {
  const settlements = new Map<string, ToolSettlement>();
  return {
    runId: 'run-test',
    traceId: 'trace-test',
    callId: `call-${Math.random()}`,
    agentName: '叶猫猫',
    signal: new AbortController().signal,
    authorize: async () => ({ status: 'allowed' }),
    getSettlement: (callId) => settlements.get(callId),
    recordSettlement: (settlement) => settlements.set(settlement.audit.callId, settlement),
    applyEffects: vi.fn(),
    ...overrides,
  };
}
