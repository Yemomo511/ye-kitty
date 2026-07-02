import websocketPlugin from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import type { OneBotV11ActionRequest } from '../domain/onebot-v11';

export interface OneBotReverseWebSocketConfig {
  readonly host: string;
  readonly port: number;
  readonly path: string;
  readonly accessToken: string;
}

export type OneBotRawMessageHandler = (rawMessage: unknown) => Promise<void>;

export class OneBotFastifyReverseWsServer {
  private readonly fastify: FastifyInstance;
  private readonly sockets = new Set<WebSocket>();
  private rawMessageHandler?: OneBotRawMessageHandler;

  constructor(private readonly config: OneBotReverseWebSocketConfig) {
    this.fastify = Fastify({ logger: false });
  }

  registerRawMessageHandler(handler: OneBotRawMessageHandler): void {
    this.rawMessageHandler = handler;
  }

  async start(): Promise<void> {
    await this.fastify.register(websocketPlugin);

    this.fastify.get(
      this.config.path,
      {
        websocket: true,
        preValidation: async (request, reply) => {
          if (!this.isAuthorized(request)) {
            return reply.code(401).send('未授权的 OneBot 连接');
          }
        },
      },
      (socket) => {
        this.handleConnection(socket);
      },
    );

    await this.fastify.listen({
      host: this.config.host,
      port: this.config.port,
    });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.close(1001, '叶猫猫 QQ 实验通道关闭');
    }

    await this.fastify.close();
  }

  async sendAction(action: OneBotV11ActionRequest): Promise<void> {
    const activeSocket = [...this.sockets].find((socket) => socket.readyState === WebSocket.OPEN);
    if (!activeSocket) {
      throw new Error('没有可用的 OneBot 反向 WebSocket 连接');
    }

    activeSocket.send(JSON.stringify(action));
  }

  getListeningPort(): number | undefined {
    const address = this.fastify.server.address();
    if (typeof address === 'object' && address !== null) return address.port;
    return undefined;
  }

  private handleConnection(socket: WebSocket): void {
    this.sockets.add(socket);

    // OneBot 事件可能在连接建立后立刻到达，因此监听器必须同步注册。
    socket.on('message', (data) => {
      void this.handleRawSocketMessage(data, socket);
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
    });

    socket.on('error', () => {
      this.sockets.delete(socket);
    });
  }

  private async handleRawSocketMessage(data: WebSocket.RawData, socket: WebSocket): Promise<void> {
    if (!this.rawMessageHandler) return;

    try {
      const rawText = data.toString('utf8');
      const rawMessage = JSON.parse(rawText) as unknown;
      await this.rawMessageHandler(rawMessage);
    } catch {
      socket.close(1011, 'OneBot 消息处理失败');
    }
  }

  private isAuthorized(request: FastifyRequest): boolean {
    const token = this.extractAccessToken(request);
    return token === this.config.accessToken;
  }

  private extractAccessToken(request: FastifyRequest): string | undefined {
    const query = request.query as { readonly access_token?: string };
    const header = request.headers.authorization;
    if (query.access_token) return query.access_token;
    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
    return undefined;
  }
}
