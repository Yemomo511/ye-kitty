import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import {
  createMessageAdapterRuntime,
  loadMessageAdapterRuntimeConfig,
} from '../src/platforms/messageAdapter/application/message-adapter.runtime';

// 1. 读取本地 .env，拿到 OneBot 和 QQ 白名单配置。
loadNearestEnvFile();

// 2. 创建消息调度层，把 QQ 实验通道和 Agent Runtime 组装起来。
const config = loadMessageAdapterRuntimeConfig();
const runtime = createMessageAdapterRuntime(config);

// 3. 先注册消息订阅，再启动 WebSocket 服务，等待 NapCat 主动连接 Ye-Kitty。
console.info(
  `🚧 [QQPlatform-Start] 正在启动QQ消息调度层 host=${config.host} port=${config.port} path=${config.path}`,
);
await runtime.start();

console.info(
  `✅ [QQPlatform-Start] QQ消息调度层已启动 host=${config.host} port=${config.port} path=${config.path}`,
);
console.info(
  '🔍 [QQPlatform-Start] 请在NapCat Websocket客户端中配置同一路径，并通过access_token连接',
);

process.once('SIGINT', () => {
  void stopRuntime('SIGINT');
});

// 4. 进程退出时关闭连接，避免 NapCat 侧残留无效会话。
process.once('SIGTERM', () => {
  void stopRuntime('SIGTERM');
});

// 优雅关闭 WebSocket 连接
async function stopRuntime(signal: string): Promise<void> {
  console.info(`🚧 [QQPlatform-Stop] 正在关闭QQ消息调度层 signal=${signal}`);
  await runtime.stop();
  console.info(`✅ [QQPlatform-Stop] QQ消息调度层已关闭 signal=${signal}`);
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
