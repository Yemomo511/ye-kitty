import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';

/**
 * 构建QQ回复输入
 * @param event QQ标准消息
 * @returns 模型输入文本
 */
export function buildQqReplyPrompt(event: ChatEventContract): string {
  return [
    '请根据下面的 QQ 消息生成一条回复。',
    `平台：QQ`,
    `会话类型：${formatConversationType(event.conversationType)}`,
    `会话ID：${event.conversationId}`,
    `发送者QQ：${event.senderId}`,
    `发送者昵称：${event.senderDisplayName ?? '未知'}`,
    `用户消息文本：${event.message.text}`,
    `消息接收时间：${event.receivedAt.toISOString()}`,
  ].join('\n');
}

// 转换成提示词中的中文会话类型。
function formatConversationType(conversationType: ChatEventContract['conversationType']): string {
  return conversationType === 'group' ? '群聊' : '私聊';
}
