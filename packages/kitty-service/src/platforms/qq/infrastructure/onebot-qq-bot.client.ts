import type { QqBotClientPort } from '../ports/qq-bot-client.port';
import type { OneBotFastifyReverseWsServer } from './onebot-fastify-reverse-ws.server';

/**
 * OneBot QQ消息客户端
 *
 * 将统一 QQ 发送能力转换为 OneBot 动作。
 * 调用发送方法会通过当前 WebSocket 连接向 NapCat 投递动作请求。
 */
export class OneBotQqBotClient implements QqBotClientPort {
  // 用于关联 OneBot 动作响应
  private nextEchoId = 0;

  constructor(private readonly server: OneBotFastifyReverseWsServer) {}

  /**
   * 发送QQ文本消息
   * @param input 发送目标和文本
   */
  async sendTextMessage(input: {
    readonly conversationExternalId: string;
    readonly conversationType: 'private' | 'group';
    readonly text: string;
  }): Promise<void> {
    const action = input.conversationType === 'group' ? 'send_group_msg' : 'send_private_msg';

    // OneBot 群聊和私聊使用不同目标字段。
    await this.server.sendAction({
      action,
      params: {
        [input.conversationType === 'group' ? 'group_id' : 'user_id']: input.conversationExternalId,
        message: input.text,
      },
      echo: `${action}:${Date.now()}:${this.nextEchoId++}`,
    });
  }
}
