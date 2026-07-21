// 判断是否开启调试日志，默认关闭，避免高频消息链路污染终端输出。
export function isDebugLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.YE_KITTY_LOG_LEVEL === 'debug';
}

// 输出调试日志，调用方仍需按日志规范提供标志、Tag 和上下文。
export function writeDebugLog(message: string): void {
  if (!isDebugLogEnabled()) return;

  console.debug(message);
}
