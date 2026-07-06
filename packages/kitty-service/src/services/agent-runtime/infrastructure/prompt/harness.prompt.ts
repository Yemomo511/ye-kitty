import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentObservation } from '../../domain/agent-observation';
import type { RuntimeTool } from '../../domain/tool';
import { buildBaseAgentPrompt } from './base-agent.prompt';
import { buildAvailableSkillCatalogPrompt, buildEnabledSkillPrompt } from './skill.prompt';

const promptDirectory = dirname(fileURLToPath(import.meta.url));
const harnessRuntimePromptPath = join(promptDirectory, 'markdown', 'harness-runtime.prompt.md');

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
      buildAvailableSkillCatalogPrompt(observation.availableSkills),
      buildEnabledSkillPrompt(observation.enabledSkills),
      buildToolPrompt(observation.tools),
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
