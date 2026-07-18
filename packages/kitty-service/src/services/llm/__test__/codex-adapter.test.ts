/** Task 4 测试 — codex adapter（T4-7~T4-12, T4-23） */
import { describe, it, expect } from 'vitest';
import { codexDef, createCodexMapper } from '@kitty/services/llm/infrastructure/adapters/codex.adapter';
import type { CodeAgentEventContract } from '@kitty/contracts/code-agent/code-agent-event.contract';

describe('codexDef', () => {
  it('AgentDef 基本字段正确', () => {
    expect(codexDef.id).toBe('codex');
    expect(codexDef.streamFormat).toBe('json-event-stream');
    expect(codexDef.promptViaStdin).toBe(true);
  });

  it('buildArgs 含 exec --json', () => {
    const args = codexDef.buildArgs({
      agentId: 'codex',
      workdir: '/tmp/test',
      source: 'control-plane',
    } as Parameters<typeof codexDef.buildArgs>[0]);
    expect(args).toContain('exec');
    expect(args).toContain('--json');
  });
});

describe('createCodexMapper', () => {
  function collectEvents(feedLines: string[]): CodeAgentEventContract[] {
    const events: CodeAgentEventContract[] = [];
    const mapper = createCodexMapper('test-session', (e) => events.push(e));
    for (const line of feedLines) {
      mapper.feed(`${line}\n`);
    }
    mapper.flush();
    return events;
  }

  it('T4-7: thread.started → status + 捕获 thread_id', () => {
    const mapper = createCodexMapper('orch-id', () => {});
    mapper.feed(JSON.stringify({ type: 'thread.started', thread_id: 'thread_123' }) + '\n');
    mapper.flush();
    expect(mapper.getCapturedThreadId()).toBe('thread_123');
  });

  it('T4-8: item.started(command_execution) → tool_use', () => {
    const events = collectEvents([
      JSON.stringify({ type: 'item.started', item: { id: 'cmd_1', type: 'command_execution', command: 'ls -la' } }),
    ]);
    const toolUse = events.find((e) => e.type === 'tool_use');
    expect(toolUse).toBeDefined();
    if (toolUse && toolUse.type === 'tool_use') {
      expect(toolUse.name).toBe('ls -la');
    }
  });

  it('T4-9: item.completed(agent_message) → text_delta', () => {
    const events = collectEvents([
      JSON.stringify({ type: 'item.completed', item: { id: 'msg_1', type: 'agent_message', status: 'completed', content: [{ type: 'output_text', text: 'result' }] } }),
    ]);
    const textDeltas = events.filter((e) => e.type === 'text_delta');
    expect(textDeltas.length).toBeGreaterThanOrEqual(1);
  });

  it('T4-10: turn.completed → usage', () => {
    const events = collectEvents([
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }),
    ]);
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toBeDefined();
  });

  it('T4-11: error 事件 → error', () => {
    const events = collectEvents([
      JSON.stringify({ type: 'error', error: { message: 'api key invalid' } }),
    ]);
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toBeDefined();
  });

  it('T4-12: 未识别事件 → raw 兜底', () => {
    const events = collectEvents([
      JSON.stringify({ type: 'unknown', data: 'xyz' }),
    ]);
    expect(events.some((e) => e.type === 'raw')).toBe(true);
  });

  it('T4-23: item.completed(command_execution) → tool_result', () => {
    const events = collectEvents([
      JSON.stringify({ type: 'item.completed', item: { id: 'cmd_err', type: 'command_execution', status: 'incomplete', error: { message: 'bash: command not found' } } }),
    ]);
    const toolResult = events.find((e) => e.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult && toolResult.type === 'tool_result') {
      expect(toolResult.isError).toBe(true);
    }
  });
});
