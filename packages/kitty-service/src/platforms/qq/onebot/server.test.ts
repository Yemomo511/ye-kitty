import { describe, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { OneBotFastifyReverseWsServer } from './server';

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('message', (data) => {
      resolve(JSON.parse(data.toString('utf8')) as unknown);
    });
  });
}

describe('OneBotFastifyReverseWsServer', () => {
  test('接收合法 token 的反向 WebSocket 并回写动作', async () => {
    const server = new OneBotFastifyReverseWsServer({
      host: '127.0.0.1',
      port: 0,
      path: '/onebot/v11',
      accessToken: 'test-token',
    });

    try {
      await server.start();
      const port = server.getListeningPort();
      expect(port).toBeTypeOf('number');

      const socket = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11?access_token=test-token`);
      await waitForOpen(socket);

      const messagePromise = waitForMessage(socket);
      await server.sendAction({
        action: 'send_msg',
        params: { message_type: 'group', group_id: '123456', message: '你好' },
        echo: 'echo-1',
      });

      await expect(messagePromise).resolves.toMatchObject({
        action: 'send_msg',
        echo: 'echo-1',
      });
      socket.close();
    } finally {
      await server.stop();
    }
  });

  test('按echo等待OneBot动作响应并清理等待队列', async () => {
    const server = new OneBotFastifyReverseWsServer({
      host: '127.0.0.1',
      port: 0,
      path: '/onebot/v11',
      accessToken: 'test-token',
    });

    try {
      await server.start();
      const port = server.getListeningPort();
      expect(port).toBeTypeOf('number');

      const socket = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11?access_token=test-token`);
      await waitForOpen(socket);

      const actionPromise = waitForMessage(socket);
      const responsePromise = server.sendActionAndWait(
        {
          action: 'fetch_custom_face',
          echo: 'fetch-custom-face:1',
        },
        1000,
      );
      await expect(actionPromise).resolves.toMatchObject({
        action: 'fetch_custom_face',
        echo: 'fetch-custom-face:1',
      });
      socket.send(
        JSON.stringify({
          status: 'ok',
          retcode: 0,
          data: [{ file: 'custom-face://cat', md5: 'face-md5', summary: '猫猫震惊' }],
          echo: 'fetch-custom-face:1',
        }),
      );

      await expect(responsePromise).resolves.toMatchObject({
        status: 'ok',
        data: [{ file: 'custom-face://cat' }],
        echo: 'fetch-custom-face:1',
      });
      socket.close();
    } finally {
      await server.stop();
    }
  });
});
