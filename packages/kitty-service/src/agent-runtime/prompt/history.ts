import type { AgentMessage } from '../message';

/**
 * 渲染Agent对话观察
 * @param messages 对话消息
 * @returns 模型输入片段
 */
export function renderConversationMessages(messages: readonly AgentMessage[]): string {
  return messages.map(renderConversationMessage).filter(Boolean).join('\n\n');
}

// 按消息类型渲染观察片段。
function renderConversationMessage(message: AgentMessage): string {
  if (message.type === 'user_event') {
    const event = message.event;
    return [
      '## 3.1 用户事件',
      `平台：${event.platform}`,
      `会话类型：${event.conversationType}`,
      `会话ID：${event.conversationId}`,
      `发送者ID：${event.senderId}`,
      `发送者昵称：${event.senderDisplayName ?? '未知'}`,
      `用户消息文本：${event.message.text}`,
      `提及QQ：${event.message.mentions.length > 0 ? event.message.mentions.join(', ') : '无'}`,
      `消息接收时间：${event.receivedAt.toISOString()}`,
    ].join('\n');
  }

  if (
    message.type === 'skill_catalog' ||
    message.type === 'skill_content' ||
    message.type === 'skill_reference'
  ) {
    return '';
  }

  if (message.type === 'tool_result') {
    return [
      '## 3.2 工具观察结果',
      `工具：${message.result.toolName}`,
      `成功：${message.result.success ? '是' : '否'}`,
      `观察：${message.result.observation}`,
    ].join('\n');
  }

  return [
    '## 3.3 决策错误观察',
    `观察：${message.observation}`,
    message.errorMessage ? `错误：${message.errorMessage}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
