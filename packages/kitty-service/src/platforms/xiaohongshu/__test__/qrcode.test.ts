import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LocalXiaohongshuQrcodePresenter, resolveSystemOpenCommand } from '../qrcode';

describe('小红书登录二维码展示', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
    );
  });

  test('把Base64图片写入PNG并调用系统打开能力', async () => {
    const outputPath = await createOutputPath();
    const openFile = vi.fn(async () => undefined);
    const presenter = new LocalXiaohongshuQrcodePresenter({ outputPath, openFile });

    await expect(presenter.present({ data: 'cG5nLWRhdGE=', mimeType: 'image/png' })).resolves.toBe(
      outputPath,
    );
    await expect(readFile(outputPath, 'utf8')).resolves.toBe('png-data');
    expect(openFile).toHaveBeenCalledWith(outputPath);
  });

  test('系统打开失败时保留二维码文件并记录降级日志', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const outputPath = await createOutputPath();
    const presenter = new LocalXiaohongshuQrcodePresenter({
      outputPath,
      openFile: vi.fn(async () => {
        throw new Error('没有图片应用');
      }),
    });

    await expect(presenter.present({ data: 'cG5n', mimeType: 'image/png' })).resolves.toBe(
      outputPath,
    );
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(outputPath));
  });

  test('拒绝非PNG内容和非法Base64', async () => {
    const outputPath = await createOutputPath();
    const presenter = new LocalXiaohongshuQrcodePresenter({
      outputPath,
      openFile: vi.fn(async () => undefined),
    });

    await expect(presenter.present({ data: 'cG5n', mimeType: 'image/jpeg' })).rejects.toThrow(
      'PNG',
    );
    await expect(presenter.present({ data: '***', mimeType: 'image/png' })).rejects.toThrow(
      'Base64',
    );
    await expect(presenter.present({ data: '', mimeType: 'image/png' })).rejects.toThrow('Base64');
  });

  test('为常见桌面系统生成不经过Shell的打开命令', () => {
    expect(resolveSystemOpenCommand('darwin', '/tmp/login.png')).toEqual({
      command: 'open',
      args: ['/tmp/login.png'],
    });
    expect(resolveSystemOpenCommand('win32', 'C:\\login.png')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'C:\\login.png'],
    });
    expect(resolveSystemOpenCommand('linux', '/tmp/login.png')).toEqual({
      command: 'xdg-open',
      args: ['/tmp/login.png'],
    });
  });

  async function createOutputPath(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'ye-kitty-xhs-qrcode-'));
    temporaryDirectories.push(directory);
    return join(directory, 'login.png');
  }
});
