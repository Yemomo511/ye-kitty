import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRunState } from '../state';
import type { ToolModelOutput } from '../tools';
import { buildSkillPrompt } from './skills';
import { buildBaseAgentPrompt } from './system';

const promptDirectory = dirname(fileURLToPath(import.meta.url));
const systemPromptPath = join(promptDirectory, 'system.md');

/**
 * 组装动态Agent系统指令
 *
 * 只投影模型完成任务需要的身份、Skill和行为边界。预算、审批、调用ID、
 * 结算记录和终态维护均保留在AgentRunState中。
 *
 * @param agentName Agent展示名称
 * @param state 单次运行系统状态
 * @returns 模型系统指令
 */
export function composeAgentInstructions(agentName: string, state: AgentRunState): string {
  return [
    buildBaseAgentPrompt(agentName),
    readFileSync(systemPromptPath, 'utf8').trim(),
    buildSkillPrompt({
      availableSkills: state.availableSkills,
      enabledSkills: state.enabledSkills,
      loadedReferences: state.loadedReferences,
    }),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * 组装单次运行初始输入
 * @param state 单次运行系统状态
 * @param recentMessages 前置最近消息观察
 * @returns 模型可见用户事件与必要观察
 */
export function composeAgentInput(state: AgentRunState, recentMessages: ToolModelOutput): string {
  const event = state.event;
  return [
    '<current_event>',
    `平台：${event.platform}`,
    `会话类型：${event.conversationType}`,
    `会话ID：${event.conversationId}`,
    `发送者ID：${event.senderId}`,
    `发送者昵称：${event.senderDisplayName ?? '未知'}`,
    `消息文本：${event.message.text}`,
    `提及对象：${event.message.mentions.length > 0 ? event.message.mentions.join('、') : '无'}`,
    `接收时间：${event.receivedAt.toISOString()}`,
    '</current_event>',
    renderReplyIntent(state),
    '<recent_messages_observation>',
    `状态：${recentMessages.status}`,
    `摘要：${recentMessages.summary}`,
    recentMessages.data === undefined ? '' : `结构化结果：${JSON.stringify(recentMessages.data)}`,
    '</recent_messages_observation>',
  ]
    .filter(Boolean)
    .join('\n');
}

// 回复意图是业务要求，模型可以感知；执行约束仍由finish工具校验。
function renderReplyIntent(state: AgentRunState): string {
  if (state.replyIntent === 'normal') {
    return '<reply_intent>根据上下文判断回复、忽略或请求人工复核。</reply_intent>';
  }
  return [
    '<reply_intent>',
    '本轮由群聊节奏门控触发，需要基于最近消息给出一条自然短回复。',
    '如果最近消息观察失败，请重新调用 get_recent_messages 后再结束。',
    '</reply_intent>',
  ].join('\n');
}
