/** OneBot上报类型 */
export type OneBotV11PostType = 'message' | 'notice' | 'request' | 'meta_event';
/** OneBot消息会话类型 */
export type OneBotV11MessageType = 'private' | 'group';

/** OneBot文本消息段 */
export interface OneBotV11TextMessageSegment {
  /** 消息段类型 */
  readonly type: 'text';
  /** 文本段数据 */
  readonly data: {
    /** 文本内容 */
    readonly text: string;
  };
}

/** OneBot@消息段 */
export interface OneBotV11AtMessageSegment {
  /** 消息段类型 */
  readonly type: 'at';
  /** @段数据 */
  readonly data: {
    /** 被@的QQ号 */
    readonly qq: string;
  };
}

/** OneBot未知消息段 */
export interface OneBotV11UnknownMessageSegment {
  /** 消息段类型 */
  readonly type: string;
  /** 原始段数据 */
  readonly data?: Record<string, unknown>;
}

/** Ye-Kitty当前识别的消息段集合 */
export type OneBotV11MessageSegment =
  OneBotV11TextMessageSegment | OneBotV11AtMessageSegment | OneBotV11UnknownMessageSegment;

/** OneBot消息发送者信息 */
export interface OneBotV11GroupMessageSender {
  /** 发送者QQ号 */
  readonly user_id: number;
  /** QQ昵称 */
  readonly nickname?: string;
  /** 群名片 */
  readonly card?: string;
}

/** OneBot消息事件基类 */
export interface OneBotV11BaseMessageEvent {
  /** 事件秒级时间戳 */
  readonly time: number;
  /** 机器人QQ号 */
  readonly self_id: number;
  /** 上报类型 */
  readonly post_type: 'message';
  /** 消息会话类型 */
  readonly message_type: OneBotV11MessageType;
  /** OneBot子类型 */
  readonly sub_type?: string;
  /** 平台消息ID */
  readonly message_id: number | string;
  /** 发送者QQ号 */
  readonly user_id: number;
  /** 消息内容 */
  readonly message: string | readonly OneBotV11MessageSegment[];
  /** 原始文本 */
  readonly raw_message?: string;
  /** 发送者资料 */
  readonly sender: OneBotV11GroupMessageSender;
}

/** OneBot群聊消息事件 */
export interface OneBotV11GroupMessageEvent extends OneBotV11BaseMessageEvent {
  /** 消息会话类型 */
  readonly message_type: 'group';
  /** QQ群号 */
  readonly group_id: number;
}

/** OneBot好友消息事件 */
export interface OneBotV11PrivateMessageEvent extends OneBotV11BaseMessageEvent {
  /** 消息会话类型 */
  readonly message_type: 'private';
}

/** 当前实验通道支持的消息事件 */
export type OneBotV11SupportedMessageEvent =
  OneBotV11GroupMessageEvent | OneBotV11PrivateMessageEvent;

/** OneBot动作请求 */
export interface OneBotV11ActionRequest {
  /** 动作名称 */
  readonly action: string;
  /** 动作参数 */
  readonly params?: Record<string, unknown>;
  /** 请求回显ID */
  readonly echo?: string;
}

/** OneBot动作响应 */
export interface OneBotV11ActionResponse {
  /** 执行状态 */
  readonly status: 'ok' | 'failed';
  /** OneBot返回码 */
  readonly retcode: number;
  /** 响应数据 */
  readonly data?: unknown;
  /** 错误消息 */
  readonly message?: string;
  /** 用户提示 */
  readonly wording?: string;
  /** 请求回显ID */
  readonly echo?: string;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

// 判断事件是否为群聊消息
export function isOneBotV11GroupMessageEvent(input: unknown): input is OneBotV11GroupMessageEvent {
  if (!isOneBotV11BaseMessageEvent(input)) return false;
  if (input.message_type !== 'group') return false;
  return isRecord(input) && typeof input.group_id === 'number';
}

// 判断事件是否为好友消息
export function isOneBotV11PrivateMessageEvent(
  input: unknown,
): input is OneBotV11PrivateMessageEvent {
  if (!isOneBotV11BaseMessageEvent(input)) return false;
  return input.message_type === 'private';
}

// 过滤实验通道支持的消息
export function isOneBotV11SupportedMessageEvent(
  input: unknown,
): input is OneBotV11SupportedMessageEvent {
  return isOneBotV11GroupMessageEvent(input) || isOneBotV11PrivateMessageEvent(input);
}

// 校验消息事件共同字段
function isOneBotV11BaseMessageEvent(input: unknown): input is OneBotV11BaseMessageEvent {
  if (!isRecord(input)) return false;
  if (input.post_type !== 'message') return false;
  if (input.message_type !== 'group' && input.message_type !== 'private') return false;
  if (typeof input.time !== 'number') return false;
  if (typeof input.user_id !== 'number') return false;
  if (typeof input.sender !== 'object' || input.sender === null) return false;
  if (typeof input.message !== 'string' && !Array.isArray(input.message)) return false;
  return typeof input.message_id === 'number' || typeof input.message_id === 'string';
}
