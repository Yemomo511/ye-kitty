/**
 * QQ外部动作目标
 *
 * 只描述 Ye-Kitty 允许触达的会话范围，避免上层直接拼接 OneBot 字段。
 */
export interface QqActionTarget {
  /** 群号或好友号 */
  readonly conversationExternalId: string;
  /** 会话类型 */
  readonly conversationType: 'private' | 'group';
}

/** QQ文本消息段 */
export interface QqTextMessageSegment {
  /** 消息段类型 */
  readonly type: 'text';
  /** 文本内容 */
  readonly text: string;
}

/** QQ内置表情消息段 */
export interface QqFaceMessageSegment {
  /** 消息段类型 */
  readonly type: 'face';
  /** 表情ID */
  readonly id: string;
}

/** QQ@消息段 */
export interface QqAtMessageSegment {
  /** 消息段类型 */
  readonly type: 'at';
  /** 被@的QQ号 */
  readonly qq: string;
}

/** QQ引用消息段 */
export interface QqReplyMessageSegment {
  /** 消息段类型 */
  readonly type: 'reply';
  /** 被引用的QQ消息ID */
  readonly id: string;
}

/** QQ商城表情消息段 */
export interface QqMarketFaceMessageSegment {
  /** 消息段类型 */
  readonly type: 'mface';
  /** 表情包ID */
  readonly emojiPackageId: number;
  /** 表情ID */
  readonly emojiId: string;
  /** NapCat发送所需key */
  readonly key: string;
  /** 表情摘要 */
  readonly summary: string;
}

/** QQ图片或自定义表情消息段 */
export interface QqImageMessageSegment {
  /** 消息段类型 */
  readonly type: 'image';
  /** 图片文件、URL或NapCat可识别资源 */
  readonly file: string;
}

/** QQ自定义表情资源 */
export interface QqCustomFaceResource {
  /** 表情稳定ID */
  readonly id: string;
  /** NapCat可发送资源 */
  readonly file: string;
  /** 表情名称 */
  readonly name?: string;
  /** 平台摘要 */
  readonly summary?: string;
}

/** Ye-Kitty首版允许发送的QQ消息段 */
export type QqOutboundMessageSegment =
  | QqTextMessageSegment
  | QqAtMessageSegment
  | QqReplyMessageSegment
  | QqFaceMessageSegment
  | QqMarketFaceMessageSegment
  | QqImageMessageSegment;

/** 发送QQ消息输入 */
export interface QqSendMessageInput extends QqActionTarget {
  /** 消息段 */
  readonly segments: readonly QqOutboundMessageSegment[];
}

/** 发送QQ文本输入 */
export interface QqSendTextInput extends QqActionTarget {
  /** 消息文本 */
  readonly text: string;
}

/** 戳一戳输入 */
export interface QqPokeInput extends QqActionTarget {
  /** 被戳QQ号 */
  readonly userExternalId: string;
}

/** 消息表情回应输入 */
export interface QqReactToMessageInput {
  /** 平台消息ID */
  readonly messageExternalId: string;
  /** 表情ID */
  readonly emojiId: string;
}

/**
 * QQ外部动作API
 *
 * 这是 Agent Runtime 和 NapCat 之间的安全白名单边界。
 * 实现方只能暴露经过项目确认的动作，不能把任意 OneBot action 透传给上层。
 */
export interface QqExternalActionApi {
  /**
   * 发送消息段
   * @param input 发送目标和消息段
   */
  sendMessage(input: QqSendMessageInput): Promise<void>;

  /**
   * 发送文本消息
   * @param input 发送目标和文本
   */
  sendText(input: QqSendTextInput): Promise<void>;

  /**
   * 戳一戳用户
   * @param input 会话和用户目标
   */
  sendPoke(input: QqPokeInput): Promise<void>;

  /**
   * 对消息做表情回应
   * @param input 消息和表情目标
   */
  reactToMessage(input: QqReactToMessageInput): Promise<void>;

  /**
   * 读取QQ自定义表情
   * @returns 可发送表情资源
   */
  fetchCustomFaces(): Promise<readonly QqCustomFaceResource[]>;
}
