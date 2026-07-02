import type { QqBotClientPort } from '../ports/qq-bot-client.port';
import type { OneBotFastifyReverseWsServer } from './onebot-fastify-reverse-ws.server';

export class OneBotQqBotClient implements QqBotClientPort {
  private nextEchoId = 0;

  constructor(private readonly server: OneBotFastifyReverseWsServer) {}

  async sendTextMessage(input: {
    readonly conversationExternalId: string;
    readonly conversationType: 'private' | 'group';
    readonly text: string;
  }): Promise<void> {
    if (input.conversationType !== 'group') {
      throw new Error('OneBot QQ 实验通道当前只支持群聊回复');
    }

    await this.server.sendAction({
      action: 'send_group_msg',
      params: {
        group_id: input.conversationExternalId,
        message: input.text,
      },
      echo: `send_group_msg:${Date.now()}:${this.nextEchoId++}`,
    });
  }
}
