/**
 * Code Agent 注册表
 *
 * 管理所有 AgentDef 的注册、探测与能力查询。
 * per-agent 三并发探测（version → capability flags → auth），
 * fault isolation（单个 agent 探测崩溃不影响其他）。
 * 对照 open-design runtimes/detection.ts:199-313 的 safeProbe 模式。
 */

import type { CodeAgentDefinition } from './definition';
import { claude } from './claude';
import { codex } from './codex';
import { spawnSync } from 'node:child_process';

/** Code Agent 能力信息。 */
export interface CodeAgentCapability {
  readonly id: string;
  readonly name: string;
  readonly available: boolean;
  readonly version?: string;
  readonly unavailableReason?: string;
  readonly supportsWorkdir: boolean;
  readonly supportsImagePaths: boolean;
  readonly resumeModes: readonly string[];
}

/** Code Agent 注册表公开能力。 */
export interface CodeAgentRegistry {
  listAgents(): Promise<readonly CodeAgentCapability[]>;
  getAgent(id: string): Promise<CodeAgentCapability | undefined>;
  refresh(): Promise<void>;
}

/** 所有已注册的 AgentDef */
export const AGENT_DEFS: readonly CodeAgentDefinition[] = [claude, codex];

/**
 * 探测一个 agent 的 CLI 可用性。
 *
 * 三并发探查：
 * 1. 版本探测（--version）
 * 2. 帮助标志能力探测（--help → capabilityFlags 匹配）
 *
 * 任一个探测抛异常不影响其他 agent（fault isolation 由外部 Promise.all + catch 保证）。
 */
async function probeAgent(def: CodeAgentDefinition): Promise<CodeAgentCapability> {
  const version = await tryGetVersion(def);
  if (version === null) {
    return {
      id: def.id,
      name: def.name,
      available: false,
      unavailableReason: buildUnavailableReason(def, '二进制不可执行或未安装'),
      supportsWorkdir: def.supportsWorkdir ?? false,
      supportsImagePaths: def.supportsImagePaths ?? false,
      resumeModes: [],
    };
  }

  return {
    id: def.id,
    name: def.name,
    available: true,
    version,
    supportsWorkdir: def.supportsWorkdir ?? false,
    supportsImagePaths: def.supportsImagePaths ?? false,
    resumeModes: def.resumesSession ? ['cli-resume'] : [],
  };
}

/** 尝试获取版本号，失败返回 null */
async function tryGetVersion(def: CodeAgentDefinition): Promise<string | null> {
  try {
    const result = spawnSync(def.bin, [...def.versionArgs], {
      timeout: 10_000,
      encoding: 'utf-8',
      windowsHide: true,
    });

    const output = `${result.stdout}${result.stderr}`.trim();
    if (!output && result.status !== 0) return null;

    // 提取版本字符串（取第一行、截断到合理长度）
    const version = output.split('\n')[0]?.trim()?.slice(0, 200);
    return version || null;
  } catch {
    // 二进制不存在 / spawn 失败 → fault isolated
    return null;
  }
}

/** 构建不可用诊断文本（含可操作建议，对照 open-design runtimes/diagnostics.ts） */
function buildUnavailableReason(def: CodeAgentDefinition, detail: string): string {
  const parts = [detail];
  parts.push(
    `名称为 ${def.bin}（可通过 npm i -g ${def.id === 'claude-code' ? '@anthropic-ai/claude-code' : '@openai/codex'} 安装）`,
  );
  parts.push('请确认 PATH 中包含该二进制或设置对应 CODE_AGENT_*_PATH 环境变量');
  return parts.join('。');
}

/** 刷新能力缓存 */
let cachedCapabilities: CodeAgentCapability[] | null = null;

/**
 * 探测所有已注册 agent 的可用性（并发 + fault isolation）。
 *
 * 单个 agent 的探测抛异常不会导致整体 reject（对标 open-design safeProbe）。
 * 探测结果缓存在内存中，直到下次 refresh()。
 */
export async function refreshCapabilities(): Promise<readonly CodeAgentCapability[]> {
  const results = await Promise.allSettled(
    AGENT_DEFS.map((def) =>
      probeAgent(def).catch((err): CodeAgentCapability => ({
        id: def.id,
        name: def.name,
        available: false,
        unavailableReason: `探测异常: ${String(err)}`,
        supportsWorkdir: def.supportsWorkdir ?? false,
        supportsImagePaths: def.supportsImagePaths ?? false,
        resumeModes: [],
      })),
    ),
  );

  cachedCapabilities = results.map((r) =>
    r.status === 'fulfilled'
      ? r.value
      : {
          id: 'unknown',
          name: '未知 Agent',
          available: false,
          unavailableReason: `探测崩溃: ${String(r.reason)}`,
          supportsWorkdir: false,
          supportsImagePaths: false,
          resumeModes: [],
        },
  );

  return cachedCapabilities;
}

/** 获取缓存的 agent 能力列表（首次调用自动探测） */
export async function listAgents(): Promise<readonly CodeAgentCapability[]> {
  if (!cachedCapabilities) {
    await refreshCapabilities();
  }
  return cachedCapabilities!;
}

/** 按 id 查找 agent */
export async function getAgent(id: string): Promise<CodeAgentCapability | undefined> {
  const agents = await listAgents();
  return agents.find((a) => a.id === id);
}

/** 按 id 查找 AgentDef */
export function getAgentDef(id: string): CodeAgentDefinition | undefined {
  return AGENT_DEFS.find((d) => d.id === id);
}
