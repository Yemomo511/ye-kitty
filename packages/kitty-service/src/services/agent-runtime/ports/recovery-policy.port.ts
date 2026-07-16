/**
 * 恢复策略端口
 *
 * 决定 Actor 崩溃后是否重试以及退避时间。
 */
export interface RecoveryPolicyPort {
  /**
   * 判断是否应该重试
   * @param errorCount 当前已累计的崩溃次数
   * @param error 本次异常
   * @returns 是否继续重试
   */
  shouldRetry(errorCount: number, error: Error): boolean;

  /**
   * 计算退避等待时间（毫秒）
   * @param errorCount 当前已累计的崩溃次数
   * @returns 退避毫秒数
   */
  backoffMs(errorCount: number): number;
}
