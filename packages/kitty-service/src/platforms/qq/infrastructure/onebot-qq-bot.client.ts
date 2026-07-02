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
    // 1. 群聊和好友消息在 OneBot 中对应不同动作名。
    const action = input.conversationType === 'group' ? 'send_group_msg' : 'send_private_msg';

    // 2. 群聊使用 group_id，好友私聊使用 user_id。
    const targetField = input.conversationType === 'group' ? 'group_id' : 'user_id';

    // 3. 通过当前 WebSocket 连接把回复动作交给 NapCat 执行。
    await this.server.sendAction({
      action,
      params: {
        [targetField]: input.conversationExternalId,
        message: input.text,
      },
      echo: `${action}:${Date.now()}:${this.nextEchoId++}`,
    });
  }
}
