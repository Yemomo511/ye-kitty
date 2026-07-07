import type { QqBotClientPort } from '../ports/qq-bot-client.port';
import {
  OneBotWsExternalActionApi,
  type QqExternalActionApi,
  type QqCustomFaceResource,
  type QqOutboundMessageSegment,
  type QqReactToMessageInput,
} from './api';
import type { OneBotFastifyReverseWsServer } from './onebot-fastify-reverse-ws.server';

/**
 * OneBot QQ消息客户端
 *
 * 将上层 QQ 发送能力委托给受控外部动作API。
 * 该客户端保留旧的文本发送端口，同时开放首版安全互动动作。
 */
export class OneBotQqBotClient implements QqBotClientPort {
  private readonly actionApi: QqExternalActionApi;

  constructor(server: OneBotFastifyReverseWsServer, actionApi?: QqExternalActionApi) {
    this.actionApi = actionApi ?? new OneBotWsExternalActionApi(server);
  }

  /**
   * 发送QQ文本消息
   * @param input 发送目标和文本
   */
  async sendTextMessage(input: {
    readonly conversationExternalId: string;
    readonly conversationType: 'private' | 'group';
    readonly text: string;
  }): Promise<void> {
    await this.actionApi.sendText(input);
  }

  /**
   * 发送QQ消息段
   * @param input 发送目标和消息段
   */
  async sendMessageSegments(input: {
    readonly conversationExternalId: string;
    readonly conversationType: 'private' | 'group';
    readonly segments: readonly QqOutboundMessageSegment[];
  }): Promise<void> {
    await this.actionApi.sendMessage(input);
  }

  /**
   * 发送QQ戳一戳
   * @param input 会话和用户目标
   */
  async sendPoke(input: {
    readonly conversationExternalId: string;
    readonly conversationType: 'private' | 'group';
    readonly userExternalId: string;
  }): Promise<void> {
    await this.actionApi.sendPoke(input);
  }

  /**
   * 对QQ消息做表情回应
   * @param input 消息和表情目标
   */
  async reactToMessage(input: QqReactToMessageInput): Promise<void> {
    await this.actionApi.reactToMessage(input);
  }

  /**
   * 读取QQ自定义表情
   * @returns 可发送表情资源
   */
  async fetchCustomFaces(): Promise<readonly QqCustomFaceResource[]> {
    return await this.actionApi.fetchCustomFaces();
  }
}
