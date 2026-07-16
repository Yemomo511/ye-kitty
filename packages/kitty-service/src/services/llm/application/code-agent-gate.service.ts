/**
 * Code Agent Gate Service
 *
 * submit 前的门禁 Hook 链。
 * 顺序执行注入的 Hook 列表，任一返回拒绝原因即阻止任务执行。
 */

import type { CodeAgentTaskContract } from '@kitty/contracts/code-agent/code-agent-task.contract';
import { CodeAgentGateRejectedError } from '../domain/code-agent-errors';
import { existsSync, realpathSync } from 'node:fs';
import { join, normalize } from 'node:path';

/** 门禁 Hook 接口 */
export interface CodeAgentGateHook {
  /** 返回 null = 通过；string = 拒绝原因 */
  check(task: CodeAgentTaskContract): string | null | Promise<string | null>;
}

/**
 * 内置 workdir 安全校验 Hook。
 *
 * - 目录必须存在
 * - 规范化后必须位于 CODE_AGENT_WORKSPACE_ROOT 下（防 .. 逃逸）
 */
function createWorkdirHook(workspaceRoot: string): CodeAgentGateHook {
  // normalize + realpath 均将 \\ 替换为 /，确保 Windows 上 startsWith 不因分隔符失配
  const normalizedRoot = normalize(workspaceRoot).replace(/\\/g, '/') + '/';

  return {
    check(task) {
      if (!task.workdir || !existsSync(task.workdir)) {
        return `工作目录不存在: ${task.workdir}`;
      }

      let resolved: string;
      try {
        resolved = `${realpathSync(task.workdir)}`.replace(/\\/g, '/') + '/';
      } catch {
        return `无法解析工作目录: ${task.workdir}`;
      }

      if (!resolved.startsWith(normalizedRoot)) {
        return `工作目录 ${task.workdir} 不在允许的根目录 ${workspaceRoot} 下（经 realpath 校验）`;
      }

      return null;
    },
  };
}

/** 门禁服务 */
export class CodeAgentGateService {
  private readonly hooks: CodeAgentGateHook[] = [];

  constructor(workspaceRoot: string) {
    // 内置 hook：workdir 安全校验
    this.hooks.push(createWorkdirHook(workspaceRoot));
  }

  /** 注册额外 Hook（如 risk 服务的实现） */
  registerHook(hook: CodeAgentGateHook): void {
    this.hooks.push(hook);
  }

  /** 执行门禁链。任一 Hook 返回拒绝原因即抛 CodeAgentGateRejectedError */
  async check(task: CodeAgentTaskContract): Promise<void> {
    for (const hook of this.hooks) {
      const reason = await hook.check(task);
      if (reason !== null) {
        throw new CodeAgentGateRejectedError(reason);
      }
    }
  }
}
