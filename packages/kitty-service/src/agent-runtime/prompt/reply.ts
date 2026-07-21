import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import type { SkillContent } from '../skills';
import { buildBaseAgentPrompt } from './system';
import { buildQqReplyPrompt } from './turn';
import { buildEnabledSkillPrompt } from './skills';

/**
 * QQ回复Prompt
 *
 * instructions 面向 Agent 身份和能力约束，input 面向单次消息上下文。
 */
export interface QqReplyPrompt {
  /** Agent系统指令 */
  readonly instructions: string;
  /** 单次模型输入 */
  readonly input: string;
}

/**
 * 组装QQ回复Prompt
 * @param input Prompt上下文
 * @returns OpenAI Agent输入
 */
export function composeQqReplyPrompt(input: {
  readonly agentName: string;
  readonly event: ChatEventContract;
  readonly skills?: readonly SkillContent[];
}): QqReplyPrompt {
  const skillPrompt = buildEnabledSkillPrompt(input.skills ?? []);

  return {
    instructions: [buildBaseAgentPrompt(input.agentName), skillPrompt].filter(Boolean).join('\n\n'),
    input: buildQqReplyPrompt(input.event),
  };
}
