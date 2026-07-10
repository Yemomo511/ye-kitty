import type { RecoveryPolicyPort } from '../ports/recovery-policy.port';

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * 指数退避恢复策略
 *
 * 崩溃后按指数退避重试最多 3 次（1s → 2s → 4s）。
 * 超过最大次数后不再重试，由 Supervisor 标记 Actor 为 faulty。
 */
export class ExponentialBackoffRecoveryPolicy implements RecoveryPolicyPort {
  constructor(private readonly maxRetries = DEFAULT_MAX_RETRIES) {}

  /**
   * 判断是否应该重试
   * @param errorCount 当前已累计的崩溃次数
   * @returns 是否继续重试
   */
  shouldRetry(errorCount: number, _error: Error): boolean {
    return errorCount < this.maxRetries;
  }

  /**
   * 计算退避等待时间（毫秒）
   * @param errorCount 当前已累计的崩溃次数
   * @returns 退避毫秒数（1s × 2^errorCount）
   */
  backoffMs(errorCount: number): number {
    return 1000 * Math.pow(2, errorCount);
  }
}
