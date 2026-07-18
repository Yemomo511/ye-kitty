/**
 * Code Agent Logger
 *
 * LoggerPort 接口（shared/types/logger.ts）在整个代码库中的第一个实现。
 * 结构化单行 JSON 输出到 console + 可选 JSONL 文件（logs/code-agent/<sessionId>.jsonl）。
 * 恒带 sessionId 与 ISO 时间戳以支持审计。
 */

import type { LoggerPort, LogContext } from '@kitty/shared/types/logger';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** 日志目录 */
const LOG_DIR = 'logs/code-agent';

/** 确保日志目录存在 */
function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

/** 日志条目格式 */
interface LogEntry {
  ts: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
  sessionId?: string;
  traceId?: string;
  error?: string;
  context?: LogContext;
}

/** 写入一行 JSONL */
function writeJsonlLine(sessionId: string | undefined, entry: LogEntry): void {
  if (!sessionId) return;
  try {
    ensureLogDir();
    const filePath = join(LOG_DIR, `${sessionId}.jsonl`);
    appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch {
    // JSONL 写入失败不阻塞主流程
  }
}

/** 构建日志条目 */
function buildEntry(
  level: LogEntry['level'],
  message: string,
  error?: Error,
  context?: LogContext,
): LogEntry {
  return {
    ts: new Date().toISOString(),
    level,
    msg: message,
    sessionId: context?.sessionId,
    traceId: context?.traceId,
    error: error ? `${error.name}: ${error.message}` : undefined,
    context,
  };
}

/** LoggerPort 实现 */
export const codeAgentLogger: LoggerPort = {
  info(message: string, context?: LogContext): void {
    const entry = buildEntry('info', message, undefined, context);
    console.log(JSON.stringify(entry));
    writeJsonlLine(context?.sessionId, entry);
  },

  warn(message: string, context?: LogContext): void {
    const entry = buildEntry('warn', message, undefined, context);
    console.warn(JSON.stringify(entry));
    writeJsonlLine(context?.sessionId, entry);
  },

  error(message: string, error: Error, context?: LogContext): void {
    const entry = buildEntry('error', message, error, context);
    console.error(JSON.stringify(entry));
    writeJsonlLine(context?.sessionId, entry);
  },
};
