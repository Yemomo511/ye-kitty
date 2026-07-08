import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentObservation } from '../../domain/agent-observation';
import type {
  HarnessPromptDecisionHistoryItem,
  HarnessPromptState,
} from '../../domain/harness-prompt-state';
import { buildBaseAgentPrompt } from './base-agent.prompt';
import { renderConversationMessages } from './conversation-renderer';
import { buildOutsideContextPrompt } from './outside-context-prompt';

const promptDirectory = dirname(fileURLToPath(import.meta.url));
const harnessRuntimePromptPath = join(
  promptDirectory,
  'markdown',
  'System',
  'harness-runtime.prompt.md',
);

/**
 * Harness Prompt
 *
 * instructions 承载身份、循环协议、Skill目录和工具目录，input 只承载本轮循环观察。
 */
export interface HarnessPrompt {
  /** 第一章系统指令与第二章外界能力目录 */
  readonly instructions: string;
  /** 第三章本轮循环观察 */
  readonly input: string;
}

/**
 * 组装Harness Prompt
 * @param agentName Agent展示名称
 * @param observation 本轮观察
 * @returns 模型输入
 */
export function composeHarnessPrompt(
  agentName: string,
  observation: AgentObservation,
): HarnessPrompt {
  return {
    instructions: [
      buildBaseAgentPrompt(agentName),
      buildHarnessRuntimePrompt(),
      buildOutsideContextPrompt(observation.conversationMessages, observation.tools),
    ]
      .filter(Boolean)
      .join('\n\n'),
    input: buildObservationPrompt(observation),
  };
}

// 构建Harness运行协议。
function buildHarnessRuntimePrompt(): string {
  return readMarkdownPrompt(harnessRuntimePromptPath);
}

// 读取Markdown Prompt资产，让前置约束从代码字符串中解耦。
function readMarkdownPrompt(promptPath: string): string {
  return readFileSync(promptPath, 'utf8').trim();
}

// 构建本轮观察。
function buildObservationPrompt(observation: AgentObservation): string {
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
function renderReplyIntent(observation: AgentObservation): string {
  if (observation.replyIntent !== 'required_group_reply') {
    return [
      '<reply_intent>',
      'mode: normal',
      '说明：请按常规 Harness 协议判断是否回复、静默或转人工。',
      '</reply_intent>',
    ].join('\n');
  }

  return [
    '<reply_intent>',
    'mode: required_group_reply',
    '说明：本轮由群聊节奏门控触发，必须先调用 get_recent_messages 读取最近100条群消息，再基于群聊上下文输出 reply。',
    '禁止：不能返回 ignore；不能在未读取 get_recent_messages 前直接 reply。',
    `required_tools: ${observation.requiredToolCalls?.join(', ') ?? 'get_recent_messages'}`,
    `recent_message_limit: ${observation.recentMessageLimitHint ?? 100}`,
    '</reply_intent>',
  ].join('\n');
}

// 渲染Harness显式状态快照。
function renderPromptState(state: HarnessPromptState): string {
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
    renderDecisionHistory(state.decisionHistory),
  ]
    .filter(Boolean)
    .join('\n');
}

// 渲染模型可见的历史决策摘要。
function renderDecisionHistory(history: readonly HarnessPromptDecisionHistoryItem[]): string {
  if (history.length === 0) {
    return '<decision_history>\n暂无历史决策。\n</decision_history>';
  }

  return [
    '<decision_history>',
    ...history.map((item) =>
      [
        `- turn=${item.turnIndex}`,
        `type=${item.decisionType}`,
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
