import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

/** 从启动目录向上读取最近的.env */
export function loadNearestEnvFile(startDirectory: string, env: NodeJS.ProcessEnv): void {
  const envPath = findNearestFile(startDirectory, '.env');
  if (!envPath) return;

  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) continue;
    const [key, value] = entry;
    env[key] ??= value;
  }
}

/** 从启动目录向上查找目录 */
export function findNearestDirectory(
  startDirectory: string,
  directoryName: string,
): string | undefined {
  let currentDirectory = startDirectory;
  const rootDirectory = parse(startDirectory).root;

  while (true) {
    const candidate = join(currentDirectory, directoryName);
    if (existsSync(candidate)) return candidate;
    if (currentDirectory === rootDirectory) return undefined;
    currentDirectory = dirname(currentDirectory);
  }
}

// 从启动目录向上查找文件。
function findNearestFile(startDirectory: string, fileName: string): string | undefined {
  let currentDirectory = startDirectory;
  const rootDirectory = parse(startDirectory).root;

  while (true) {
    const candidate = join(currentDirectory, fileName);
    if (existsSync(candidate)) return candidate;
    if (currentDirectory === rootDirectory) return undefined;
    currentDirectory = dirname(currentDirectory);
  }
}

// 解析单行环境变量。
function parseEnvLine(line: string): readonly [string, string] | undefined {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) return undefined;

  const separatorIndex = trimmedLine.indexOf('=');
  if (separatorIndex < 1) return undefined;
  const key = trimmedLine.slice(0, separatorIndex).trim();
  const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
  return [key, unwrapEnvValue(rawValue)];
}

// 去掉环境变量包裹引号。
function unwrapEnvValue(rawValue: string): string {
  const quote = rawValue[0];
  const shouldUnwrap = (quote === '"' || quote === "'") && rawValue.endsWith(quote);
  return shouldUnwrap ? rawValue.slice(1, -1) : rawValue;
}
