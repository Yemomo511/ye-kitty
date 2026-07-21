import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { XiaohongshuLoginQrcode, XiaohongshuQrcodePresenterPort } from './qrcode-type';

/** 本地二维码展示参数 */
export interface LocalXiaohongshuQrcodePresenterOptions {
  /** 二维码输出路径 */
  readonly outputPath?: string;
  /** 系统文件打开能力 */
  readonly openFile?: (path: string) => Promise<void>;
}

const executeFile = promisify(execFile);
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** 系统文件打开命令 */
export interface SystemOpenCommand {
  /** 可执行命令 */
  readonly command: string;
  /** 命令参数 */
  readonly args: readonly string[];
}

/**
 * 本地小红书二维码展示器
 *
 * 把MCP图片内容保存到临时PNG，并尽力调用系统默认图片应用。
 * 打开失败只降级为打印文件路径，不丢失可扫码资源。
 */
export class LocalXiaohongshuQrcodePresenter implements XiaohongshuQrcodePresenterPort {
  private readonly outputPath: string;
  private readonly openFile: (path: string) => Promise<void>;

  constructor(options: LocalXiaohongshuQrcodePresenterOptions = {}) {
    this.outputPath = options.outputPath ?? join(tmpdir(), 'ye-kitty-xiaohongshu-login.png');
    this.openFile = options.openFile ?? openWithSystemApplication;
  }

  /** 保存并打开登录二维码 */
  async present(qrcode: XiaohongshuLoginQrcode): Promise<string> {
    if (qrcode.mimeType !== 'image/png') throw new Error('小红书登录二维码必须是PNG图片');
    if (qrcode.data.length === 0 || !BASE64_PATTERN.test(qrcode.data)) {
      throw new Error('小红书登录二维码Base64数据不合法');
    }

    await writeFile(this.outputPath, Buffer.from(qrcode.data, 'base64'));
    try {
      await this.openFile(this.outputPath);
      console.info(
        `✅ [XiaohongshuMCP-Qrcode-present] 已打开小红书登录二维码 path=${this.outputPath}`,
      );
    } catch (error) {
      console.warn(
        `⚠️ [XiaohongshuMCP-Qrcode-present] 无法自动打开二维码，请手动打开文件 path=${this.outputPath} reason=${formatError(error)}`,
      );
    }
    return this.outputPath;
  }
}

// 使用当前系统默认应用打开文件。
async function openWithSystemApplication(path: string): Promise<void> {
  const command = resolveSystemOpenCommand(process.platform, path);
  await executeFile(command.command, [...command.args]);
}

/** 根据系统生成无Shell插值的文件打开命令 */
export function resolveSystemOpenCommand(
  platform: NodeJS.Platform,
  path: string,
): SystemOpenCommand {
  if (platform === 'darwin') return { command: 'open', args: [path] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', path] };
  return { command: 'xdg-open', args: [path] };
}

// 压缩系统打开错误。
function formatError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
