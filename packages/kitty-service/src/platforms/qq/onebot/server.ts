import websocketPlugin from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { writeDebugLog } from '@kitty/shared/logging';
import type { OneBotV11ActionRequest, OneBotV11ActionResponse } from './schema';

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
/** OneBot连接处理器 */
export type OneBotConnectionHandler = () => Promise<void> | void;

interface PendingOneBotAction {
  /** 响应成功 */
  readonly resolve: (response: OneBotV11ActionResponse) => void;
  /** 响应失败 */
  readonly reject: (error: Error) => void;
  /** 超时清理 */
  readonly timeout: NodeJS.Timeout;
}

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
  // 正在等待echo响应的动作
  private readonly pendingActions = new Map<string, PendingOneBotAction>();
  // 上层通道注册的事件入口
  private rawMessageHandler?: OneBotRawMessageHandler;
  // NapCat连接建立后的上层回调
  private connectionHandler?: OneBotConnectionHandler;

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
   * 注册连接处理器
   * @param handler 连接处理器
   */
  registerConnectionHandler(handler: OneBotConnectionHandler): void {
    this.connectionHandler = handler;
  }

  /**
   * 启动WebSocket服务
   *
   * 注册 OneBot 路由并开始监听端口。
   * 连接必须携带正确 access_token，否则会在握手阶段拒绝。
   */
  async start(): Promise<void> {
    // 1. 注册 Fastify WebSocket 插件，让 HTTP 服务具备升级能力。
    await this.fastify.register(websocketPlugin);

    // 2. 暴露 OneBot 反向 WebSocket 路径，NapCat 会连接这里。
    this.fastify.get(
      this.config.path,
      {
        websocket: true,
        preValidation: async (request, reply) => {
          // 3. 握手前校验 access_token，拒绝未知客户端。
          if (!this.isAuthorized(request)) {
            console.warn(
              `⚠️ [OneBotReverseWs-auth] 拒绝未授权连接 path=${this.config.path} tokenSource=${getTokenSource(
                request,
              )}`,
            );
            return reply.code(401).send('未授权的 OneBot 连接');
          }
        },
      },
      (socket) => {
        // 4. 接管通过鉴权的 NapCat 连接，开始收发 OneBot 消息。
        this.handleConnection(socket);
      },
    );

    // 5. 监听端口后，NapCat Websocket客户端才能建立反向连接。
    await this.fastify.listen({
      host: this.config.host,
      port: this.config.port,
    });
    console.info(
      `✅ [OneBotReverseWs-start] WebSocket服务已监听 host=${this.config.host} port=${this.config.port} path=${this.config.path}`,
    );
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
    console.info(
      `✅ [OneBotReverseWs-stop] WebSocket服务已停止 activeConnections=${this.sockets.size}`,
    );
  }

  /**
   * 发送OneBot动作
   * @param action OneBot动作请求
   */
  async sendAction(action: OneBotV11ActionRequest): Promise<void> {
    const activeSocket = [...this.sockets].find((socket) => socket.readyState === WebSocket.OPEN);
    if (!activeSocket) {
      console.error(
        `❌ [OneBotReverseWs-sendAction] 没有可用连接，OneBot动作发送失败 action=${action.action}`,
      );
      throw new Error('没有可用的 OneBot 反向 WebSocket 连接');
    }

    activeSocket.send(JSON.stringify(action));
    writeDebugLog(
      `🔍 [OneBotReverseWs-sendAction] 已发送OneBot动作 action=${action.action} echo=${maskId(
        action.echo ?? '',
      )} activeConnections=${this.sockets.size}`,
    );
  }

  /**
   * 发送OneBot动作并等待echo响应
   * @param action OneBot动作请求
   * @param timeoutMs 超时毫秒
   * @returns OneBot动作响应
   */
  async sendActionAndWait(
    action: OneBotV11ActionRequest,
    timeoutMs: number,
  ): Promise<OneBotV11ActionResponse> {
    if (!action.echo) throw new Error('等待 OneBot 响应的动作必须包含 echo');
    if (this.pendingActions.has(action.echo)) {
      throw new Error(`OneBot echo 已存在，不能重复等待：${action.echo}`);
    }

    const responsePromise = new Promise<OneBotV11ActionResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingActions.delete(action.echo!);
        reject(new Error(`OneBot 动作响应超时 action=${action.action}`));
      }, timeoutMs);
      this.pendingActions.set(action.echo!, { resolve, reject, timeout });
    });

    try {
      await this.sendAction(action);
      return await responsePromise;
    } catch (error) {
      const pending = this.pendingActions.get(action.echo);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingActions.delete(action.echo);
      }
      throw error;
    }
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
    // 1. 记录当前连接，后续回复动作会从这里选择可用通道。
    this.sockets.add(socket);
    console.info(
      `✅ [OneBotReverseWs-connection] NapCat连接已建立 activeConnections=${this.sockets.size}`,
    );

    // 2. 同步注册消息监听，避免连接初期的 OneBot 事件丢失。
    socket.on('message', (data) => {
      void this.handleRawSocketMessage(data, socket);
    });

    // 3. 连接关闭时清理缓存，防止向失效 WebSocket 发送回复。
    socket.on('close', (code) => {
      this.sockets.delete(socket);
      console.info(
        `⏭️ [OneBotReverseWs-connection] NapCat连接已关闭 code=${code} activeConnections=${this.sockets.size}`,
      );
    });

    socket.on('error', (error) => {
      this.sockets.delete(socket);
      console.warn(
        `⚠️ [OneBotReverseWs-connection] NapCat连接异常已移除 activeConnections=${this.sockets.size} reason=${formatError(
          error,
        )}`,
      );
    });

    if (this.connectionHandler) {
      void Promise.resolve(this.connectionHandler()).catch((error) => {
        console.warn(
          `⚠️ [OneBotReverseWs-connection] 连接处理器执行失败，已继续保持连接 reason=${formatError(
            error,
          )}`,
        );
      });
    }
  }

  // 解析并转发 OneBot 原始事件
  private async handleRawSocketMessage(data: WebSocket.RawData, socket: WebSocket): Promise<void> {
    try {
      // 1. NapCat 发来的是 JSON 文本，先解析成 OneBot 原始事件。
      const rawText = data.toString('utf8');
      const rawMessage = JSON.parse(rawText) as unknown;

      // 2. 动作响应属于连接自身协议，必须先于可选的平台消息处理器消费。
      if (this.resolvePendingAction(rawMessage)) return;

      // 3. 没有注册平台消息入口时，仅忽略普通推送，不影响动作响应闭环。
      if (!this.rawMessageHandler) return;

      // 4. 交给 QQ 实验通道做白名单过滤、事件发布和回复编排。
      await this.rawMessageHandler(rawMessage);
    } catch (error) {
      // 5. 解析或处理失败时关闭连接，避免继续处理未知状态消息。
      console.error(
        `❌ [OneBotReverseWs-message] OneBot消息处理失败，连接将关闭 reason=${formatError(error)}`,
      );
      socket.close(1011, 'OneBot 消息处理失败');
    }
  }

  // 匹配 OneBot 动作响应。
  private resolvePendingAction(rawMessage: unknown): boolean {
    if (!isOneBotActionResponse(rawMessage)) return false;

    const pending = this.pendingActions.get(rawMessage.echo);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    this.pendingActions.delete(rawMessage.echo);
    pending.resolve(rawMessage);
    writeDebugLog(
      `🔍 [OneBotReverseWs-actionResponse] 已收到OneBot动作响应 echo=${maskId(
        rawMessage.echo,
      )} status=${rawMessage.status} retcode=${rawMessage.retcode}`,
    );
    return true;
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

// 标记令牌来源，不输出令牌本身。
function getTokenSource(request: FastifyRequest): string {
  const query = request.query as { readonly access_token?: string };
  if (query.access_token) return 'query';
  if (request.headers.authorization?.startsWith('Bearer ')) return 'bearer';
  return 'missing';
}

// 脱敏动作回执ID，仅保留尾部特征用于排障。
function maskId(value: string): string {
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

// 压缩错误内容，避免日志输出大对象或敏感上下文。
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// 判断 OneBot 动作响应。
function isOneBotActionResponse(
  input: unknown,
): input is OneBotV11ActionResponse & { readonly echo: string } {
  if (typeof input !== 'object' || input === null) return false;
  const record = input as Record<string, unknown>;
  if (record.status !== 'ok' && record.status !== 'failed') return false;
  if (typeof record.retcode !== 'number') return false;
  return typeof record.echo === 'string' && record.echo.length > 0;
}
