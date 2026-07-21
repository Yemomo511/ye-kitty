/**
 * Windows 命令构造
 *
 * 抄 open-design packages/platform/src/command.ts：
 * .cmd / .ps1 经 cmd.exe /d /s /c 包裹；
 * % 转义防环境变量展开；
 * 路径含空格时引号处理。
 */

import { platform } from 'node:os';

/** spawn 命令解析结果 */
export interface ResolvedCommand {
  /** 实际执行的命令（可能是 cmd.exe） */
  readonly command: string;
  /** 传递给 spawn 的 args 数组 */
  readonly args: readonly string[];
  /** Windows 下 spawn 的 windowsVerbatimArguments 选项 */
  readonly windowsVerbatimArguments?: boolean;
}

/** 判断是否需要 shell 包裹 */
function needsShellWrap(bin: string): boolean {
  const lower = bin.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1');
}

/** 判断是否无已知可执行扩展名 */
function hasNoExtension(bin: string): boolean {
  const lower = bin.toLowerCase();
  return (
    !lower.endsWith('.exe') &&
    !lower.endsWith('.cmd') &&
    !lower.endsWith('.bat') &&
    !lower.endsWith('.ps1')
  );
}

/** 转义 cmd.exe 命令行中的 % 字符（防环境变量展开） */
function escapeCmdPercents(s: string): string {
  return s.replace(/%/g, '%%');
}

/**
 * 将 CLI 命令解析为 Node spawn 可用的格式。
 *
 * Windows 上 .cmd/.ps1 文件不能直接 spawn（CVE-2024-27980），
 * 需经 cmd.exe /d /s /c 包裹。
 */
export function resolveSpawnCommand(bin: string, args: readonly string[]): ResolvedCommand {
  if (platform() !== 'win32') {
    return { command: bin, args };
  }

  if (needsShellWrap(bin)) {
    // cmd.exe /d /s /c "bin arg1 arg2 ..."
    const cmdArgs = [bin, ...args].map(escapeCmdPercents);
    const fullArgs = ['/d', '/s', '/c', cmdArgs.join(' ')];
    return { command: 'cmd.exe', args: fullArgs };
  }

  // 无扩展名 → Windows 上可能是 npm shim（.cmd），需 shell 包裹才能 spawn
  // Node 20+ 禁用了直接 spawn .cmd 文件（CVE-2024-27980），必须经 cmd.exe
  if (hasNoExtension(bin)) {
    const cmdBin = `${bin}.cmd`;
    return resolveSpawnCommand(cmdBin, args);
  }

  return { command: bin, args };
}
