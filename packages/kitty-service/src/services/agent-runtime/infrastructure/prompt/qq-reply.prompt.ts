import type { ChatEventContract } from '@kitty/contracts/events/chat-event.contract';
import { buildQqReplyActionCatalogPrompt } from '../../domain/qq-reply-action';

/**
 * 构建QQ回复输入
 * @param event QQ标准消息
 * @returns 模型输入文本
 */
export function buildQqReplyPrompt(event: ChatEventContract): string {
  return [
    '请根据下面的 QQ 消息生成一条回复。',
    '你可以直接返回一段自然语言文本，也可以返回 JSON：{"text":"文字回复","actions":[...]}。',
    buildQqReplyActionCatalogPrompt(),
    '禁止输出 curl、HTTP 请求、群管理、删好友、退群、改资料、退出登录、原始包发送等危险能力。',
    '使用动作时保持克制，避免连续刷屏；没有把握时只返回自然语言文本。',
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
