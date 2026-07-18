/**
 * Claude Code adapter
 *
 * 对照 open-design runtimes/defs/claude.ts + runtimes/claude-stream.ts。
 * streamFormat: claude-stream-json。
 * MVP 禁工具：--tools ""（禁用全部内置工具集，工具桥接留阶段二）。
 */

import type { CodeAgentDef } from '../../domain/code-agent-definition';
import type { CodeAgentEventContract } from '@kitty/contracts/code-agent/code-agent-event.contract';
import { randomUUID } from 'node:crypto';

// ---- AgentDef ------------------------------------------------

export const claudeCodeDef: CodeAgentDef = {
  id: 'claude-code',
  name: 'Claude Code',
  bin: 'claude',
  versionArgs: ['--version'],
  buildArgs: (task) => [
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--tools', '',
    '--session-id', randomUUID(),
    '--add-dir', task.workdir,
    ...(task.model ? ['--model', task.model] : []),
  ],
  streamFormat: 'claude-stream-json',
  promptViaStdin: true as const,
  inactivityTimeoutMs: 300_000,  // 5 分钟
  sessionTimeoutMs: 1_800_000,   // 30 分钟
  maxConcurrentSessions: 1,
  supportsWorkdir: true,
  capturesSessionIdFromStream: true,
  envAllowList: [],
  capabilityFlags: {
    '--include-partial-messages': 'supportsPartialMessages',
    '--add-dir': 'supportsAddDir',
  },
};

// ---- Event Mapper --------------------------------------------

/** Claude Code stream-json 事件类型（原始） */
type ClaudeStreamEvent = {
  type: string;
  message?: ClaudeMessage;
  content_block?: ClaudeContentBlock;
  delta?: ClaudeDelta;
  index?: number;
  session_id?: string;
  usage?: ClaudeUsage;
  stop_reason?: string;
  error?: { type: string; message: string };
};

type ClaudeMessage = {
  id: string;
  type: string;
  role: string;
  content: unknown[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: ClaudeUsage;
};

type ClaudeContentBlock = {
  type: string;
  index?: number;
  name?: string;
  id?: string;
  input?: unknown;
  content?: unknown[];
  thinking?: string;
};

type ClaudeDelta = {
  type?: string;
  text?: string;
  thinking?: string;
  signature?: string;
  partial_json?: string;
};

type ClaudeUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

/** 适配器内部状态（跨事件跟踪） */
interface MapperState {
  sessionId: string;
  /** tool_use block 索引 → { id, name }，用于关联 tool_input_delta */
  activeToolBlocks: Map<number, { id: string; name: string }>;
  /** 思考内容累计 */
  thinkingBuffer: string;
  /** 是否正在思考块中 */
  inThinkingBlock: boolean;
  startTime: number;
}

/**
 * 创建 Claude Code stream-json → 统一事件的映射器。
 *
 * @param sessionId 本会话 ID（由 orchestrator 分配）
 * @param emit 事件消费回调
 * @returns feed(chunk) → 内部分行 → JSON.parse → 映射 → emit
 */
export function createClaudeMapper(
  sessionId: string,
  emit: (event: CodeAgentEventContract) => void,
) {
  const state: MapperState = {
    sessionId,
    activeToolBlocks: new Map(),
    thinkingBuffer: '',
    inThinkingBlock: false,
    startTime: Date.now(),
  };

  const push = (event: CodeAgentEventContract) => emit(event);

  /** 处理单行 JSON 的原始 Claude stream 事件 */
  const handleEvent = (raw: ClaudeStreamEvent) => {
    // 捕获 session_id
    if (raw.session_id && !state.sessionId) {
      state.sessionId = raw.session_id;
    }

    switch (raw.type) {
      case 'system':
        // 系统初始化事件：捕获 agent 内部 session_id
        if (raw.session_id) {
          state.sessionId = raw.session_id;
        }
        break;

      case 'message_start':
        if (raw.message) {
          push({ type: 'status', sessionId: state.sessionId, label: 'initializing', model: raw.message.model });
        }
        break;

      case 'content_block_start': {
        const block = raw.content_block;
        if (!block) break;

        if (block.type === 'tool_use') {
          state.activeToolBlocks.set(raw.index!, {
            id: block.id ?? '',
            name: block.name ?? '',
          });
          push({
            type: 'tool_use',
            sessionId: state.sessionId,
            id: block.id ?? '',
            name: block.name ?? '',
            input: block.input ?? {},
          });
        } else if (block.type === 'thinking') {
          state.inThinkingBlock = true;
          state.thinkingBuffer = '';
          push({ type: 'thinking_start', sessionId: state.sessionId });
        }
        break;
      }

      case 'content_block_delta': {
        const delta = raw.delta;
        if (!delta) break;

        if (delta.type === 'text_delta' && delta.text) {
          push({ type: 'text_delta', sessionId: state.sessionId, delta: delta.text });
        } else if (delta.type === 'input_json_delta' && delta.partial_json) {
          const block = state.activeToolBlocks.get(raw.index!);
          push({
            type: 'tool_input_delta',
            sessionId: state.sessionId,
            id: block?.id ?? '',
            name: block?.name ?? '',
            delta: delta.partial_json,
          });
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          state.thinkingBuffer += delta.thinking;
          push({ type: 'thinking_delta', sessionId: state.sessionId, delta: delta.thinking });
        } else if (delta.type === 'signature_delta') {
          // 签名增量，忽略
        }
        break;
      }

      case 'content_block_stop':
        state.activeToolBlocks.delete(raw.index!);
        if (state.inThinkingBlock) {
          state.inThinkingBlock = false;
          // thinking 内容在 content_block_stop 时已完整
        }
        break;

      case 'message_delta': {
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
      }

      case 'message_stop':
        // 消息终止，后续可能有新消息或流结束
        break;

      case 'error':
        push({
          type: 'error',
          sessionId: state.sessionId,
          failure: {
            code: 'process_exit',
            message: raw.error?.message ?? 'Claude Code 未知错误',
            retryable: false,
          },
        });
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
        const parsed = JSON.parse(line) as ClaudeStreamEvent;
        handleEvent(parsed);
      } catch {
        push({ type: 'raw', sessionId: state.sessionId, line });
      }
    }
  };

  const flush = () => {
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer) as ClaudeStreamEvent;
        handleEvent(parsed);
      } catch {
        push({ type: 'raw', sessionId: state.sessionId, line: buffer });
      }
      buffer = '';
    }
  };

  const getCapturedSessionId = () => state.sessionId;

  return { feed, flush, getCapturedSessionId };
}
