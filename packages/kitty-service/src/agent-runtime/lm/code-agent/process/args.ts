/**
 * argv 预算检查
 *
 * 抄 open-design runtimes/prompt-budget.ts 思路：
 * Windows 命令行长度上限约 32767 字符（CreateProcess），
 * 留 7% 余量设 30KB 上限。超限 → 抛错，引擎转 spawn_failure。
 * 此检查与 buildArgs 的类型强制（Omit prompt）构成双保险。
 */

/** Windows argv 预算上限（字节） */
const WINDOWS_ARGV_MAX_BYTES = 30 * 1024;

/**
 * 校验 argv 数组是否超过各平台的预算限制。
 * 超限时抛出 Error（由调用方转为 spawn_failure）。
 */
export function assertArgvBudget(args: readonly string[]): void {
  const totalBytes = args.reduce((sum, arg) => sum + Buffer.byteLength(arg, 'utf-8') + 1, 0);

  // Windows 限制（POSIX 限制通常更高，不检查）
  if (totalBytes > WINDOWS_ARGV_MAX_BYTES) {
    throw new Error(
      `CLI 参数总长度 (${totalBytes} bytes) 超过 Windows 预算 (${WINDOWS_ARGV_MAX_BYTES} bytes)。` +
        `请检查 adapter buildArgs 是否误将 prompt 塞入 argv（prompt 必须经 stdin 传递）。`,
    );
  }
}
