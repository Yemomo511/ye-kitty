import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  resolveStartupPlatformSelection,
  type StartupPlatformSelection,
} from '../src/bootstrap/platform';

// Code Agent 运行时在存在API密钥时并行启动。
try {
  const { startCodeAgentRuntime } = await import('../src/bootstrap/code');
  const runtime = await startCodeAgentRuntime();
  if (runtime) {
    // 注册进程退出时的优雅关闭
    const shutdown = async () => {
      try {
        await runtime.stop();
      } catch {
        // 关闭失败不阻止进程响应退出信号。
      }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
} catch {
  // Code Agent启动失败不影响平台主流程。
}

const terminal = createInterface({ input: stdin, output: stdout });
let selection: StartupPlatformSelection;
try {
  selection = await resolveStartupPlatformSelection({
    args: process.argv.slice(2),
    isInteractive: Boolean(stdin.isTTY && stdout.isTTY),
    ask: async (question) => await terminal.question(`${question} `),
  });
} finally {
  terminal.close();
}

if (selection === 'xiaohongshu') {
  await import('./start-xiaohongshu');
} else {
  if (selection === 'all') process.env.YE_KITTY_ENABLE_XIAOHONGSHU_MCP = 'true';
  await import('./start-qq');
}
