import { writeDebugLog } from '@kitty/shared/logging';
import type { OneBotV11ActionRequest } from './schema';
import type { OneBotFastifyReverseWsServer } from './server';
import type {
  QqCustomFaceResource,
  QqExternalActionApi,
  QqOutboundMessageSegment,
  QqPokeInput,
  QqReactToMessageInput,
  QqSendMessageInput,
  QqSendTextInput,
} from '../action';

/** OneBot可发送消息段 */
type OneBotSendMessageSegment =
  | {
      readonly type: 'text';
      readonly data: { readonly text: string };
    }
  | {
      readonly type: 'at';
      readonly data: { readonly qq: string };
    }
  | {
      readonly type: 'reply';
      readonly data: { readonly id: string };
    }
  | {
      readonly type: 'face';
      readonly data: { readonly id: string };
    }
  | {
      readonly type: 'mface';
      readonly data: {
        readonly emoji_package_id: number;
        readonly emoji_id: string;
        readonly key: string;
        readonly summary: string;
      };
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
    const action = 'send_msg';
    const messageType = input.conversationType === 'group' ? 'group' : 'private';
    const targetField = input.conversationType === 'group' ? 'group_id' : 'user_id';

    await this.sendWhitelistedAction({
      action,
      params: {
        message_type: messageType,
        [targetField]: input.conversationExternalId,
        message: input.segments.map(toOneBotMessageSegment),
      },
      echo: this.createEcho(action),
    });
    writeDebugLog(
      `🔍 [OneBotWsExternalActionApi-sendMessage] 已通过统一send_msg投递QQ消息段 conversationType=${input.conversationType} segmentCount=${input.segments.length}`,
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

  /**
   * 读取QQ自定义表情
   * @returns 可发送自定义表情资源
   */
  async fetchCustomFaces(): Promise<readonly QqCustomFaceResource[]> {
    const action = 'fetch_custom_face';
    const response = await this.server.sendActionAndWait(
      {
        action,
        echo: this.createEcho(action),
      },
      30000,
    );
    if (response.status !== 'ok') {
      throw new Error(response.message ?? response.wording ?? 'fetch_custom_face 返回失败');
    }
    const faces = normalizeCustomFaces(response.data);
    console.info(
      `✅ [OneBotWsExternalActionApi-fetchCustomFaces] 已读取QQ自定义表情 count=${faces.length}`,
    );
    return faces;
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

  if (segment.type === 'at') {
    return { type: 'at', data: { qq: segment.qq } };
  }

  if (segment.type === 'reply') {
    return { type: 'reply', data: { id: segment.id } };
  }

  if (segment.type === 'face') {
    return { type: 'face', data: { id: segment.id } };
  }

  if (segment.type === 'mface') {
    return {
      type: 'mface',
      data: {
        emoji_package_id: segment.emojiPackageId,
        emoji_id: segment.emojiId,
        key: segment.key,
        summary: segment.summary,
      },
    };
  }

  return { type: 'image', data: { file: segment.file } };
}

// 兼容 NapCat 对自定义表情字段命名的差异。
function normalizeCustomFaces(data: unknown): readonly QqCustomFaceResource[] {
  const rawFaces = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.data)
      ? data.data
      : [];
  const faces: QqCustomFaceResource[] = [];
  const seenFiles = new Set<string>();

  for (const rawFace of rawFaces) {
    const face = normalizeCustomFace(rawFace);
    if (!face) continue;
    if (seenFiles.has(face.file)) continue;

    seenFiles.add(face.file);
    faces.push(face);
  }

  return faces;
}

// 提取单个可发送表情。
function normalizeCustomFace(input: unknown): QqCustomFaceResource | undefined {
  if (typeof input === 'string') {
    const file = input.trim();
    if (!file) return undefined;

    return {
      id: extractCustomFaceIdFromFile(file) ?? file,
      file,
      name: undefined,
      summary: undefined,
    };
  }

  if (!isRecord(input)) return undefined;

  const file = readFirstString(input, ['file', 'url', 'path']);
  if (!file) {
    writeDebugLog('⏭️ [OneBotWsExternalActionApi-fetchCustomFaces] 跳过缺少file的自定义表情');
    return undefined;
  }

  const id = readFirstString(input, ['id', 'md5', 'file_id']) ?? file;
  return {
    id: extractCustomFaceIdFromFile(id) ?? id,
    file,
    name: readFirstString(input, ['name']),
    summary: readFirstString(input, ['summary']),
  };
}

// QQ表情URL通常携带32位哈希，优先用它作为缓存和展示ID。
function extractCustomFaceIdFromFile(file: string): string | undefined {
  return file.match(/[A-Fa-f0-9]{32}/)?.[0]?.toUpperCase();
}

// 从候选字段中读取第一个非空字符串。
function readFirstString(
  input: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return undefined;
}

// 判断普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

// 脱敏外部ID，仅保留排障所需尾部特征。
function maskId(value: string): string {
  const text = String(value);
  if (text.length <= 4) return '****';
  return `****${text.slice(-4)}`;
}
