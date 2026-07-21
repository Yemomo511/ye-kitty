import { bootstrapMcpRuntime } from '../src/bootstrap/tools';
import { findNearestDirectory, loadNearestEnvFile } from '../src/bootstrap/environment';
import { createXiaohongshuMentionSource } from '../src/platforms/xiaohongshu';
import { XiaohongshuMentionEventSubscriber } from '../src/agent-runtime/mention-subscriber';
import { createXiaohongshuMcpServerConfig } from '../src/platforms/xiaohongshu/mcp';

// 1. 读取项目环境并明确启用小红书MCP。
loadNearestEnvFile(process.cwd(), process.env);

// 2. 启动上游容器、连接MCP并完成账号登录检查。
const mcpRuntime = await bootstrapMcpRuntime({
  startDirectory: process.cwd(),
  env: process.env,
  includeXiaohongshu: true,
});
if (!mcpRuntime) throw new Error('小红书MCP启动后没有可用运行时');
const activeMcpRuntime = mcpRuntime;
const deployDirectory = findNearestDirectory(process.cwd(), 'deploy');
if (!deployDirectory) throw new Error('未找到根目录 deploy 资产目录');

// 3. 平台层只读取和广播被提及事件，Agent Runtime本期只订阅后跳过。
const mentionSource = createXiaohongshuMentionSource({
  caller: mcpRuntime,
  serverName: createXiaohongshuMcpServerConfig(process.env).name,
  deployDirectory,
  env: process.env,
});
const mentionSubscriber = new XiaohongshuMentionEventSubscriber(mentionSource);
await mentionSubscriber.start();
await mentionSource.start();

console.info(
  `✅ [XiaohongshuPlatform-Start] 小红书MCP已接入 toolCount=${mcpRuntime.listTools().length}`,
);
console.info(
  '🔍 [XiaohongshuPlatform-Start] 已监听被提及提醒，Agent Runtime暂不处理，按Ctrl+C退出',
);

process.once('SIGINT', () => {
  void stopRuntime('SIGINT');
});
process.once('SIGTERM', () => {
  void stopRuntime('SIGTERM');
});

// 4. 保持MCP连接和被提及轮询，等待人工停止。
await new Promise<void>(() => undefined);

// 先停止信息源再关闭MCP连接，容器继续保留登录状态。
async function stopRuntime(signal: string): Promise<void> {
  console.info(`🚧 [XiaohongshuPlatform-Stop] 正在关闭小红书MCP连接 signal=${signal}`);
  await mentionSource.stop();
  await activeMcpRuntime.stop();
  console.info(`✅ [XiaohongshuPlatform-Stop] 小红书MCP连接已关闭 signal=${signal}`);
  process.exit(0);
}
