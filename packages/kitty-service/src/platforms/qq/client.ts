import type {
  QqCustomFaceResource,
  QqOutboundMessageSegment,
  QqReactToMessageInput,
} from './action';

/**
 * QQ消息发送能力
 *
 * 抽象 QQ 平台允许上层使用的受控动作。
 * 实现方需要将统一会话信息转换为具体平台动作，
 * 但不能把任意 NapCat 接口直接暴露给 Agent Runtime。
 */
export interface QqBotClientPort {
  /**
   * 发送文本消息
   * @param input 发送目标和文本
   */
  sendTextMessage(input: {
    /** 群号或好友号 */
    readonly conversationExternalId: string;
    /** 发送会话类型 */
    readonly conversationType: 'private' | 'group';
    /** 消息文本 */
    readonly text: string;
  }): Promise<void>;

  /**
   * 发送消息段
   * @param input 发送目标和消息段
   */
  sendMessageSegments(input: {
    /** 群号或好友号 */
    readonly conversationExternalId: string;
    /** 发送会话类型 */
    readonly conversationType: 'private' | 'group';
    /** 消息段 */
    readonly segments: readonly QqOutboundMessageSegment[];
  }): Promise<void>;

  /**
   * 戳一戳用户
   * @param input 会话和用户目标
   */
  sendPoke(input: {
    /** 群号或好友号 */
    readonly conversationExternalId: string;
    /** 发送会话类型 */
    readonly conversationType: 'private' | 'group';
    /** 被戳QQ号 */
    readonly userExternalId: string;
  }): Promise<void>;

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
