/**
 * Code Agent 声明式配置对象（对照 open-design RuntimeAgentDef）
 *
 * 每个 agent adapter 只需提供一个 plain object，不需要继承任何基类。
 * 加新 agent = 加一个配置对象，不改引擎代码。
 */

import type { CodeAgentTask } from '@kitty/agent-runtime/lm/code-agent/task';

/**
 * StreamFormat 分发键
 *
 * 决定引擎用哪个流解析器：
 * - claude-stream-json：Claude Code 的 stream-json 格式
 * - json-event-stream：Codex / OpenCode 的纯 JSONL 事件
 * - acp-json-rpc：ACP 协议（MVP 不实现）
 * - plain：裸 stdout 文本（预留）
 */
export type StreamFormat = 'claude-stream-json' | 'json-event-stream' | 'acp-json-rpc' | 'plain';

/** 声明式 Agent 定义 */
export interface CodeAgentDefinition {
  /** 唯一标识 */
  readonly id: string;
  /** 人类可读名称 */
  readonly name: string;
  /** 可执行文件名 */
  readonly bin: string;
  /** 回退可执行文件名（按顺序尝试） */
  readonly fallbackBins?: readonly string[];
  /** 版本探测参数 */
  readonly versionArgs: readonly string[];
  /**
   * 构建 CLI 参数。
   * 类型层拿不到 prompt（Omit），强制 stdin 传递，规避 Windows 32KB argv 预算。
   */
  buildArgs: (task: Omit<CodeAgentTask, 'prompt'>) => string[];
  /** 流格式分发键 */
  readonly streamFormat: StreamFormat;
  /** 恒为 true：所有 adapter 都必须通过 stdin 传 prompt */
  readonly promptViaStdin: true;
  /** 超长 prompt 写临时文件回退（预留） */
  readonly promptViaFile?: boolean;
  /** 空闲超时毫秒（有 stdout 则重置；优先级 task > AgentDef > env） */
  readonly inactivityTimeoutMs: number;
  /** 会话总时长硬上限毫秒（同上优先级） */
  readonly sessionTimeoutMs: number;
  /** 同 agent 的并发上限（默认 1） */
  readonly maxConcurrentSessions: number;
  /** 是否支持图片输入 */
  readonly supportsImagePaths?: boolean;
  /** 是否支持指定工作目录 */
  readonly supportsWorkdir?: boolean;
  /** 是否支持 CLI 级会话恢复（MVP 恒 false，预留） */
  readonly resumesSession?: boolean;
  /** 是否从流中捕获 agent 内部 sessionId（为 resume 预留） */
  readonly capturesSessionIdFromStream?: boolean;
  /** 允许透传的环境变量（默认空 = 不传任何敏感变量；PATH/SystemRoot 等系统必需变量恒保留） */
  readonly envAllowList?: readonly string[];
  /** --help 输出中探测的能力标志（如 {"--verbose": "supportsVerbose"}） */
  readonly capabilityFlags?: Readonly<Record<string, string>>;
}
