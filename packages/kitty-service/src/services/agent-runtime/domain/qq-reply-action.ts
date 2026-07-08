/**
 * QQ回复动作
 *
 * Agent 只能声明这些安全动作，动作目标由当前消息上下文决定。
 */
export type QqReplyAction =
  | {
      /** 动作类型 */
      readonly type: 'send_text';
      /** 回复文本 */
      readonly text: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'send_msg';
      /** 同一条QQ消息内的OneBot安全消息段 */
      readonly message: readonly QqSendMsgSegment[];
    }
  | {
      /** 动作类型 */
      readonly type: 'send_text_with_face';
      /** 同一条QQ消息内的文本和内置表情段 */
      readonly segments: readonly QqTextWithFaceSegment[];
    }
  | {
      /** 动作类型 */
      readonly type: 'send_face';
      /** QQ内置表情ID */
      readonly faceId: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'send_custom_image';
      /** 图片文件或URL */
      readonly file: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'send_market_face';
      /** QQ商城表情包ID */
      readonly emojiPackageId: number;
      /** QQ商城表情ID */
      readonly emojiId: string;
      /** QQ商城表情key */
      readonly key: string;
      /** 表情摘要 */
      readonly summary: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'poke_sender';
    }
  | {
      /** 动作类型 */
      readonly type: 'react_to_message';
      /** 表情ID */
      readonly emojiId: string;
    };

/** QQ文本与内置表情混排段 */
export type QqTextWithFaceSegment =
  | {
      /** 消息段类型 */
      readonly type: 'text';
      /** 文本内容 */
      readonly text: string;
    }
  | {
      /** 消息段类型 */
      readonly type: 'face';
      /** QQ内置表情ID */
      readonly faceId: string;
    };

/** QQ统一发送消息段 */
export type QqSendMsgSegment =
  | {
      /** 消息段类型 */
      readonly type: 'text';
      /** 文本内容 */
      readonly text: string;
    }
  | {
      /** 消息段类型 */
      readonly type: 'at';
      /** 被@的QQ号 */
      readonly qq: string;
    }
  | {
      /** 消息段类型 */
      readonly type: 'face';
      /** QQ内置表情ID */
      readonly id: string;
    }
  | {
      /** 消息段类型 */
      readonly type: 'mface';
      /** QQ商城表情包ID */
      readonly emojiPackageId: number;
      /** QQ商城表情ID */
      readonly emojiId: string;
      /** QQ商城表情key */
      readonly key: string;
      /** 表情摘要 */
      readonly summary: string;
    }
  | {
      /** 消息段类型 */
      readonly type: 'image';
      /** 图片文件或自定义表情资源 */
      readonly file: string;
    };

/**
 * 解析QQ回复动作
 * @param input 模型输出动作
 * @returns 白名单动作
 */
export function parseQqReplyAction(input: unknown): QqReplyAction | undefined {
  if (!isRecord(input) || typeof input.type !== 'string') return undefined;

  if (input.type === 'send_text') {
    const text = normalizeText(input.text);
    return text ? { type: 'send_text', text } : undefined;
  }

  if (input.type === 'send_msg') {
    const message = normalizeSendMsgSegments(input);
    return message ? { type: 'send_msg', message } : undefined;
  }

  if (input.type === 'send_text_with_face') {
    const segments = normalizeTextWithFaceSegments(input.segments);
    return segments ? { type: 'send_text_with_face', segments } : undefined;
  }

  if (input.type === 'send_face') {
    const faceId = normalizeToken(input.faceId);
    return faceId ? { type: 'send_face', faceId } : undefined;
  }

  if (input.type === 'send_custom_image') {
    const file = normalizeResource(input.file);
    return file ? { type: 'send_custom_image', file } : undefined;
  }

  if (input.type === 'send_market_face') {
    const emojiPackageId = normalizePositiveInteger(input.emojiPackageId);
    const emojiId = normalizeToken(input.emojiId);
    const key = normalizeToken(input.key);
    const summary = normalizeText(input.summary);
    return emojiPackageId && emojiId && key && summary
      ? { type: 'send_market_face', emojiPackageId, emojiId, key, summary }
      : undefined;
  }

  if (input.type === 'poke_sender') {
    return { type: 'poke_sender' };
  }

  if (input.type === 'react_to_message') {
    const emojiId = normalizeToken(input.emojiId);
    return emojiId ? { type: 'react_to_message', emojiId } : undefined;
  }

  return undefined;
}

// 统一消息不允许模型指定平台目标字段，目标只能由当前QQ事件补齐。
function normalizeSendMsgSegments(
  input: Record<string, unknown>,
): readonly QqSendMsgSegment[] | undefined {
  if (hasForbiddenSendTarget(input)) return undefined;

  const message = input.message;
  if (!Array.isArray(message)) return undefined;

  const segments = message
    .map(normalizeSendMsgSegment)
    .filter((segment): segment is QqSendMsgSegment => Boolean(segment));
  return segments.length > 0 && segments.length === message.length ? segments : undefined;
}

// 判断模型是否试图越权指定发送目标。
function hasForbiddenSendTarget(input: Record<string, unknown>): boolean {
  return ['group_id', 'user_id', 'message_type', 'conversationExternalId', 'conversationType'].some(
    (key) => Object.prototype.hasOwnProperty.call(input, key),
  );
}

// 只接受本轮白名单消息段。
function normalizeSendMsgSegment(input: unknown): QqSendMsgSegment | undefined {
  if (!isRecord(input) || typeof input.type !== 'string' || !isRecord(input.data)) {
    return undefined;
  }

  if (input.type === 'text') {
    const text = normalizeText(input.data.text);
    return text ? { type: 'text', text } : undefined;
  }

  if (input.type === 'at') {
    const qq = normalizeToken(input.data.qq);
    return qq ? { type: 'at', qq } : undefined;
  }

  if (input.type === 'face') {
    const id = normalizeToken(input.data.id);
    return id ? { type: 'face', id } : undefined;
  }

  if (input.type === 'image') {
    const file = normalizeResource(input.data.file);
    return file ? { type: 'image', file } : undefined;
  }

  if (input.type === 'mface') {
    const emojiPackageId = normalizePositiveInteger(
      input.data.emoji_package_id ?? input.data.emojiPackageId,
    );
    const emojiId = normalizeToken(input.data.emoji_id ?? input.data.emojiId);
    const key = normalizeToken(input.data.key);
    const summary = normalizeText(input.data.summary);
    return emojiPackageId && emojiId && key && summary
      ? { type: 'mface', emojiPackageId, emojiId, key, summary }
      : undefined;
  }

  return undefined;
}

// 混排消息必须同时包含文本和QQ内置表情，避免替代普通文本或单独表情动作。
function normalizeTextWithFaceSegments(
  value: unknown,
): readonly QqTextWithFaceSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const segments = value
    .map(normalizeTextWithFaceSegment)
    .filter((segment): segment is QqTextWithFaceSegment => Boolean(segment));
  const hasText = segments.some((segment) => segment.type === 'text');
  const hasFace = segments.some((segment) => segment.type === 'face');

  return hasText && hasFace ? segments : undefined;
}

// 只接受文本和QQ内置表情两种段，其他平台段必须走独立白名单动作。
function normalizeTextWithFaceSegment(input: unknown): QqTextWithFaceSegment | undefined {
  if (!isRecord(input) || typeof input.type !== 'string') return undefined;

  if (input.type === 'text') {
    const text = normalizeText(input.text);
    return text ? { type: 'text', text } : undefined;
  }

  if (input.type === 'face') {
    const faceId = normalizeToken(input.faceId);
    return faceId ? { type: 'face', faceId } : undefined;
  }

  return undefined;
}

// 文本字段用于外发消息，拒绝空文本和控制字符。
function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || hasControlCharacter(text)) return undefined;
  return text;
}

// ID类字段只允许非空可读字符串。
function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || hasControlCharacter(text)) return undefined;
  return text;
}

// NapCat的商城表情包ID是数字，Agent 可以用字符串或数字表达。
function normalizePositiveInteger(value: unknown): number | undefined {
  const numberValue = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof numberValue !== 'number') return undefined;
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return undefined;
  return numberValue;
}

// 资源字段保留URL、文件名或NapCat资源标识，不在Agent层解释协议。
function normalizeResource(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || hasControlCharacter(text)) return undefined;
  return text;
}

// 控制字符容易破坏平台消息或日志展示。
function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

// 判断普通对象。
function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
