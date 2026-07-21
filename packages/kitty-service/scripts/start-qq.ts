import { bootstrapMcpRuntime } from '../src/bootstrap/tools';
import { findNearestDirectory, loadNearestEnvFile } from '../src/bootstrap/environment';
import {
  createQqAccountExperimentChannel,
  loadQqAccountExperimentConfig,
} from '../src/platforms/qq/runtime';
import { createXiaohongshuMentionSource } from '../src/platforms/xiaohongshu';
import {
  SkillCatalog,
  SkillLoader,
  SkillReferenceLoader,
  SkillRuntime,
  SkillSelector,
} from '../src/agent-runtime/skills';
import { createQqReplyAgent, loadQqReplyAgentConfig } from '../src/bootstrap/agent';
import { InMemoryConversationHistory } from '../src/agent-runtime/history';
import { QqReplyEventSubscriber } from '../src/agent-runtime/subscriber';
import { XiaohongshuMentionEventSubscriber } from '../src/agent-runtime/mention-subscriber';
import { GroupChatCadenceController } from '../src/platforms/qq/cadence';
import { AdmissionQueue } from '../src/agent-runtime/queue';
import { CustomFaceCatalogService } from '../src/platforms/qq/faces';
import {
  loadCustomFaceVisionAgentConfig,
  OpenAiCustomFaceVisionAgent,
} from '../src/platforms/qq/vision-openai';
import { createXiaohongshuMcpServerConfig } from '../src/platforms/xiaohongshu/mcp';

// 1. 读取本地 .env，拿到 OneBot 和 QQ 白名单配置。
loadNearestEnvFile(process.cwd(), process.env);

// 2. 创建 QQ 实验通道，下层平台只负责发布事件和提供发送端口。
const qqConfig = loadQqAccountExperimentConfig();
const qqRuntime = createQqAccountExperimentChannel(qqConfig);

// 3. 启动期只扫描 Skill 元信息，正文留到消息命中后渐进读取。
const skillsRoot = findNearestDirectory(process.cwd(), 'skills');
if (!skillsRoot) throw new Error('未找到根目录 skills 资产目录');
const skillCatalog = new SkillCatalog(skillsRoot);
const skillMetadataList = await skillCatalog.listSkillMetadata();
const skillRuntime = new SkillRuntime(
  skillMetadataList,
  new SkillSelector(),
  new SkillLoader(skillMetadataList),
  new SkillReferenceLoader(),
);
console.info(
  `✅ [AgentRuntime-SkillBootstrap] 已加载Skill元信息 count=${skillMetadataList.length}`,
);

// 4. 启动通用MCP运行时，连接失败的Server会被隔离，不阻断QQ主链路。
const includeXiaohongshu =
  process.env.YE_KITTY_ENABLE_XIAOHONGSHU_MCP?.trim().toLowerCase() === 'true';
const mcpRuntime = await bootstrapMcpRuntime({
  startDirectory: process.cwd(),
  env: process.env,
  includeXiaohongshu,
});

// 小红书组合模式下装配独立信息源，本期不把事件送入Agent。
const deployDirectory = includeXiaohongshu
  ? findNearestDirectory(process.cwd(), 'deploy')
  : undefined;
if (includeXiaohongshu && !deployDirectory) throw new Error('未找到根目录 deploy 资产目录');
const xiaohongshuMentionSource =
  includeXiaohongshu && mcpRuntime && deployDirectory
    ? createXiaohongshuMentionSource({
        caller: mcpRuntime,
        serverName: createXiaohongshuMcpServerConfig(process.env).name,
        deployDirectory,
        env: process.env,
      })
    : undefined;
const xiaohongshuMentionSubscriber = xiaohongshuMentionSource
  ? new XiaohongshuMentionEventSubscriber(xiaohongshuMentionSource)
  : undefined;

// 5. 创建自定义表情目录，NapCat连接建立后刷新缓存。
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

// 6. 创建 Agent Runtime 订阅器，由上层服务主动订阅 QQ 消息事件。
const agentConfig = loadQqReplyAgentConfig();
const conversationHistory = new InMemoryConversationHistory();
const groupChatCadence = new GroupChatCadenceController({ selfQqId: qqConfig.selfQqId });
const admissionQueue = new AdmissionQueue({
  maxConcurrency: 2,
  maxQueueSize: 10,
});
const qqReplySubscriber = new QqReplyEventSubscriber(
  qqRuntime.channel,
  qqRuntime.botClient,
  createQqReplyAgent(agentConfig, skillRuntime, {
    conversationHistory,
    customFaceCatalog,
    runtimeToolProviders: mcpRuntime ? [{ registry: mcpRuntime, executor: mcpRuntime }] : undefined,
  }),
  skillRuntime,
  { selfQqId: qqConfig.selfQqId },
  conversationHistory,
  groupChatCadence,
  admissionQueue,
);

// 7. 先注册全部 Agent Runtime 订阅，再启动平台信息源。
console.info(
  `🚧 [QQPlatform-Start] 正在启动QQ实验通道 host=${qqConfig.host} port=${qqConfig.port} path=${qqConfig.path}`,
);
await qqReplySubscriber.start();
await xiaohongshuMentionSubscriber?.start();
await xiaohongshuMentionSource?.start();
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

// 8. 进程退出时关闭外部工具和WebSocket连接，避免残留无效会话。
process.once('SIGTERM', () => {
  void stopRuntime('SIGTERM');
});

// 优雅关闭 WebSocket 连接
async function stopRuntime(signal: string): Promise<void> {
  console.info(`🚧 [QQPlatform-Stop] 正在关闭QQ实验通道 signal=${signal}`);
  await xiaohongshuMentionSource?.stop();
  await mcpRuntime?.stop();
  await qqRuntime.stop();
  console.info(`✅ [QQPlatform-Stop] QQ实验通道已关闭 signal=${signal}`);
  process.exit(0);
}

// 压缩错误内容
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
