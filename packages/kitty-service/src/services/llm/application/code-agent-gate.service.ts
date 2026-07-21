/**
 * Code Agent Gate Service
 *
 * submit 前的门禁 Hook 链。
 * 顺序执行注入的 Hook 列表，任一返回拒绝原因即阻止任务执行。
 */

import type { CodeAgentTaskContract } from '@kitty/contracts/code-agent/code-agent-task.contract';
import { CodeAgentGateRejectedError } from '../domain/code-agent-errors';
import { existsSync, realpathSync, mkdirSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';

/** 门禁 Hook 接口 */
export interface CodeAgentGateHook {
  /** 返回 null = 通过；string = 拒绝原因 */
  check(task: CodeAgentTaskContract): string | null | Promise<string | null>;
}

/**
 * 内置 workdir 初始化 + 安全校验 Hook。
 *
 * 每个任务自动分配 `<workspaceRoot>/task-{uuid}` 作为独立工作目录。
 * 用户可显式指定 workdir 覆盖自动分配（需位于 workspaceRoot 下）。
 */
function createWorkdirHook(workspaceRoot: string): CodeAgentGateHook {
  const normalizedRoot = normalize(workspaceRoot).replace(/\\/g, '/') + '/';

  // 启动时确保工作区根目录存在
  if (!existsSync(workspaceRoot)) {
    mkdirSync(workspaceRoot, { recursive: true });
  }

  return {
    check(task) {
      // 用户未显式指定 → 自动分配 task-{uuid} 子目录
      if (!task.workdir) {
        const autoDir = join(workspaceRoot, `task-${randomUUID().slice(0, 8)}`);
        mkdirSync(autoDir, { recursive: true });
        (task as { workdir: string }).workdir = autoDir;
        return null; // 自动分配，无需校验
      }

      // 用户显式指定 → 校验合法性
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
    // 内置 hook：workdir 初始化 + 安全校验
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
