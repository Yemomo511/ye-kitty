import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { PlatformMessageService } from '@kitty/platforms/shared';
import type { QqBotClientPort } from '@kitty/platforms/qq/ports/qq-bot-client.port';
import { writeDebugLog } from '@kitty/shared/infrastructure/logging';
import type { QqReplyAgentPort } from '../ports/qq-reply-agent.port';
import { QqReplyActionExecutor } from './qq-reply-action-executor';
import type { SkillRuntimeService } from './skill-runtime.service';

/** QQ回复订阅器配置 */
export interface QqReplyEventSubscriberConfig {
  /** 机器人QQ号，用于判断群聊是否明确@叶猫猫 */
  readonly selfQqId: string;
}

/**
 * QQ回复事件订阅器
 *
 * Agent Runtime 的 RxJS 入口。它订阅下层 QQ 服务发布的标准消息事件，
 * 调用 QQ 回复 Agent 生成文本，并通过 QQ 发送端口完成 MVP 回写。
 */
export class QqReplyEventSubscriber {
  private readonly actionExecutor: QqReplyActionExecutor;

  constructor(
    private readonly qqMessageService: PlatformMessageService<ChatEventContract>,
    botClient: QqBotClientPort,
    private readonly replyAgent: QqReplyAgentPort,
    private readonly skillRuntime?: SkillRuntimeService,
    private readonly config?: QqReplyEventSubscriberConfig,
  ) {
    this.actionExecutor = new QqReplyActionExecutor(botClient);
  }

  /**
   * 注册QQ消息订阅
   *
   * 订阅必须由上层 Agent Runtime 发起，避免 QQ 平台模块反向依赖业务服务。
   */
  async start(): Promise<void> {
    console.info('✅ [AgentRuntime-QQReplySubscriber] 已注册QQ消息订阅');
    await this.qqMessageService.subscribe(async (message) => {
      await this.handleMessage(message);
    });
  }

  /**
   * 处理QQ消息
   * @param message 标准消息
   */
  async handleMessage(message: ChatEventContract): Promise<void> {
    if (!isQqReceivedMessage(message)) return;

    const mentionsAgent = isMentioningAgent(message, this.config?.selfQqId);
    if (message.conversationType === 'group' && !mentionsAgent) {
      writeDebugLog(
        `⏭️ [AgentRuntime-QQReplySubscriber-handleMessage] 跳过未@叶猫猫的群聊消息 messageId=${maskId(
          message.message.id,
        )} mentionCount=${message.message.mentions.length}`,
      );
      return;
    }

    if (message.message.text.trim().length === 0) {
      writeDebugLog(
        `⏭️ [AgentRuntime-QQReplySubscriber-handleMessage] 跳过空文本消息 conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )}`,
      );
      return;
    }

    writeDebugLog(
      `🚧 [AgentRuntime-QQReplySubscriber-handleMessage] 开始生成QQ回复 conversationType=${message.conversationType} messageId=${maskId(
        message.message.id,
      )} textLength=${message.message.text.length}`,
    );
    const availableSkills = await this.skillRuntime?.selectSkillsForRun({
      platform: message.platform,
      conversationType: message.conversationType,
      messageText: message.message.text,
      mentionsAgent,
      receivedAt: message.receivedAt,
    });
    const reply = await this.replyAgent.generateReply({ event: message, availableSkills });

    await this.actionExecutor.executeReply(message, reply.text, reply.actions ?? []);
    console.info(
      `✅ [AgentRuntime-QQReplySubscriber-handleMessage] 已发送QQ回复 conversationType=${message.conversationType} messageId=${maskId(
        message.message.id,
      )} replyLength=${reply.text?.length ?? 0} actionCount=${reply.actions?.length ?? 0}`,
    );
  }
}

// 识别 QQ 标准收信事件，避免 Agent Runtime 处理非目标消息。
function isQqReceivedMessage(message: ChatEventContract): boolean {
  return message.platform === 'qq' && message.eventType === 'message.received';
}

// 群聊只把明确@机器人QQ号的消息交给模型，避免叶猫猫主动打断普通闲聊。
function isMentioningAgent(message: ChatEventContract, selfQqId: string | undefined): boolean {
  if (message.conversationType !== 'group') return false;
  if (!selfQqId) return false;
  return message.message.mentions.includes(selfQqId);
}

// 脱敏消息ID，仅保留排障所需的尾部特征。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}
