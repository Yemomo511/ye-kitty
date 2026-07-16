import type { McpToolCallResult } from '../ports/mcp-client.port';
import type { McpRawToolCallerPort } from '../ports/mcp-raw-tool-caller.port';
import type {
  XiaohongshuLoginQrcode,
  XiaohongshuQrcodePresenterPort,
} from '../ports/xiaohongshu-qrcode-presenter.port';

/** 小红书登录服务参数 */
export interface XiaohongshuMcpLoginServiceOptions {
  /** MCP原始调用能力 */
  readonly caller: McpRawToolCallerPort;
  /** 二维码展示能力 */
  readonly presenter: XiaohongshuQrcodePresenterPort;
  /** MCP Server名称 */
  readonly serverName: string;
  /** 扫码超时毫秒 */
  readonly timeoutMs: number;
  /** 状态轮询间隔毫秒 */
  readonly pollIntervalMs: number;
  /** 当前时间能力 */
  readonly now?: () => number;
  /** 等待能力 */
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

/** 小红书登录结果 */
export interface XiaohongshuMcpLoginResult {
  /** 登录结果状态 */
  readonly status: 'already_logged_in' | 'logged_in';
  /** 上游返回用户名 */
  readonly username?: string;
  /** 本次二维码路径 */
  readonly qrcodePath?: string;
}

interface ParsedLoginStatus {
  readonly loggedIn: boolean;
  readonly username?: string;
}

const CHECK_LOGIN_TOOL = 'check_login_status';
const GET_QRCODE_TOOL = 'get_login_qrcode';

/**
 * 小红书MCP登录编排
 *
 * 只通过MCP工具检查和建立登录状态。未登录时展示二维码并轮询，
 * 不读取上游Cookie，也不调用删除、发布或互动工具。
 */
export class XiaohongshuMcpLoginService {
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: XiaohongshuMcpLoginServiceOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? wait;
  }

  /** 检查账号并在需要时完成扫码登录 */
  async ensureLoggedIn(): Promise<XiaohongshuMcpLoginResult> {
    console.info('🚧 [XiaohongshuMCP-Login-check] 正在检查小红书账号登录状态');
    const initialStatus = await this.checkLoginStatus();
    if (initialStatus.loggedIn) {
      console.info('✅ [XiaohongshuMCP-Login-check] 小红书账号已登录');
      return { status: 'already_logged_in', username: initialStatus.username };
    }

    const qrcodeResult = await this.callRequiredTool(GET_QRCODE_TOOL);
    const raceStatus = parseLoginStatus(qrcodeResult);
    if (raceStatus?.loggedIn) {
      console.info('✅ [XiaohongshuMCP-Login-check] 小红书账号已在二维码请求期间登录');
      return { status: 'logged_in', username: raceStatus.username };
    }

    const qrcode = parseQrcode(qrcodeResult);
    if (!qrcode) throw new Error('小红书MCP没有返回二维码图片，无法继续登录');
    const qrcodePath = await this.options.presenter.present(qrcode);
    console.info(
      `🚧 [XiaohongshuMCP-Login-wait] 请使用小红书App扫码 qrcodePath=${qrcodePath} timeoutMs=${this.options.timeoutMs}`,
    );

    const deadline = this.now() + this.options.timeoutMs;
    while (this.now() < deadline) {
      await this.sleep(this.options.pollIntervalMs);
      const status = await this.checkLoginStatus();
      if (!status.loggedIn) continue;
      console.info('✅ [XiaohongshuMCP-Login-check] 小红书账号登录状态确认成功');
      return { status: 'logged_in', username: status.username, qrcodePath };
    }

    throw new Error(`小红书扫码登录超时，请重新启动后获取新二维码。qrcodePath=${qrcodePath}`);
  }

  // 调用并解析登录状态。
  private async checkLoginStatus(): Promise<ParsedLoginStatus> {
    const result = await this.callRequiredTool(CHECK_LOGIN_TOOL);
    const status = parseLoginStatus(result);
    if (!status) throw new Error('小红书MCP返回了无法识别的登录状态');
    return status;
  }

  // 调用登录必需工具并处理MCP错误。
  private async callRequiredTool(toolName: string): Promise<McpToolCallResult> {
    const publicName = `${this.options.serverName}_${toolName}`;
    if (!this.options.caller.hasTool(publicName)) {
      throw new Error(`小红书MCP缺少必需工具 ${toolName}，请检查allowedTools和上游版本`);
    }
    const result = await this.options.caller.callToolRaw(publicName, null);
    if (result.isError) {
      throw new Error(`小红书MCP工具 ${toolName} 调用失败：${extractText(result) || '未知错误'}`);
    }
    return result;
  }
}

// 解析上游中文登录状态。
function parseLoginStatus(result: McpToolCallResult): ParsedLoginStatus | undefined {
  const text = extractText(result);
  if (text.includes('✅ 已登录') || text.includes('你当前已处于登录状态')) {
    return { loggedIn: true, username: text.match(/用户名:\s*([^\n]+)/)?.[1]?.trim() };
  }
  if (text.includes('未登录')) return { loggedIn: false };
  return undefined;
}

// 解析上游图片内容块。
function parseQrcode(result: McpToolCallResult): XiaohongshuLoginQrcode | undefined {
  if (!Array.isArray(result.content)) return undefined;
  const image = result.content.find(
    (item) =>
      isRecord(item) &&
      item.type === 'image' &&
      typeof item.data === 'string' &&
      typeof item.mimeType === 'string',
  );
  if (!isRecord(image)) return undefined;
  return { data: image.data as string, mimeType: image.mimeType as string };
}

// 提取全部文本内容块。
function extractText(result: McpToolCallResult): string {
  if (typeof result.content === 'string') return result.content;
  if (!Array.isArray(result.content)) return '';
  return result.content
    .flatMap((item) =>
      isRecord(item) && item.type === 'text' && typeof item.text === 'string' ? [item.text] : [],
    )
    .join('\n');
}

// 判断普通对象。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 等待下一次登录检查。
async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
