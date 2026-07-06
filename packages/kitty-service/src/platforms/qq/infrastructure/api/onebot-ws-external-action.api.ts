import { writeDebugLog } from '@kitty/shared/infrastructure/logging';
import type { OneBotV11ActionRequest } from '../../domain/onebot-v11';
import type { OneBotFastifyReverseWsServer } from '../onebot-fastify-reverse-ws.server';
import type {
  QqExternalActionApi,
  QqOutboundMessageSegment,
  QqPokeInput,
  QqReactToMessageInput,
  QqSendMessageInput,
  QqSendTextInput,
} from './qq-external-action.api';

/** OneBot可发送消息段 */
type OneBotSendMessageSegment =
  | {
      readonly type: 'text';
      readonly data: { readonly text: string };
    }
  | {
      readonly type: 'face';
      readonly data: { readonly id: string };
    }
  | {
      readonly type: 'image';
      readonly data: { readonly file: string };
    };

/**
 * OneBot WebSocket外部动作API
 *
 * 将 Ye-Kitty 允许的 QQ 动作转换为 NapCat OneBot 请求。
 * 该类是安全边界：新增 NapCat 能力前必须先在这里显式加入白名单映射。
 */
export class OneBotWsExternalActionApi implements QqExternalActionApi {
  // 用于关联 OneBot 动作响应
  private nextEchoId = 0;

  constructor(private readonly server: OneBotFastifyReverseWsServer) {}

  /**
   * 发送QQ消息段
   * @param input 发送目标和消息段
   */
  async sendMessage(input: QqSendMessageInput): Promise<void> {
    const action = input.conversationType === 'group' ? 'send_group_msg' : 'send_private_msg';
    const targetField = input.conversationType === 'group' ? 'group_id' : 'user_id';

    await this.sendWhitelistedAction({
      action,
      params: {
        [targetField]: input.conversationExternalId,
        message: input.segments.map(toOneBotMessageSegment),
      },
      echo: this.createEcho(action),
    });
    writeDebugLog(
      `🔍 [OneBotWsExternalActionApi-sendMessage] 已投递QQ消息段 action=${action} conversationType=${input.conversationType} segmentCount=${input.segments.length}`,
    );
  }

  /**
   * 发送QQ文本消息
   * @param input 发送目标和文本
   */
  async sendText(input: QqSendTextInput): Promise<void> {
    await this.sendMessage({
      conversationExternalId: input.conversationExternalId,
      conversationType: input.conversationType,
      segments: [{ type: 'text', text: input.text }],
    });
  }

  /**
   * 发送QQ戳一戳
   * @param input 会话和用户目标
   */
  async sendPoke(input: QqPokeInput): Promise<void> {
    const action = input.conversationType === 'group' ? 'group_poke' : 'friend_poke';
    const params =
      input.conversationType === 'group'
        ? {
            group_id: input.conversationExternalId,
            user_id: input.userExternalId,
          }
        : {
            user_id: input.userExternalId,
          };

    await this.sendWhitelistedAction({
      action,
      params,
      echo: this.createEcho(action),
    });
    writeDebugLog(
      `🔍 [OneBotWsExternalActionApi-sendPoke] 已投递QQ戳一戳 action=${action} conversationType=${input.conversationType} userId=${maskId(
        input.userExternalId,
      )}`,
    );
  }

  /**
   * 对QQ消息做表情回应
   * @param input 消息和表情目标
   */
  async reactToMessage(input: QqReactToMessageInput): Promise<void> {
    const action = 'set_msg_emoji_like';

    await this.sendWhitelistedAction({
      action,
      params: {
        message_id: input.messageExternalId,
        emoji_id: input.emojiId,
      },
      echo: this.createEcho(action),
    });
    writeDebugLog(
      `🔍 [OneBotWsExternalActionApi-reactToMessage] 已投递QQ消息表情回应 messageId=${maskId(
        input.messageExternalId,
      )} emojiId=${input.emojiId}`,
    );
  }

  // 所有 NapCat 调用必须经过该入口，避免绕过白名单审查。
  private async sendWhitelistedAction(action: OneBotV11ActionRequest): Promise<void> {
    await this.server.sendAction(action);
  }

  // 生成动作回显ID，便于 NapCat 响应回溯。
  private createEcho(action: string): string {
    return `${action}:${Date.now()}:${this.nextEchoId++}`;
  }
}

// 转换为 OneBot 标准消息段。
function toOneBotMessageSegment(segment: QqOutboundMessageSegment): OneBotSendMessageSegment {
  if (segment.type === 'text') {
    return { type: 'text', data: { text: segment.text } };
  }

  if (segment.type === 'face') {
    return { type: 'face', data: { id: segment.id } };
  }

  return { type: 'image', data: { file: segment.file } };
}

// 脱敏外部ID，仅保留排障所需尾部特征。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}
