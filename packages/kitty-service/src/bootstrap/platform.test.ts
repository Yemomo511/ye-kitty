import { describe, expect, test, vi } from 'vitest';
import { resolveStartupPlatformSelection } from './platform';

describe('项目启动平台选择', () => {
  test.each([
    ['qq', 'qq'],
    ['xiaohongshu', 'xiaohongshu'],
    ['xhs', 'xiaohongshu'],
    ['all', 'all'],
  ] as const)('命令行参数%s映射为%s', async (input, expected) => {
    await expect(
      resolveStartupPlatformSelection({ args: [input], isInteractive: false }),
    ).resolves.toBe(expected);
  });

  test.each([
    ['1', 'qq'],
    ['2', 'xiaohongshu'],
    ['3', 'all'],
  ] as const)('交互选项%s映射为%s', async (answer, expected) => {
    const ask = vi.fn(async () => answer);

    await expect(
      resolveStartupPlatformSelection({ args: [], isInteractive: true, ask }),
    ).resolves.toBe(expected);
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('小红书'));
  });

  test('非交互环境缺少参数时拒绝挂起等待', async () => {
    await expect(
      resolveStartupPlatformSelection({ args: [], isInteractive: false }),
    ).rejects.toThrow('非交互环境');
  });

  test('未知选项返回可执行参数说明', async () => {
    await expect(
      resolveStartupPlatformSelection({ args: ['unknown'], isInteractive: false }),
    ).rejects.toThrow('qq、xiaohongshu 或 all');
  });
});
