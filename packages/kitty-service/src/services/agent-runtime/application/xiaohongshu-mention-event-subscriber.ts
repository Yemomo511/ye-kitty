import type { XiaohongshuMentionEventContract } from '@kitty/contracts/events/xiaohongshu-mention-event.contract';
import type { PlatformMessageService } from '@kitty/platforms/shared';
import { writeDebugLog } from '@kitty/shared/infrastructure/logging';

/**
 * Agent Runtime小红书被提及订阅器
 *
 * 本期只证明事件已进入Agent Runtime边界并立即跳过。该类故意不持有Agent、
 * Harness、Skill、工具执行器或平台动作端口，从依赖结构上禁止自动响应。
 */
export class XiaohongshuMentionEventSubscriber {
  constructor(
    private readonly mentionSource: PlatformMessageService<XiaohongshuMentionEventContract>,
  ) {}

  /** 注册小红书被提及事件订阅 */
  async start(): Promise<void> {
    await this.mentionSource.subscribe(async (event) => {
      await this.handleMessage(event);
    });
    console.info('✅ [AgentRuntime-XiaohongshuMentionSubscriber] 已注册小红书被提及事件订阅');
  }

  /** 收到被提及事件后明确停在Harness之前 */
  async handleMessage(event: XiaohongshuMentionEventContract): Promise<void> {
    writeDebugLog(
      `⏭️ [AgentRuntime-XiaohongshuMentionSubscriber-handleMessage] 已收到小红书被提及事件，本期暂不处理 mentionId=${maskId(event.mentionId)}`,
    );
  }
}

function maskId(id: string): string {
  if (id.length <= 6) return '***';
  return `${id.slice(0, 3)}***${id.slice(-3)}`;
}
