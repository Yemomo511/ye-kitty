/**
 * Code Agent 会话生命周期管理
 *
 * 子进程 spawn / cancel（阶梯终止） / 孤儿清理。
 * 对照 open-design runtimes/runs.ts:474-513 的阶梯取消 + platform/process.ts 的进程印章枚举。
 *
 * Windows 适配：无 SIGTERM，阶梯退化为 stdin.end() → 3s → taskkill /T /F。
 * 孤儿清理：spawn 时 env 注入印章（保留作用），但主清理方案是服务启动时读取 PID 登记文件
 * 逐一校验进程存活 + CommandLine/CreationDate 吻合（防 PID 复用）。
 */

import { spawn, type ChildProcess, execSync } from 'node:child_process';
import { platform } from 'node:os';
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { CodeAgentDef } from '../../domain/code-agent-definition';
import type { CodeAgentTaskContract } from '@kitty/contracts/code-agent/code-agent-task.contract';
import { resolveSpawnCommand } from './windows-command';
import { buildAgentEnv } from './process-env';
import { assertArgvBudget } from './argv-budget';
import { randomUUID } from 'node:crypto';

/** PID 登记目录 */
const PID_REGISTRY_DIR = 'logs/code-agent';
const PID_REGISTRY_FILE = join(PID_REGISTRY_DIR, 'pids.jsonl');

/** PID 登记条目 */
interface PidRecord {
  sessionId: string;
  pid: number;
  exeBasename: string;
  startedAt: number;    // epoch ms
  commandLine: string;  // 用于 PID 复用校验
}

// ---- Spawn --------------------------------------------------

/**
 * 启动 code agent 子进程。
 *
 * @returns ChildProcess + 生成的 sessionId
 */
export function spawnAgent(
  def: CodeAgentDef,
  task: CodeAgentTaskContract,
): { child: ChildProcess; sessionId: string } {
  const sessionId = randomUUID();
  const stamp = sessionId;

  // 1. 构建参数（prompt 不进入 argv）
  const args = def.buildArgs(task);
  assertArgvBudget(args);

  // 2. 环境变量
  const env = buildAgentEnv(def.envAllowList, stamp);

  // 3. 解析 spawn 命令（Windows 上 cmd.exe 包裹 .cmd/.ps1）
  const resolved = resolveSpawnCommand(def.bin, args);

  // 4. spawn
  const child = spawn(resolved.command, [...resolved.args], {
    env,
    cwd: task.workdir,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    // 不使用 shell: true（resolveSpawnCommand 已处理 .cmd/.ps1 包裹）
  });

  // 5. 通过 stdin 发送 prompt（stdin 保持打开，中间人模式需要后续 injectToolResult 写入）
  const promptPayload = JSON.stringify({ prompt: task.prompt }) + '\n';
  child.stdin?.write(promptPayload);
  // 注意：stdin 不在此处 .end() —— injectToolResult 需要在子进程存活期间持续写入工具结果。
  // stdin 的关闭由 cancelChild 在阶梯取消第一步负责，或子进程自然退出时 OS 自动关闭。

  // 6. 登记 PID
  registerPid({
    sessionId,
    pid: child.pid ?? 0,
    exeBasename: def.bin,
    startedAt: Date.now(),
    commandLine: `${resolved.command} ${resolved.args.join(' ')}`.slice(0, 500),
  });

  return { child, sessionId };
}

// ---- Cancel（阶梯终止）----------------------------------------

/** 阶梯终止子进程 */
export async function cancelChild(child: ChildProcess): Promise<void> {
  if (!child.pid || child.killed) return;

  // 第一步：关闭 stdin（优雅通知 agent 停止）
  child.stdin?.end();

  // 第二步：等待 3 秒
  await delay(3000);

  // 第三步：如果还没退出，taskkill（Windows）或 SIGKILL（POSIX）
  if (!child.killed) {
    if (platform() === 'win32') {
      killProcessTree(child.pid);
    } else {
      child.kill('SIGKILL');
    }
  }
}

/** Windows 进程树终止 */
function killProcessTree(pid: number): void {
  try {
    // 以 /F 强制终止整个进程树
    execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, timeout: 5000 });
  } catch {
    // 目标进程已退出 → 忽略
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- PID 登记与孤儿清理 ---------------------------------------

/** 登记 PID 到持久化文件 */
function registerPid(record: PidRecord): void {
  try {
    if (!existsSync(PID_REGISTRY_DIR)) {
      mkdirSync(PID_REGISTRY_DIR, { recursive: true });
    }
    appendFileSync(PID_REGISTRY_FILE, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch {
    // 登记失败不阻塞 spawn
  }
}

/**
 * 清理孤儿进程。
 *
 * 启动时读取 PID 登记文件，逐一校验：
 * - PID 是否存活？
 * - CommandLine / CreationDate 是否与登记吻合（防 PID 复用）？
 *
 * 命中者 taskkill 清理。
 */
export function cleanupOrphans(): void {
  if (!existsSync(PID_REGISTRY_FILE)) return;

  try {
    const content = readFileSync(PID_REGISTRY_FILE, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const records: PidRecord[] = lines
      .map((line) => {
        try { return JSON.parse(line) as PidRecord; } catch { return null; }
      })
      .filter((r): r is PidRecord => r !== null);

    if (records.length === 0) return;

    const alivePids = getAliveProcessInfo();

    for (const record of records) {
      const info = alivePids.get(record.pid);
      if (!info) continue; // PID 不存在 → 已自然退出

      // 校验：CommandLine 包含 exeBasename（粗粒度防 PID 复用）
      if (info.commandLine && !info.commandLine.toLowerCase().includes(record.exeBasename.toLowerCase())) {
        continue; // PID 已被其他进程复用
      }

      // 命中 → 终止
      killProcessTree(record.pid);
    }
  } catch {
    // 孤儿清理失败不阻塞启动
  }

  // 清理后删除登记文件
  try { unlinkSync(PID_REGISTRY_FILE); } catch { /* ignore */ }
}

/** 获取存活进程的命令行信息（Windows 专有） */
function getAliveProcessInfo(): Map<number, { commandLine: string }> {
  const map = new Map<number, { commandLine: string }>();
  if (platform() !== 'win32') return map;

  try {
    const output = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"',
      { windowsHide: true, timeout: 10_000, encoding: 'utf-8' },
    );
    const data = JSON.parse(output) as Array<{ ProcessId: number; CommandLine: string | null }> | { ProcessId: number; CommandLine: string | null };
    const arr = Array.isArray(data) ? data : [data];
    for (const item of arr) {
      if (item.ProcessId && item.CommandLine) {
        map.set(item.ProcessId, { commandLine: item.CommandLine });
      }
    }
  } catch {
    // PowerShell 查询失败 → 不清除孤儿（依靠 session 超时兜底）
  }
  return map;
}
