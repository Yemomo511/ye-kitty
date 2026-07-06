/**
 * QQ回复动作
 *
 * Agent 只能声明这些低风险动作，动作目标由当前消息上下文决定。
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
      readonly type: 'poke_sender';
    }
  | {
      /** 动作类型 */
      readonly type: 'react_to_message';
      /** 表情ID */
      readonly emojiId: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'reply_to_message';
      /** 引用回复文本 */
      readonly text: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'mention_sender';
      /** @发送者后的文本 */
      readonly text: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'send_text_with_face';
      /** 回复文本 */
      readonly text: string;
      /** QQ商城表情ID */
      readonly faceId: string;
    }
  | {
      /** 动作类型 */
      readonly type: 'send_text_with_image';
      /** 回复文本 */
      readonly text: string;
      /** 图片文件或URL */
      readonly file: string;
    };

/** QQ动作适用会话 */
export type QqReplyActionConversationScope = 'all' | 'group';

/** QQ动作目录项 */
export interface QqReplyActionCatalogItem {
  /** 动作类型 */
  readonly type: QqReplyAction['type'];
  /** 动作说明 */
  readonly description: string;
  /** JSON字段说明 */
  readonly fields: readonly string[];
  /** 风险等级 */
  readonly riskLevel: 'low';
  /** 适用会话 */
  readonly conversationScope: QqReplyActionConversationScope;
}

/** 低风险QQ动作白名单 */
export const QQ_REPLY_ACTION_CATALOG: readonly QqReplyActionCatalogItem[] = [
  {
    type: 'send_text',
    description: '发送一条文本消息。',
    fields: ['text: 非空文本'],
    riskLevel: 'low',
    conversationScope: 'all',
  },
  {
    type: 'send_face',
    description: '发送一个 QQ 商城表情。',
    fields: ['faceId: 非空表情ID'],
    riskLevel: 'low',
    conversationScope: 'all',
  },
  {
    type: 'send_custom_image',
    description: '发送一张图片或自定义表情。',
    fields: ['file: 非空图片URL、文件或 NapCat 可识别资源'],
    riskLevel: 'low',
    conversationScope: 'all',
  },
  {
    type: 'poke_sender',
    description: '戳一戳当前消息发送者。',
    fields: [],
    riskLevel: 'low',
    conversationScope: 'all',
  },
  {
    type: 'react_to_message',
    description: '给当前收到的消息添加表情回应。',
    fields: ['emojiId: 非空表情ID'],
    riskLevel: 'low',
    conversationScope: 'all',
  },
  {
    type: 'reply_to_message',
    description: '引用当前收到的消息并发送文本。',
    fields: ['text: 非空文本'],
    riskLevel: 'low',
    conversationScope: 'all',
  },
  {
    type: 'mention_sender',
    description: '在群聊中 @ 当前发送者并发送文本，私聊会降级为普通文本。',
    fields: ['text: 非空文本'],
    riskLevel: 'low',
    conversationScope: 'group',
  },
  {
    type: 'send_text_with_face',
    description: '在一条消息中发送文本并追加 QQ 商城表情。',
    fields: ['text: 非空文本', 'faceId: 非空表情ID'],
    riskLevel: 'low',
    conversationScope: 'all',
  },
  {
    type: 'send_text_with_image',
    description: '在一条消息中发送文本并追加图片。',
    fields: ['text: 非空文本', 'file: 非空图片URL、文件或 NapCat 可识别资源'],
    riskLevel: 'low',
    conversationScope: 'all',
  },
];

/**
 * 构建QQ动作目录Prompt
 * @returns Prompt片段
 */
export function buildQqReplyActionCatalogPrompt(): string {
  return [
    '可用低风险 QQ 动作目录：',
    ...QQ_REPLY_ACTION_CATALOG.map((action) =>
      [
        `- ${action.type}`,
        `  说明：${action.description}`,
        `  字段：${action.fields.length > 0 ? action.fields.join('；') : '无'}`,
        `  会话：${action.conversationScope === 'group' ? '仅群聊优先，私聊需降级' : '群聊和私聊'}`,
      ].join('\n'),
    ),
  ].join('\n');
}

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

  if (input.type === 'poke_sender') {
    return { type: 'poke_sender' };
  }

  if (input.type === 'react_to_message') {
    const emojiId = normalizeToken(input.emojiId);
    return emojiId ? { type: 'react_to_message', emojiId } : undefined;
  }

  if (input.type === 'reply_to_message') {
    const text = normalizeText(input.text);
    return text ? { type: 'reply_to_message', text } : undefined;
  }

  if (input.type === 'mention_sender') {
    const text = normalizeText(input.text);
    return text ? { type: 'mention_sender', text } : undefined;
  }

  if (input.type === 'send_text_with_face') {
    const text = normalizeText(input.text);
    const faceId = normalizeToken(input.faceId);
    return text && faceId ? { type: 'send_text_with_face', text, faceId } : undefined;
  }

  if (input.type === 'send_text_with_image') {
    const text = normalizeText(input.text);
    const file = normalizeResource(input.file);
    return text && file ? { type: 'send_text_with_image', text, file } : undefined;
  }

  return undefined;
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || hasControlCharacter(text)) return undefined;
  return text;
}

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || hasControlCharacter(text)) return undefined;
  return text;
}

function normalizeResource(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || hasControlCharacter(text)) return undefined;
  return text;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}
