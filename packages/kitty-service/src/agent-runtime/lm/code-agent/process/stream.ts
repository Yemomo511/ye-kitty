/**
 * 流式 JSON 行解析器
 *
 * 抄 open-design agent-protocol/core/json-line-stream.ts，增加 onRawLine 回调
 *（原版对非 JSON 行静默丢弃，本实现路由为 raw 事件以便上层日志与诊断）。
 *
 * 用于所有 agent adapter 共享的 stdout 传输层。
 */

/** JSON 行流配置 */
export interface JsonLineStreamConfig {
  /** 聚合上限行数（默认 256） */
  readonly maxAggregateLines?: number;
  /** 聚合上限字节（默认 128 * 1024） */
  readonly maxAggregateBytes?: number;
}

/** 行流句柄 */
export interface JsonLineStreamHandle {
  /** 喂入增量数据 */
  feed(chunk: string | Buffer): void;
  /** 流结束，排空残留缓冲 */
  flush(): void;
}

/**
 * 创建流式 JSON 行解析器
 * @param onMessage 成功解析的 JSON 值 + 原始行数据
 * @param onRawLine 非 JSON / 超限截断行回调（ye-kitty 增强）
 * @param config 聚合配置
 */
export function createJsonLineStream(
  onMessage: (parsed: unknown, rawLine: string) => void,
  onRawLine?: (line: string) => void,
  config?: JsonLineStreamConfig,
): JsonLineStreamHandle {
  const maxLines = config?.maxAggregateLines ?? 256;
  const maxBytes = config?.maxAggregateBytes ?? 128 * 1024;

  let buffer = '';
  let pendingLines: string[] = [];
  let pendingBytes = 0;

  /** 尝试解析单行 JSON，成功则回调 onMessage */
  const tryEmit = (candidate: string): boolean => {
    try {
      onMessage(JSON.parse(candidate), candidate);
      return true;
    } catch {
      return false;
    }
  };

  /** 向 onRawLine 发送非 JSON 行 */
  const emitRaw = (line: string) => {
    onRawLine?.(line);
  };

  /** 回放已吸收行（聚合失败时逐行结算） */
  const replayPendingLines = () => {
    const absorbed = pendingLines;
    pendingLines = [];
    pendingBytes = 0;
    for (const line of absorbed) {
      if (!tryEmit(line)) {
        emitRaw(line);
      }
    }
  };

  /** 尝试将 pendingLines 作为一条多行 JSON 解析 */
  const tryEmitPending = (): boolean => {
    if (pendingLines.length === 0) return false;
    const candidate = pendingLines.join('\n');
    return tryEmit(candidate);
  };

  /** 开始聚合新多行 JSON */
  const startPending = (line: string) => {
    pendingLines = [line];
    pendingBytes = Buffer.byteLength(line, 'utf-8');
  };

  /** 追加到当前聚合 */
  const appendPending = (line: string) => {
    pendingLines.push(line);
    pendingBytes += Buffer.byteLength(line, 'utf-8') + 1; // +1 for the newline
  };

  /** 判断聚合是否超上限 */
  const hasPendingExceeded = (): boolean =>
    pendingLines.length >= maxLines || pendingBytes >= maxBytes;

  /** 处理完整一行 */
  const handleLine = (line: string) => {
    // 空行跳过
    if (line.length === 0) return;

    // 有未完成的聚合时，判断本行是新帧还是续行
    if (pendingLines.length > 0) {
      // 缩进/续行特征：以空白开头或在某个字符后直接是值
      const firstChar = line[0];
      if (firstChar === ' ' || firstChar === '\t') {
        // 续行：追加到聚合
        appendPending(line);

        if (hasPendingExceeded()) {
          // 超限：回放已吸收行（包括当前续行）
          replayPendingLines();
        }
        return;
      }

      // 不是续行 → 尝试结算聚合
      if (tryEmitPending()) {
        // 聚合成功，重置，继续处理当前行
        resetPendingAndHandle(line);
        return;
      }

      // 聚合失败 → 回放，继续处理当前行
      replayPendingLines();
    }

    // 无聚合 → 先尝试单行解析
    if (tryEmit(line)) {
      return;
    }

    // 单行失败 → 可能是多行 JSON 的开头（如 `{"key":` 结尾缺闭合）
    // 用启发式判断：以 `{` 或 `[` 开头且不以对应闭合结尾
    if (isPotentialMultilineStart(line)) {
      startPending(line);
      return;
    }

    // 无法识别 → raw 兜底
    emitRaw(line);
  };

  const resetPendingAndHandle = (line: string) => {
    pendingLines = [];
    pendingBytes = 0;
    handleLine(line);
  };

  /** 启发式：可能的多行 JSON 开头 */
  const isPotentialMultilineStart = (line: string): boolean => {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return !isCompleteContainer(trimmed);
    }
    return false;
  };

  /** 简单括号匹配判断完整性（不做完整解析，单遍扫描） */
  const isCompleteContainer = (s: string): boolean => {
    let braceDepth = 0;
    let bracketDepth = 0;
    let inString = false;
    let escape = false;

    for (const ch of s) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
      if (ch === '[') bracketDepth++;
      if (ch === ']') bracketDepth--;
    }

    return braceDepth === 0 && bracketDepth === 0 && !inString;
  };

  const feed = (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    buffer += text;

    // 按行分割
    const lines = buffer.split('\n');
    // 最后一段可能不完整，留待下次
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      handleLine(line);
    }
  };

  const flush = () => {
    // 处理缓冲区中最后一行
    if (buffer.length > 0) {
      handleLine(buffer);
      buffer = '';
    }
    // 结算未完成的聚合
    if (pendingLines.length > 0) {
      replayPendingLines();
    }
  };

  return { feed, flush };
}
