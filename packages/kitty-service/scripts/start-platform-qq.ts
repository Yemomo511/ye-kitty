import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import {
  createQqAccountExperimentChannel,
  loadQqAccountExperimentConfig,
} from '../src/platforms/qq/application/qq-account-experiment.factory';
import {
  createQqReplyAgent,
  CustomFaceCatalogService,
  DefaultSkillSelector,
  FilesystemSkillReferenceLoader,
  FilesystemSkillMarket,
  GroupChatCadenceController,
  InMemoryConversationHistory,
  loadQqReplyAgentConfig,
  loadCustomFaceVisionAgentConfig,
  MarkdownSkillContentLoader,
  OpenAiCustomFaceVisionAgent,
  QqReplyEventSubscriber,
  SkillRuntimeService,
} from '../src/services/agent-runtime';

// 1. 读取本地 .env，拿到 OneBot 和 QQ 白名单配置。
loadNearestEnvFile();

// 2. 创建 QQ 实验通道，下层平台只负责发布事件和提供发送端口。
const qqConfig = loadQqAccountExperimentConfig();
const qqRuntime = createQqAccountExperimentChannel(qqConfig);

// 3. 启动期只扫描 Skill 元信息，正文留到消息命中后渐进读取。
const skillsRoot = findNearestDirectory(process.cwd(), 'skills');
if (!skillsRoot) throw new Error('未找到根目录 skills 资产目录');
const skillMarket = new FilesystemSkillMarket(skillsRoot);
const skillMetadataList = await skillMarket.listSkillMetadata();
const skillRuntime = new SkillRuntimeService(
  skillMetadataList,
  new DefaultSkillSelector(),
  new MarkdownSkillContentLoader(skillMetadataList),
  new FilesystemSkillReferenceLoader(),
);
console.info(
  `✅ [AgentRuntime-SkillBootstrap] 已加载Skill元信息 count=${skillMetadataList.length}`,
);

// 4. 创建自定义表情目录，NapCat连接建立后刷新缓存。
const visionAgentConfig = loadCustomFaceVisionAgentConfig();
const customFaceCatalog = new CustomFaceCatalogService(
  qqRuntime.botClient,
  visionAgentConfig ? new OpenAiCustomFaceVisionAgent(visionAgentConfig) : undefined,
);
qqRuntime.onClientConnected(() => {
  void customFaceCatalog.refresh().catch((error) => {
    console.warn(
      `⚠️ [AgentRuntime-CustomFaceBootstrap] 自定义表情目录刷新失败，QQ主链路继续运行 reason=${formatError(
        error,
      )}`,
    );
  });
});
console.info(
  `✅ [AgentRuntime-CustomFaceBootstrap] 自定义表情目录已注册 visionEnabled=${visionAgentConfig ? 'true' : 'false'}`,
);

// 5. 创建 Agent Runtime 订阅器，由上层服务主动订阅 QQ 消息事件。
const agentConfig = loadQqReplyAgentConfig();
const conversationHistory = new InMemoryConversationHistory();
const groupChatCadence = new GroupChatCadenceController({ selfQqId: qqConfig.selfQqId });
const qqReplySubscriber = new QqReplyEventSubscriber(
  qqRuntime.channel,
  qqRuntime.botClient,
  createQqReplyAgent(agentConfig, skillRuntime, { conversationHistory, customFaceCatalog }),
  skillRuntime,
  { selfQqId: qqConfig.selfQqId },
  conversationHistory,
  groupChatCadence,
);

// 6. 先注册 Agent Runtime 订阅，再启动 WebSocket 服务，等待 NapCat 主动连接 Ye-Kitty。
console.info(
  `🚧 [QQPlatform-Start] 正在启动QQ实验通道 host=${qqConfig.host} port=${qqConfig.port} path=${qqConfig.path}`,
);
await qqReplySubscriber.start();
await qqRuntime.start();

console.info(
  `✅ [QQPlatform-Start] QQ实验通道已启动 host=${qqConfig.host} port=${qqConfig.port} path=${qqConfig.path}`,
);
console.info(
  '🔍 [QQPlatform-Start] 请在NapCat Websocket客户端中配置同一路径，并通过access_token连接',
);

process.once('SIGINT', () => {
  void stopRuntime('SIGINT');
});

// 7. 进程退出时关闭连接，避免 NapCat 侧残留无效会话。
process.once('SIGTERM', () => {
  void stopRuntime('SIGTERM');
});

// 优雅关闭 WebSocket 连接
async function stopRuntime(signal: string): Promise<void> {
  console.info(`🚧 [QQPlatform-Stop] 正在关闭QQ实验通道 signal=${signal}`);
  await qqRuntime.stop();
  console.info(`✅ [QQPlatform-Stop] QQ实验通道已关闭 signal=${signal}`);
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

// 从启动目录向父级查找目录
function findNearestDirectory(startDirectory: string, directoryName: string): string | undefined {
  let currentDirectory = startDirectory;
  const rootDirectory = parse(startDirectory).root;

  while (true) {
    const candidate = join(currentDirectory, directoryName);
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

// 压缩错误内容
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
