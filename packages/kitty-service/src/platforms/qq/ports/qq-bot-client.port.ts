/**
 * QQ消息发送能力
 *
 * 抽象 QQ 平台的文本投递行为。实现方需要将统一会话信息
 * 转换为具体平台动作，例如 OneBot 的群聊或私聊发送接口。
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
}
