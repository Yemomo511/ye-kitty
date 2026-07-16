import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  resolveStartupPlatformSelection,
  type StartupPlatformSelection,
} from '../src/bootstrap/startup-platform-selection';

// Code Agent 运行时（CODE_AGENT_API_KEY 存在时并行启动）
type CodeAgentShutdown = () => Promise<void>;
let stopCodeAgent: CodeAgentShutdown | undefined;
try {
  const { startCodeAgentRuntime } = await import('../src/bootstrap/code-agent-bootstrap');
  const runtime = await startCodeAgentRuntime();
  if (runtime) {
    stopCodeAgent = () => runtime.stop();
    // 注册进程退出时的优雅关闭
    const shutdown = async () => {
      try { await runtime.stop(); } catch { /* ignore */ }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
} catch {
  // code agent 启动失败不影响平台主流程
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
  await import('./start-platform-xiaohongshu');
} else {
  if (selection === 'all') process.env.YE_KITTY_ENABLE_XIAOHONGSHU_MCP = 'true';
  await import('./start-platform-qq');
}
