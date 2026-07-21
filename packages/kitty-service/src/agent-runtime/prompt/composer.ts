import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentContext } from '../state';
import type { PromptHistoryItem, PromptState } from './state';
import { buildBaseAgentPrompt } from './system';
import { renderConversationMessages } from './history';
import { buildOutsideContextPrompt } from './context';

const promptDirectory = dirname(fileURLToPath(import.meta.url));
const systemPromptPath = join(promptDirectory, 'system.md');

/**
 * Agent Prompt
 *
 * instructions 承载身份、循环协议、Skill目录和工具目录，input 只承载本轮循环观察。
 */
export interface AgentPrompt {
  /** 第一章系统指令与第二章外界能力目录 */
  readonly instructions: string;
  /** 第三章本轮循环观察 */
  readonly input: string;
}

/**
 * 组装Agent Prompt
 * @param agentName Agent展示名称
 * @param observation 本轮观察
 * @returns 模型输入
 */
export function composeAgentPrompt(agentName: string, observation: AgentContext): AgentPrompt {
  return {
    instructions: [
      buildBaseAgentPrompt(agentName),
      buildSystemPrompt(),
      buildOutsideContextPrompt(observation.conversationMessages, observation.tools),
    ]
      .filter(Boolean)
      .join('\n\n'),
    input: buildObservationPrompt(observation),
  };
}

// 构建Agent运行协议。
function buildSystemPrompt(): string {
  return readMarkdownPrompt(systemPromptPath);
}

// 读取Markdown Prompt资产，让前置约束从代码字符串中解耦。
function readMarkdownPrompt(promptPath: string): string {
  return readFileSync(promptPath, 'utf8').trim();
}

// 构建本轮观察。
function buildObservationPrompt(observation: AgentContext): string {
  return [
    '# 第三章节: Runtime Observation',
    '本章节只承载本轮 Agent 循环思考所需的运行状态、外部观察和历史回灌。',
    renderPromptState(observation.promptState),
    renderReplyIntent(observation),
    `当前轮次：${observation.turnIndex}/${observation.maxTurns}`,
    `已调用工具次数：${observation.toolCallCount}/${observation.maxToolCalls}`,
    renderConversationMessages(observation.conversationMessages),
  ].join('\n\n');
}

// 渲染本轮回复意图，强制群聊回复时给模型明确行动边界。
function renderReplyIntent(observation: AgentContext): string {
  if (observation.replyIntent !== 'required_group_reply') {
    return [
      '<reply_intent>',
      'mode: normal',
      '说明：请按 Agent Action 协议判断是否回复、静默或转人工。',
      '</reply_intent>',
    ].join('\n');
  }

  return [
    '<reply_intent>',
    'mode: required_group_reply',
    '说明：本轮由群聊节奏门控触发，Agent 已在首轮决策前自动读取最近100条群消息；请直接基于该观察输出回复。',
    '禁止：不能返回 ignore；前置最近消息观察失败时，必须重新调用 get_recent_messages 成功后再 reply。',
    `required_tools: ${observation.requiredToolCalls?.join(', ') ?? 'get_recent_messages'}`,
    `recent_message_limit: ${observation.recentMessageLimitHint ?? 100}`,
    '</reply_intent>',
  ].join('\n');
}

// 渲染Agent显式状态快照。
function renderPromptState(state: PromptState): string {
  return [
    '<run_state>',
    `trace_id: ${state.traceId}`,
    `phase: ${state.phase}`,
    `turn: ${state.budget.turnIndex}/${state.budget.maxTurns}`,
    `tool_budget: ${state.budget.toolCallCount}/${state.budget.maxToolCalls}`,
    `skill_reference_budget: ${state.budget.skillReferenceCount}/${state.budget.maxSkillReferences}`,
    `decision_error_count: ${state.budget.decisionErrorCount}`,
    `available_skills: ${formatList(state.context.availableSkillNames)}`,
    `enabled_skills: ${formatList(state.context.enabledSkillNames)}`,
    `loaded_references: ${formatList(state.context.loadedReferenceKeys)}`,
    `visible_tools: ${formatList(state.context.visibleToolNames)}`,
    `latest_observation: ${state.context.latestObservation}`,
    '</run_state>',
    renderActionHistory(state.actionHistory),
  ]
    .filter(Boolean)
    .join('\n');
}

// 渲染模型可见的历史决策摘要。
function renderActionHistory(history: readonly PromptHistoryItem[]): string {
  if (history.length === 0) {
    return '<decision_history>\n暂无历史决策。\n</decision_history>';
  }

  return [
    '<decision_history>',
    ...history.map((item) =>
      [
        `- turn=${item.turnIndex}`,
        `type=${item.actionType}`,
        item.target ? `target=${item.target}` : '',
        typeof item.success === 'boolean' ? `success=${item.success ? 'true' : 'false'}` : '',
        `reason=${item.reason}`,
      ]
        .filter(Boolean)
        .join(' '),
    ),
    '</decision_history>',
  ].join('\n');
}

// 格式化状态列表。
function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : '无';
}
