import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SkillMetadata } from '../domain/skill';
import type { SkillSelectorPort } from '../ports/skill-selector.port';

/** 默认QQ回复Skill名称 */
export const DEFAULT_QQ_REPLY_SKILL_NAME = 'qq-chat';

/**
 * QQ回复Skill选择器
 *
 * 第一版固定选择 qq-chat，后续再根据 triggers、platforms 或 scenes 扩展。
 */
export class QqReplySkillSelector implements SkillSelectorPort<ChatEventContract> {
  constructor(private readonly defaultSkillName = DEFAULT_QQ_REPLY_SKILL_NAME) {}

  /**
   * 选择QQ回复Skill
   * @param _input QQ标准消息
   * @param skills 已加载元信息
   * @returns 默认Skill或空列表
   */
  async selectSkills(
    _input: ChatEventContract,
    skills: readonly SkillMetadata[],
  ): Promise<SkillMetadata[]> {
    const skill = skills.find((item) => item.name === this.defaultSkillName);
    return skill ? [skill] : [];
  }
}
