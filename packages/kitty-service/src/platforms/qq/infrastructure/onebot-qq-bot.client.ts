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
    const action = input.conversationType === 'group' ? 'send_group_msg' : 'send_private_msg';

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
