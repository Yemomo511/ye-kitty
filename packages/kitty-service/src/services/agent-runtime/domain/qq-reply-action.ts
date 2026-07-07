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
      readonly type: 'send_face';
      /** QQ商城表情ID */
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
