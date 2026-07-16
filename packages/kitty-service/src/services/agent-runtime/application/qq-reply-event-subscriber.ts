import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { PlatformMessageService } from '@kitty/platforms/shared';
import type { QqBotClientPort } from '@kitty/platforms/qq/ports/qq-bot-client.port';
import { writeDebugLog } from '@kitty/shared/infrastructure/logging';
import type { ConversationHistoryPort } from '../ports/conversation-history.port';
import type {
  GroupChatCadenceDecision,
  GroupChatCadencePort,
} from '../ports/group-chat-cadence.port';
import type { QqReplyAgentPort } from '../ports/qq-reply-agent.port';
import type { QqHarnessAdmissionQueuePort } from '../ports/qq-harness-admission-queue.port';
import type { SkillContent } from '../domain/skill';
import { InMemoryQqHarnessAdmissionQueue } from './in-memory-qq-harness-admission-queue';
import { QqReplyActionExecutor } from './qq-reply-action-executor';
import type { SkillRuntimeService } from './skill-runtime.service';

const QQ_CHAT_SKILL_NAME = 'qq-chat';

/** QQ回复订阅器配置 */
export interface QqReplyEventSubscriberConfig {
  /** 机器人QQ号，用于判断群聊是否明确@叶猫猫 */
  readonly selfQqId: string;
}

/**
 * QQ回复事件订阅器
 *
 * Agent Runtime 的 RxJS 入口。它订阅下层 QQ 服务发布的标准消息事件，
 * 经过节奏门控和 Harness 准入队列后调用回复 Agent，并通过 QQ 发送端口回写。
 * 准入任务覆盖 Skill 选择、Harness、发送和节奏更新，保证同会话回复顺序。
 */
export class QqReplyEventSubscriber {
  private readonly actionExecutor: QqReplyActionExecutor;
  private readonly harnessAdmissionQueue: QqHarnessAdmissionQueuePort;

  constructor(
    private readonly qqMessageService: PlatformMessageService<ChatEventContract>,
    botClient: QqBotClientPort,
    private readonly replyAgent: QqReplyAgentPort,
    private readonly skillRuntime?: SkillRuntimeService,
    private readonly config?: QqReplyEventSubscriberConfig,
    private readonly conversationHistory?: ConversationHistoryPort,
    private readonly groupChatCadence?: GroupChatCadencePort,
    harnessAdmissionQueue?: QqHarnessAdmissionQueuePort,
  ) {
    this.actionExecutor = new QqReplyActionExecutor(botClient);
    this.harnessAdmissionQueue = harnessAdmissionQueue ?? new InMemoryQqHarnessAdmissionQueue();
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

    this.conversationHistory?.recordMessage(message);
    this.groupChatCadence?.recordMessage(message);

    const mentionsAgent = isMentioningAgent(message, this.config?.selfQqId);
    const cadenceDecision = this.decideGroupCadence(message, mentionsAgent);
    if (cadenceDecision.type !== 'trigger') {
      writeDebugLog(
        `⏭️ [AgentRuntime-QQReplySubscriber-handleMessage] 跳过群聊消息 messageId=${maskId(
          message.message.id,
        )} mentionCount=${message.message.mentions.length} reason=${cadenceDecision.reason}`,
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

    const admissionResult = await this.harnessAdmissionQueue.enqueue({
      event: message,
      mentionsAgent,
      execute: async () => {
        await this.processTriggeredMessage(message, mentionsAgent, cadenceDecision);
      },
    });
    if (admissionResult.status === 'dropped') {
      writeDebugLog(
        `⏭️ [AgentRuntime-QQReplySubscriber-handleMessage] 准入队列已丢弃消息 conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )} reason=${admissionResult.reason}`,
      );
    }
  }

  // 在准入锁内完成Skill选择、Harness循环、QQ动作和节奏状态更新。
  private async processTriggeredMessage(
    message: ChatEventContract,
    mentionsAgent: boolean,
    cadenceDecision: GroupChatCadenceDecision,
  ): Promise<void> {
    writeDebugLog(
      `🚧 [AgentRuntime-QQReplySubscriber-processTriggeredMessage] 开始生成QQ回复 conversationType=${message.conversationType} messageId=${maskId(
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
    const qqChatSkill = await this.loadQqChatSkill(message);
    const reply = await this.replyAgent.generateReply({
      event: message,
      availableSkills,
      ...(qqChatSkill ? { skills: [qqChatSkill] } : {}),
      ...(cadenceDecision.replyRequired
        ? {
            replyIntent: 'required_group_reply' as const,
            requiredToolCalls: ['get_recent_messages'],
            recentMessageLimitHint: 100 as const,
          }
        : {}),
    });

    const sent = await this.actionExecutor.executeReply(message, reply.text, reply.actions ?? []);
    if (sent) this.groupChatCadence?.markReplySent(message);
    console.info(
      `✅ [AgentRuntime-QQReplySubscriber-processTriggeredMessage] 已发送QQ回复 conversationType=${message.conversationType} messageId=${maskId(
        message.message.id,
      )} replyLength=${reply.text?.length ?? 0} actionCount=${reply.actions?.length ?? 0}`,
    );
  }

  // QQ聊天方法论由平台边界预启用，避免每条消息都消耗一轮模型决策。
  private async loadQqChatSkill(message: ChatEventContract): Promise<SkillContent | undefined> {
    if (!this.skillRuntime) return undefined;

    try {
      const skill = await this.skillRuntime.loadSkillContent(QQ_CHAT_SKILL_NAME);
      writeDebugLog(
        `✅ [AgentRuntime-QQReplySubscriber-loadQqChatSkill] 已为QQ消息预启用Skill skill=${QQ_CHAT_SKILL_NAME} conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )}`,
      );
      return skill;
    } catch (error) {
      console.warn(
        `⚠️ [AgentRuntime-QQReplySubscriber-loadQqChatSkill] QQ默认Skill加载失败，已降级为普通Harness回复 skill=${QQ_CHAT_SKILL_NAME} conversationType=${message.conversationType} messageId=${maskId(
          message.message.id,
        )} reason=${formatError(error)}`,
      );
      return undefined;
    }
  }

  // 群聊先过节奏门控，私聊保持直接触发。
  private decideGroupCadence(
    message: ChatEventContract,
    mentionsAgent: boolean,
  ): GroupChatCadenceDecision {
    if (message.conversationType !== 'group') {
      return {
        type: 'trigger',
        replyRequired: false,
        requiresRecentMessages: true,
        recentMessageLimit: 100,
        reason: '私聊不走群聊节奏门控',
      };
    }

    if (this.groupChatCadence) return this.groupChatCadence.shouldTrigger(message);

    if (mentionsAgent) {
      return {
        type: 'trigger',
        triggerMode: 'mention',
        replyRequired: false,
        requiresRecentMessages: true,
        recentMessageLimit: 100,
        reason: '群聊消息明确@叶猫猫，立即触发回复',
      };
    }

    return {
      type: 'ignore',
      replyRequired: false,
      requiresRecentMessages: true,
      recentMessageLimit: 100,
      reason: '未配置群聊节奏门控，未@群聊保持旧逻辑静默',
    };
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

// 将未知异常转为可读原因，避免日志输出完整错误对象。
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
