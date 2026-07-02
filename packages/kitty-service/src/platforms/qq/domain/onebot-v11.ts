export type OneBotV11PostType = 'message' | 'notice' | 'request' | 'meta_event';
export type OneBotV11MessageType = 'private' | 'group';

export interface OneBotV11TextMessageSegment {
  readonly type: 'text';
  readonly data: {
    readonly text: string;
  };
}

export interface OneBotV11AtMessageSegment {
  readonly type: 'at';
  readonly data: {
    readonly qq: string;
  };
}

export interface OneBotV11UnknownMessageSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export type OneBotV11MessageSegment =
  | OneBotV11TextMessageSegment
  | OneBotV11AtMessageSegment
  | OneBotV11UnknownMessageSegment;

export interface OneBotV11GroupMessageSender {
  readonly user_id: number;
  readonly nickname?: string;
  readonly card?: string;
}

export interface OneBotV11GroupMessageEvent {
  readonly time: number;
  readonly self_id: number;
  readonly post_type: 'message';
  readonly message_type: 'group';
  readonly sub_type?: string;
  readonly message_id: number | string;
  readonly group_id: number;
  readonly user_id: number;
  readonly message: string | readonly OneBotV11MessageSegment[];
  readonly raw_message?: string;
  readonly sender: OneBotV11GroupMessageSender;
}

export interface OneBotV11ActionRequest {
  readonly action: string;
  readonly params?: Record<string, unknown>;
  readonly echo?: string;
}

export interface OneBotV11ActionResponse {
  readonly status: 'ok' | 'failed';
  readonly retcode: number;
  readonly data?: unknown;
  readonly message?: string;
  readonly wording?: string;
  readonly echo?: string;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

export function isOneBotV11GroupMessageEvent(input: unknown): input is OneBotV11GroupMessageEvent {
  if (!isRecord(input)) return false;
  if (input.post_type !== 'message') return false;
  if (input.message_type !== 'group') return false;
  if (typeof input.time !== 'number') return false;
  if (typeof input.group_id !== 'number') return false;
  if (typeof input.user_id !== 'number') return false;
  if (typeof input.sender !== 'object' || input.sender === null) return false;
  if (typeof input.message !== 'string' && !Array.isArray(input.message)) return false;
  return typeof input.message_id === 'number' || typeof input.message_id === 'string';
}
