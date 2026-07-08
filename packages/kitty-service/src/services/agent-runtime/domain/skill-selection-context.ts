/**
 * Skill选择上下文
 *
 * 平台适配层把外部事件压缩为模型层可理解的运行信息，Skill 层不依赖具体平台事件类型。
 */
export interface SkillSelectionContext {
  /** 平台标识 */
  readonly platform: string;
  /** 会话类型 */
  readonly conversationType: string;
  /** 消息文本 */
  readonly messageText: string;
  /** 是否提及Agent */
  readonly mentionsAgent: boolean;
  /** 接收时间 */
  readonly receivedAt: Date;
}
