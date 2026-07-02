import type { EventBusPort } from '@kitty/shared/types/event-bus';
import type { ConversationId } from '@kitty/shared/types/ids';
import { QqMessageIngressService } from './qq-message-ingress.service';
import { OneBotMessageIngressService } from './onebot-message-ingress.service';
import { isOneBotV11GroupMessageEvent } from '../domain/onebot-v11';
import type { QqBotClientPort } from '../ports/qq-bot-client.port';
import type { OneBotFastifyReverseWsServer } from '../infrastructure/onebot-fastify-reverse-ws.server';

export interface QqAccountExperimentChannelConfig {
  readonly selfQqId: string;
  readonly allowedGroupIds: readonly string[];
}

export class QqAccountExperimentChannel {
  private readonly oneBotIngress = new OneBotMessageIngressService();
  private readonly qqIngress = new QqMessageIngressService();

  constructor(
    private readonly config: QqAccountExperimentChannelConfig,
    private readonly server: OneBotFastifyReverseWsServer,
    private readonly eventBus: EventBusPort,
    private readonly botClient: QqBotClientPort,
  ) {}

  async start(): Promise<void> {
    this.server.registerRawMessageHandler(async (rawMessage) => {
      await this.handleRawMessage(rawMessage);
    });

    await this.server.start();
  }

  async stop(): Promise<void> {
    await this.server.stop();
  }

  async handleRawMessage(rawMessage: unknown): Promise<void> {
    if (!isOneBotV11GroupMessageEvent(rawMessage)) return;
    if (!this.shouldAcceptGroupMessage(rawMessage.group_id, rawMessage.user_id)) return;

    const qqPayload = this.oneBotIngress.toQqTextMessagePayload(rawMessage);
    const normalized = await this.qqIngress.normalize(qqPayload);

    await this.eventBus.publish({
      eventId: normalized.event.id,
      eventType: normalized.event.eventType,
      occurredAt: normalized.event.receivedAt,
      payload: normalized.event,
    });

    if (qqPayload.text.length === 0) return;

    await this.botClient.sendTextMessage({
      conversationExternalId: this.stripQqConversationPrefix(normalized.event.conversationId),
      conversationType: 'group',
      text: `叶猫猫收到：${qqPayload.text}`,
    });
  }

  private shouldAcceptGroupMessage(groupId: number, senderUserId: number): boolean {
    if (String(senderUserId) === this.config.selfQqId) return false;
    return this.config.allowedGroupIds.includes(String(groupId));
  }

  private stripQqConversationPrefix(conversationId: ConversationId): string {
    return String(conversationId).replace('qq:conversation:', '');
  }
}
