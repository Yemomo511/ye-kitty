import websocketPlugin from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import type { OneBotV11ActionRequest } from '../domain/onebot-v11';

/**
 * OneBot反向WebSocket配置
 *
 * 控制 Ye-Kitty 暴露给 NapCat 连接的监听地址、路径和鉴权令牌。
 */
export interface OneBotReverseWebSocketConfig {
  /** 监听地址 */
  readonly host: string;
  /** 监听端口 */
  readonly port: number;
  /** WebSocket路径 */
  readonly path: string;
  /** 共享鉴权令牌 */
  readonly accessToken: string;
}

/** OneBot原始消息处理器 */
export type OneBotRawMessageHandler = (rawMessage: unknown) => Promise<void>;

/**
 * OneBot反向WebSocket服务
 *
 * 基于 Fastify 暴露原生 WebSocket 入口，供 NapCat 主动连接。
 * 持有当前连接集合，负责握手鉴权、原始事件转发和动作回写。
 */
export class OneBotFastifyReverseWsServer {
  private readonly fastify: FastifyInstance;
  // 当前可回写动作的 NapCat 连接
  private readonly sockets = new Set<WebSocket>();
  // 上层通道注册的事件入口
  private rawMessageHandler?: OneBotRawMessageHandler;

  constructor(private readonly config: OneBotReverseWebSocketConfig) {
    this.fastify = Fastify({ logger: false });
  }

  /**
   * 注册原始消息处理器
   * @param handler 消息处理器
   */
  registerRawMessageHandler(handler: OneBotRawMessageHandler): void {
    this.rawMessageHandler = handler;
  }

  /**
   * 启动WebSocket服务
   *
   * 注册 OneBot 路由并开始监听端口。
   * 连接必须携带正确 access_token，否则会在握手阶段拒绝。
   */
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

    // 监听端口后，NapCat Websocket客户端才能建立反向连接。
    await this.fastify.listen({
      host: this.config.host,
      port: this.config.port,
    });
  }

  /**
   * 停止WebSocket服务
   *
   * 先关闭所有 NapCat 连接，再关闭 Fastify 服务。
   */
  async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.close(1001, '叶猫猫 QQ 实验通道关闭');
    }

    await this.fastify.close();
  }

  /**
   * 发送OneBot动作
   * @param action OneBot动作请求
   */
  async sendAction(action: OneBotV11ActionRequest): Promise<void> {
    const activeSocket = [...this.sockets].find((socket) => socket.readyState === WebSocket.OPEN);
    if (!activeSocket) {
      throw new Error('没有可用的 OneBot 反向 WebSocket 连接');
    }

    activeSocket.send(JSON.stringify(action));
  }

  /**
   * 获取监听端口
   * @returns 实际端口
   */
  getListeningPort(): number | undefined {
    const address = this.fastify.server.address();
    if (typeof address === 'object' && address !== null) return address.port;
    return undefined;
  }

  // 接管新的 NapCat 连接
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

  // 解析并转发 OneBot 原始事件
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

  // 校验 NapCat 连接令牌
  private isAuthorized(request: FastifyRequest): boolean {
    const token = this.extractAccessToken(request);
    return token === this.config.accessToken;
  }

  // 支持 query 和 Bearer 两种令牌来源
  private extractAccessToken(request: FastifyRequest): string | undefined {
    const query = request.query as { readonly access_token?: string };
    const header = request.headers.authorization;
    if (query.access_token) return query.access_token;
    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
    return undefined;
  }
}
