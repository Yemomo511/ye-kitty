import type { AgentObservation } from '../../domain/agent-observation';
import type { RuntimeTool } from '../../domain/tool';
import { buildBaseAgentPrompt } from './base-agent.prompt';
import { buildSkillPrompt } from './skill.prompt';

/**
 * Harness Prompt
 *
 * instructions 承载身份、循环协议和工具约束，input 承载本轮观察。
 */
export interface HarnessPrompt {
  /** 系统指令 */
  readonly instructions: string;
  /** 本轮观察 */
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
      buildSkillPrompt(observation.skills),
      buildToolPrompt(observation.tools),
    ]
      .filter(Boolean)
      .join('\n\n'),
    input: buildObservationPrompt(observation),
  };
}

// 构建Harness运行协议。
function buildHarnessRuntimePrompt(): string {
  return [
    '你运行在 Ye-Kitty Harness 循环中。',
    '你只能返回 JSON 决策，不要输出 Markdown、解释文字或代码块。',
    '你不能直接执行工具，只能请求 tool_call，由 Harness 执行后把结果作为新观察交给你。',
    '如果需要上下文，优先调用可见工具；如果信息足够，再输出 reply、ignore 或 human_review。',
    'JSON 决策格式只能是以下四类之一：',
    '{"type":"tool_call","toolName":"工具名","input":{},"reason":"调用原因"}',
    '{"type":"reply","text":"回复文本","actions":[],"reason":"回复原因"}',
    '{"type":"ignore","reason":"静默原因"}',
    '{"type":"human_review","reason":"需要人工审核的原因"}',
    'actions 仅允许 send_text、send_face、send_custom_image、poke_sender、react_to_message。',
  ].join('\n');
}

// 构建可见工具说明。
function buildToolPrompt(tools: readonly RuntimeTool[]): string {
  if (tools.length === 0) return '本轮没有可用工具。';

  return [
    '本轮可见工具：',
    ...tools.map((tool) =>
      [
        `## ${tool.name}`,
        `说明：${tool.description}`,
        `风险等级：${tool.riskLevel}`,
        `输入：${tool.inputSchemaDescription}`,
      ].join('\n'),
    ),
  ].join('\n\n');
}

// 构建本轮观察。
function buildObservationPrompt(observation: AgentObservation): string {
  const event = observation.event;
  return [
    `当前轮次：${observation.turnIndex}/${observation.maxTurns}`,
    `已调用工具次数：${observation.toolCallCount}/${observation.maxToolCalls}`,
    `平台：QQ`,
    `会话类型：${event.conversationType === 'group' ? '群聊' : '私聊'}`,
    `会话ID：${event.conversationId}`,
    `发送者QQ：${event.senderId}`,
    `发送者昵称：${event.senderDisplayName ?? '未知'}`,
    `用户消息文本：${event.message.text}`,
    `消息接收时间：${event.receivedAt.toISOString()}`,
    buildToolResultsPrompt(observation),
  ].join('\n');
}

// 构建工具结果观察。
function buildToolResultsPrompt(observation: AgentObservation): string {
  if (observation.toolResults.length === 0) return '工具观察结果：暂无。';

  return [
    '工具观察结果：',
    ...observation.toolResults.map((result, index) =>
      [
        `${index + 1}. 工具：${result.toolName}`,
        `成功：${result.success ? '是' : '否'}`,
        `观察：${result.observation}`,
      ].join('\n'),
    ),
  ].join('\n');
}
