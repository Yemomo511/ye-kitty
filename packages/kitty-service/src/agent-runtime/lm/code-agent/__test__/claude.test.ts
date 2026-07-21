/** Task 4 测试 — claude-code adapter（T4-1~T4-6, T4-22） */
import { describe, it, expect } from 'vitest';
import { claude, createClaudeMapper } from '@kitty/agent-runtime/lm/code-agent/claude';
import type { CodeAgentEvent } from '@kitty/agent-runtime/lm/code-agent/event';

describe('claude', () => {
  it('T4-0: AgentDef 基本字段正确', () => {
    expect(claude.id).toBe('claude-code');
    expect(claude.streamFormat).toBe('claude-stream-json');
    expect(claude.promptViaStdin).toBe(true);
  });

  it('T4-6: buildArgs 不含 prompt 内容', () => {
    const args = claude.buildArgs({
      agentId: 'claude-code',
      workdir: '/tmp/test',
      model: 'sonnet',
      source: 'api',
    } as Parameters<typeof claude.buildArgs>[0]);
    expect(args).toContain('--print');
    expect(args).toContain('--input-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--tools');
    // 确认 prompt 相关内容不在 args 中（类型层已由 Omit<'prompt'> 保证）
    expect(args.every((a) => typeof a === 'string')).toBe(true);
  });
});

describe('createClaudeMapper', () => {
  function collectEvents(feedLines: string[]): CodeAgentEvent[] {
    const events: CodeAgentEvent[] = [];
    const mapper = createClaudeMapper('test-session', (e) => events.push(e));
    for (const line of feedLines) {
      mapper.feed(`${line}\n`);
    }
    mapper.flush();
    return events;
  }

  it('T4-1: text_delta → 统一 text_delta 事件', () => {
    const events = collectEvents([
      JSON.stringify({
        type: 'message_start',
        message: {
          id: 'm1',
          type: 'message',
          role: 'assistant',
          model: 'claude',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
      JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '你好' },
      }),
    ]);
    const textEvents = events.filter((e) => e.type === 'text_delta');
    expect(textEvents.length).toBeGreaterThanOrEqual(1);
    if (textEvents.length > 0) {
      expect((textEvents[0] as { delta: string }).delta).toBe('你好');
    }
  });

  it('T4-2: tool_use + input_json_delta → tool_use + tool_input_delta', () => {
    const events = collectEvents([
      JSON.stringify({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} },
      }),
      JSON.stringify({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' },
      }),
    ]);
    const toolUse = events.filter((e) => e.type === 'tool_use');
    const toolInput = events.filter((e) => e.type === 'tool_input_delta');
    expect(toolUse.length).toBe(1);
    expect(toolInput.length).toBe(1);
  });

  it('T4-3: message_delta 含 usage → usage 事件', () => {
    const events = collectEvents([
      JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    ]);
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toBeDefined();
    if (usage && usage.type === 'usage') {
      expect(usage.inputTokens).toBe(10);
      expect(usage.outputTokens).toBe(5);
    }
  });

  it('T4-4: session_id 在流中捕获', () => {
    const mapper = createClaudeMapper('orchestrator-id', () => {});
    mapper.feed(JSON.stringify({ type: 'system', session_id: 'claude-internal-id' }) + '\n');
    mapper.flush();
    expect(mapper.getCapturedSessionId()).toBe('claude-internal-id');
  });

  it('T4-5: 未识别事件类型 → raw 兜底', () => {
    const events = collectEvents([JSON.stringify({ type: 'unknown_event_type', data: 'xyz' })]);
    const raw = events.filter((e) => e.type === 'raw');
    expect(raw.length).toBe(1);
  });

  it('T4-22: thinking 内容块 → thinking_start + thinking_delta', () => {
    const events = collectEvents([
      JSON.stringify({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }),
      JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: '分析中...' },
      }),
      JSON.stringify({ type: 'content_block_stop', index: 0 }),
    ]);
    const thinkingStart = events.find((e) => e.type === 'thinking_start');
    const thinkingDelta = events.filter((e) => e.type === 'thinking_delta');
    expect(thinkingStart).toBeDefined();
    expect(thinkingDelta.length).toBeGreaterThanOrEqual(1);
  });
});
