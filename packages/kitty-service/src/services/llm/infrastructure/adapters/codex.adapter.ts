/**
 * Codex CLI adapter
 *
 * 对照 open-design runtimes/defs/codex.ts + runtimes/json-event-stream.ts:658-817。
 * streamFormat: json-event-stream。
 * 注意：本机未安装 codex CLI，此 adapter 基于 open-design 文档假设，需安装后实测验证。
 */

import type { CodeAgentDef } from '../../domain/code-agent-definition';
import type { CodeAgentEventContract } from '@kitty/contracts/code-agent/code-agent-event.contract';

// ---- AgentDef ------------------------------------------------

export const codexDef: CodeAgentDef = {
  id: 'codex',
  name: 'OpenAI Codex CLI',
  bin: 'codex',
  versionArgs: ['--version'],
  buildArgs: (task) => [
    'exec',
    '--json',
    ...(task.model ? ['--model', task.model] : []),
  ],
  streamFormat: 'json-event-stream',
  promptViaStdin: true as const,
  inactivityTimeoutMs: 300_000,  // 5 分钟
  sessionTimeoutMs: 1_800_000,   // 30 分钟
  maxConcurrentSessions: 1,
  supportsWorkdir: true,
  capturesSessionIdFromStream: true,
  envAllowList: [],
};

// ---- Event Mapper --------------------------------------------

/** Codex JSON 事件原始格式 */
type CodexRawEvent = {
  type: string;
  thread_id?: string;
  turn_id?: string;
  item?: {
    id?: string;
    type?: string;
    status?: 'in_progress' | 'completed' | 'incomplete';
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
    error?: {
      message: string;
    };
    command?: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  error?: {
    message: string;
  };
};

interface MapperState {
  sessionId: string;
  capturedThreadId?: string;
  /** 活跃的 command 调用 ID（用于 tool_result 关联） */
  activeCommandIds: Set<string>;
  startTime: number;
}

/**
 * 创建 Codex JSONL → 统一事件的映射器。
 */
export function createCodexMapper(
  sessionId: string,
  emit: (event: CodeAgentEventContract) => void,
) {
  const state: MapperState = {
    sessionId,
    activeCommandIds: new Set(),
    startTime: Date.now(),
  };

  const push = (event: CodeAgentEventContract) => emit(event);

  const handleEvent = (raw: CodexRawEvent) => {
    switch (raw.type) {
      case 'thread.started':
        if (raw.thread_id) {
          state.capturedThreadId = raw.thread_id;
        }
        push({
          type: 'status',
          sessionId: state.sessionId,
          label: 'initializing',
        });
        break;

      case 'turn.started':
        push({ type: 'status', sessionId: state.sessionId, label: 'thinking' });
        break;

      case 'item.started': {
        const item = raw.item;
        if (!item) break;

        if (item.type === 'command_execution' && item.command) {
          state.activeCommandIds.add(item.id ?? '');
          push({
            type: 'tool_use',
            sessionId: state.sessionId,
            id: item.id ?? '',
            name: item.command,
            input: {},
          });
        }
        break;
      }

      case 'item.completed': {
        const item = raw.item;
        if (!item) break;

        if (item.type === 'command_execution') {
          state.activeCommandIds.delete(item.id ?? '');
          const isError = item.status === 'incomplete' || Boolean(item.error);
          push({
            type: 'tool_result',
            sessionId: state.sessionId,
            toolUseId: item.id ?? '',
            content: item.error?.message ?? '',
            isError,
          });
        } else if (item.type === 'agent_message') {
          // 文本回复
          const text = item.content
            ?.filter((c) => c.type === 'output_text')
            .map((c) => c.text ?? '')
            .join('') ?? '';

          for (const line of text.split('\n')) {
            if (line) {
              push({ type: 'text_delta', sessionId: state.sessionId, delta: `${line}\n` });
            }
          }
        }
        break;
      }

      case 'turn.completed':
        if (raw.usage) {
          push({
            type: 'usage',
            sessionId: state.sessionId,
            inputTokens: raw.usage.input_tokens,
            outputTokens: raw.usage.output_tokens,
            durationMs: Date.now() - state.startTime,
          });
        }
        break;

      case 'error':
        push({
          type: 'error',
          sessionId: state.sessionId,
          failure: {
            code: 'process_exit',
            message: raw.error?.message ?? 'Codex CLI 未知错误',
            retryable: false,
          },
        });
        break;

      case 'thread.completed':
        // 线程结束，正常情况
        break;

      default:
        push({ type: 'raw', sessionId: state.sessionId, line: JSON.stringify(raw) });
    }
  };

  let buffer = '';
  const feed = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as CodexRawEvent;
        handleEvent(parsed);
      } catch {
        push({ type: 'raw', sessionId: state.sessionId, line });
      }
    }
  };

  const flush = () => {
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer) as CodexRawEvent;
        handleEvent(parsed);
      } catch {
        push({ type: 'raw', sessionId: state.sessionId, line: buffer });
      }
      buffer = '';
    }
  };

  const getCapturedThreadId = () => state.capturedThreadId;

  return { feed, flush, getCapturedThreadId };
}
