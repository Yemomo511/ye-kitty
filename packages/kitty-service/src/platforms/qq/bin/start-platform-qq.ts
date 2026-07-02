import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import {
  createQqAccountExperimentChannel,
  loadQqAccountExperimentConfig,
} from '../application/qq-account-experiment.factory';

// 1. 从当前目录向上查找 .env
loadNearestEnvFile();

// 2. 创建并启动 QQ 实验通道
const config = loadQqAccountExperimentConfig();
const runtime = createQqAccountExperimentChannel(config);

await runtime.start();

console.log(
  `叶猫猫 QQ 账号实验通道已启动：ws://${config.host}:${config.port}${config.path}`,
);
console.log('请在 NapCat Websocket客户端中配置同一路径，并通过 access_token 完成连接鉴权。');

process.once('SIGINT', () => {
  void stopRuntime('SIGINT');
});

process.once('SIGTERM', () => {
  void stopRuntime('SIGTERM');
});

// 优雅关闭 WebSocket 连接
async function stopRuntime(signal: string): Promise<void> {
  console.log(`收到 ${signal}，正在关闭叶猫猫 QQ 账号实验通道。`);
  await runtime.stop();
  process.exit(0);
}

// 读取最近的 .env 文件
function loadNearestEnvFile(): void {
  const envPath = findNearestFile(process.cwd(), '.env');
  if (!envPath) return;

  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) continue;

    const [key, value] = entry;
    process.env[key] ??= value;
  }
}

// 从启动目录向父级查找文件
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

// 解析单行环境变量
function parseEnvLine(line: string): readonly [string, string] | undefined {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) return undefined;

  const separatorIndex = trimmedLine.indexOf('=');
  if (separatorIndex < 1) return undefined;

  const key = trimmedLine.slice(0, separatorIndex).trim();
  const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
  return [key, unwrapEnvValue(rawValue)];
}

// 去掉包裹引号
function unwrapEnvValue(rawValue: string): string {
  const quote = rawValue[0];
  const shouldUnwrap = (quote === '"' || quote === "'") && rawValue.endsWith(quote);
  if (!shouldUnwrap) return rawValue;

  return rawValue.slice(1, -1);
}
