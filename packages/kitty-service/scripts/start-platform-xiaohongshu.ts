import { bootstrapMcpRuntime } from '../src/bootstrap/mcp-runtime-bootstrap';
import { loadNearestEnvFile } from '../src/bootstrap/runtime-environment';

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

console.info(
  `✅ [XiaohongshuPlatform-Start] 小红书MCP已接入 toolCount=${mcpRuntime.listTools().length}`,
);
console.info('🔍 [XiaohongshuPlatform-Start] 当前仅保持MCP工具连接，按Ctrl+C退出');

process.once('SIGINT', () => {
  void stopRuntime('SIGINT');
});
process.once('SIGTERM', () => {
  void stopRuntime('SIGTERM');
});

// 3. 保持MCP连接，等待后续Harness或人工停止。
await new Promise<void>(() => undefined);

// 关闭MCP连接，容器继续保留登录状态。
async function stopRuntime(signal: string): Promise<void> {
  console.info(`🚧 [XiaohongshuPlatform-Stop] 正在关闭小红书MCP连接 signal=${signal}`);
  await activeMcpRuntime.stop();
  console.info(`✅ [XiaohongshuPlatform-Stop] 小红书MCP连接已关闭 signal=${signal}`);
  process.exit(0);
}
