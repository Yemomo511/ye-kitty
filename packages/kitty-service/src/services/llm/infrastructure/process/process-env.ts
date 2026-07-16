/**
 * 子进程环境变量构建
 *
 * envAllowList 白名单模式：除非显式列出，否则不透传任何调用进程的环境变量。
 * Windows 系统运行必需变量（PATH / SystemRoot / USERPROFILE 等）恒保留。
 * 注入进程印章 KITTY_CODE_AGENT_SESSION 用于孤儿进程清理的标识。
 */

import { platform } from 'node:os';

/** Windows 系统必需变量（大小写不敏感匹配） */
const WINDOWS_REQUIRED_VARS_LOWER = new Set([
  'path',           // 可执行文件搜索路径
  'systemroot',     // %SystemRoot%
  'userprofile',    // %USERPROFILE%（CLI 需读 ~/.claude 等配置）
  'temp',           // 临时文件
  'tmp',            // 临时文件别名
  'windir',         // %WINDIR%
  'comspec',        // cmd.exe 路径
  'programdata',    // 程序数据目录
  'localappdata',   // 本地应用数据
  'appdata',        // 应用数据
  'allusersprofile',// 所有用户配置
  'homedrive',      // 主驱动器
  'homepath',       // 主路径
]);

/** UNIX 系统必需变量 */
const UNIX_REQUIRED_VARS = new Set([
  'PATH',
  'HOME',
  'USER',
  'TMPDIR',
  'TMP',
  'SHELL',
]);

/**
 * 构建子进程环境变量。
 *
 * @param envAllowList 允许透传的变量名列表（大小写敏感检查前先 toUpperCase 归一化）
 * @param stamp 进程印章值（注入为 KITTY_CODE_AGENT_SESSION）
 * @param extraEnv 额外注入的环境变量
 * @returns 子进程 env 对象
 */
export function buildAgentEnv(
  envAllowList: readonly string[] | undefined,
  stamp: string,
  extraEnv?: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};

  const isWindows = platform() === 'win32';

  // 1. 系统必需变量恒保留
  if (isWindows) {
    // Windows：大小写不敏感匹配
    for (const key of Object.keys(process.env)) {
      if (!process.env[key]) continue;
      if (WINDOWS_REQUIRED_VARS_LOWER.has(key.toLowerCase())) {
        env[key] = process.env[key]!;
      }
    }
  } else {
    for (const key of Object.keys(process.env)) {
      if (!process.env[key]) continue;
      if (UNIX_REQUIRED_VARS.has(key)) {
        env[key] = process.env[key]!;
      }
    }
  }

  // 2. 白名单变量透传（大小写不敏感匹配以处理 Windows Path vs PATH）
  if (envAllowList && envAllowList.length > 0) {
    const allowLower = new Set(envAllowList.map((k) => k.toLowerCase()));
    for (const key of Object.keys(process.env)) {
      if (!process.env[key]) continue;
      if (allowLower.has(key.toLowerCase())) {
        env[key] = process.env[key]!;
      }
    }
  }

  // 3. 印章注入
  env['KITTY_CODE_AGENT_SESSION'] = stamp;

  // 4. 额外变量注入
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      env[key] = value;
    }
  }

  return env;
}
