/** 项目启动平台 */
export type StartupPlatformSelection = 'qq' | 'xiaohongshu' | 'all';

/** 启动选择解析参数 */
export interface StartupPlatformSelectionOptions {
  /** 命令行参数 */
  readonly args: readonly string[];
  /** 是否可以交互 */
  readonly isInteractive: boolean;
  /** 交互提问能力 */
  readonly ask?: (question: string) => Promise<string>;
}

const STARTUP_MENU = [
  '请选择要启动的平台：',
  '1. QQ',
  '2. 小红书',
  '3. QQ + 小红书',
  '请输入序号：',
].join('\n');

/**
 * 解析项目启动平台
 * @param options 命令行与交互能力
 * @returns 启动平台
 */
export async function resolveStartupPlatformSelection(
  options: StartupPlatformSelectionOptions,
): Promise<StartupPlatformSelection> {
  const argument = options.args.find((value) => value !== '--')?.trim();
  if (argument) return parseSelection(argument);
  if (!options.isInteractive || !options.ask) {
    throw new Error('非交互环境必须显式传入 qq、xiaohongshu 或 all 启动参数');
  }

  return parseSelection((await options.ask(STARTUP_MENU)).trim());
}

// 兼容菜单序号和常用小红书缩写。
function parseSelection(input: string): StartupPlatformSelection {
  if (input === '1' || input === 'qq') return 'qq';
  if (input === '2' || input === 'xiaohongshu' || input === 'xhs') return 'xiaohongshu';
  if (input === '3' || input === 'all') return 'all';
  throw new Error(`启动选项 ${input || '(空)'} 不受支持，请使用 qq、xiaohongshu 或 all`);
}
