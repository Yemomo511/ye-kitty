/** Task 3 测试 — windows-command（T3-9, T3-10） */
import { describe, it, expect } from 'vitest';
import { resolveSpawnCommand } from '@kitty/agent-runtime/lm/code-agent/process/command';
import { platform } from 'node:os';

describe('resolveSpawnCommand', () => {
  it('T3-9: 原生 .exe → 直接返回，不经 cmd.exe', () => {
    const result = resolveSpawnCommand('node.exe', ['--version']);
    if (platform() === 'win32') {
      expect(result.command.toLowerCase()).not.toContain('cmd');
    }
    expect(result.args).toContain('--version');
  });

  it('T3-10: .cmd 文件 → 经 cmd.exe /d /s /c 包裹', () => {
    const result = resolveSpawnCommand('my-tool.cmd', ['--flag', 'value']);
    if (platform() === 'win32') {
      expect(result.command).toBe('cmd.exe');
      expect(result.args[0]).toBe('/d');
      expect(result.args[1]).toBe('/s');
      expect(result.args[2]).toBe('/c');
      const cmdLine = result.args[3];
      expect(cmdLine).toContain('my-tool.cmd');
      expect(cmdLine).toContain('--flag');
    }
  });

  it('T3-10b: .ps1 文件 → 同样经 cmd.exe 包裹', () => {
    const result = resolveSpawnCommand('script.ps1', ['-Name', 'test']);
    if (platform() === 'win32') {
      expect(result.command).toBe('cmd.exe');
    }
  });

  it('% 字符被转义为 %%，防止环境变量展开', () => {
    const result = resolveSpawnCommand('tool.cmd', ['echo', '%PATH%']);
    if (platform() === 'win32') {
      const cmdLine = result.args[3];
      expect(cmdLine).toContain('%%PATH%%');
      expect(cmdLine).not.toMatch(/(?<!%)%PATH%(?!%)/);
    }
  });

  it('非 Windows 平台 → 原样返回 bin + args', () => {
    if (platform() !== 'win32') {
      const result = resolveSpawnCommand('tool.cmd', ['--flag']);
      expect(result.command).toBe('tool.cmd');
      expect(result.args).toEqual(['--flag']);
    }
  });
});
