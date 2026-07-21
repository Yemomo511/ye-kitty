import { describe, expect, test, vi } from 'vitest';
import { XiaohongshuMcpLoginService } from './login';
import type { McpRawToolCaller, McpToolCallResult } from '@kitty/shared/mcp';
import type { XiaohongshuQrcodePresenterPort } from './qrcode-type';

describe('小红书MCP登录', () => {
  test('已经登录时只检查一次状态', async () => {
    const caller = createCaller([textResult('✅ 已登录\n用户名: 叶猫猫')]);
    const presenter = createPresenter();
    const service = createService(caller, presenter);

    await expect(service.ensureLoggedIn()).resolves.toEqual({
      status: 'already_logged_in',
      username: '叶猫猫',
    });
    expect(caller.callToolRaw).toHaveBeenCalledTimes(1);
    expect(presenter.present).not.toHaveBeenCalled();
  });

  test('未登录时展示二维码并轮询到登录成功', async () => {
    const caller = createCaller([
      textResult('❌ 未登录'),
      {
        content: [
          { type: 'text', text: '请用小红书 App 扫码登录' },
          { type: 'image', mimeType: 'image/png', data: 'cG5n' },
        ],
      },
      textResult('❌ 未登录'),
      textResult('✅ 已登录\n用户名: 叶猫猫'),
    ]);
    const presenter = createPresenter('/tmp/xhs-login.png');
    const sleep = vi.fn(async () => undefined);
    const service = createService(caller, presenter, { sleep });

    await expect(service.ensureLoggedIn()).resolves.toEqual({
      status: 'logged_in',
      username: '叶猫猫',
      qrcodePath: '/tmp/xhs-login.png',
    });
    expect(presenter.present).toHaveBeenCalledWith({
      data: 'cG5n',
      mimeType: 'image/png',
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(caller.callToolRaw.mock.calls.map(([toolName]) => toolName)).toEqual([
      'xiaohongshu_check_login_status',
      'xiaohongshu_get_login_qrcode',
      'xiaohongshu_check_login_status',
      'xiaohongshu_check_login_status',
    ]);
  });

  test('二维码请求期间账号已登录时直接完成', async () => {
    const caller = createCaller([textResult('❌ 未登录'), textResult('你当前已处于登录状态')]);
    const presenter = createPresenter();

    await expect(createService(caller, presenter).ensureLoggedIn()).resolves.toEqual({
      status: 'logged_in',
    });
    expect(presenter.present).not.toHaveBeenCalled();
  });

  test('二维码响应缺少图片时中断登录', async () => {
    const caller = createCaller([textResult('❌ 未登录'), textResult('请用小红书 App 扫码登录')]);

    await expect(createService(caller, createPresenter()).ensureLoggedIn()).rejects.toThrow(
      '没有返回二维码图片',
    );
  });

  test('MCP工具返回错误时保留工具名并中断', async () => {
    const caller = createCaller([{ ...textResult('浏览器启动失败'), isError: true }]);

    await expect(createService(caller, createPresenter()).ensureLoggedIn()).rejects.toThrow(
      'check_login_status',
    );
  });

  test('缺少登录必需工具时给出配置提示', async () => {
    const caller = createCaller([]);
    caller.hasTool.mockReturnValue(false);

    await expect(createService(caller, createPresenter()).ensureLoggedIn()).rejects.toThrow(
      '请检查allowedTools和上游版本',
    );
    expect(caller.callToolRaw).not.toHaveBeenCalled();
  });

  test('超过登录等待时间后中断', async () => {
    const caller = createCaller([
      textResult('❌ 未登录'),
      { content: [{ type: 'image', mimeType: 'image/png', data: 'cG5n' }] },
      textResult('❌ 未登录'),
      textResult('❌ 未登录'),
    ]);
    let now = 0;
    const service = createService(caller, createPresenter(), {
      timeoutMs: 2000,
      pollIntervalMs: 1000,
      now: () => now,
      sleep: vi.fn(async (milliseconds: number) => {
        now += milliseconds;
      }),
    });

    await expect(service.ensureLoggedIn()).rejects.toThrow('扫码登录超时');
  });
});

function createService(
  caller: ReturnType<typeof createCaller>,
  presenter: ReturnType<typeof createPresenter>,
  overrides: Partial<ConstructorParameters<typeof XiaohongshuMcpLoginService>[0]> = {},
): XiaohongshuMcpLoginService {
  return new XiaohongshuMcpLoginService({
    caller,
    presenter,
    serverName: 'xiaohongshu',
    timeoutMs: 240000,
    pollIntervalMs: 1000,
    now: () => 0,
    sleep: async () => undefined,
    ...overrides,
  });
}

function createCaller(results: McpToolCallResult[]) {
  return {
    hasTool: vi.fn(() => true),
    callToolRaw: vi.fn(async (...args: [string, unknown]) => {
      void args;
      const result = results.shift();
      if (!result) throw new Error('测试未准备MCP结果');
      return result;
    }),
  } satisfies McpRawToolCaller;
}

function createPresenter(path = '/tmp/xhs-login.png') {
  return {
    present: vi.fn(async () => path),
  } satisfies XiaohongshuQrcodePresenterPort;
}

function textResult(text: string): McpToolCallResult {
  return { content: [{ type: 'text', text }] };
}
