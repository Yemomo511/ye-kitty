import type { PlatformMessage } from '@kitty/platforms/message';

/**
 * 构建QQ回复输入
 * @param event QQ标准消息
 * @returns 模型输入文本
 */
export function buildQqReplyPrompt(event: PlatformMessage): string {
  return [
    '请根据下面的 QQ 消息生成一条回复。',
    '你可以直接返回一段自然语言文本，也可以返回 JSON：{"text":"文字回复","actions":[...]}。',
    'actions 仅允许 send_msg、send_text、send_text_with_face、send_face、send_custom_image、send_market_face、poke_sender、react_to_message。',
    '普通 QQ 消息优先使用 send_msg；自定义表情必须先通过 get_custom_faces 读取启动期缓存目录，再根据工具返回的内容、情绪、适用场景和 file 自行选择 image 段。需要文字加自定义表情时，先用一条 send_msg 发送文字，再用另一条 send_msg 单独发送 image 段。',
    'send_text_with_face 用于把文字和 QQ 内置表情放在同一条消息里；send_market_face 用于 NapCat mface 商城表情，必须包含 emojiPackageId、emojiId、key、summary。',
    '不要把同一句话同时放进 text 和发送动作，避免 QQ 群聊重复回复。',
    '当使用 poke_sender 时，不要再输出 text 或其他发送动作。',
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
function formatConversationType(conversationType: PlatformMessage['conversationType']): string {
  return conversationType === 'group' ? '群聊' : '私聊';
}
