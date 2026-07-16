import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  resolveStartupPlatformSelection,
  type StartupPlatformSelection,
} from '../src/bootstrap/startup-platform-selection';

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
