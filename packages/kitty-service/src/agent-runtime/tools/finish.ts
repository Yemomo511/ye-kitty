import { parseQqReplyAction, type QqReplyAction } from '../../platforms/qq/reply-action';
import type { AgentRunState } from '../state';
import { z } from 'zod';
import { Tool, type Tool as CanonicalTool, type ToolExecutionOutput } from './tool';

const sendMessageSegmentSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('text'), data: z.object({ text: z.string().min(1) }).strict() })
    .strict(),
  z.object({ type: z.literal('at'), data: z.object({ qq: z.string().min(1) }).strict() }).strict(),
  z
    .object({ type: z.literal('face'), data: z.object({ id: z.string().min(1) }).strict() })
    .strict(),
  z
    .object({
      type: z.literal('image'),
      data: z.object({ file: z.string().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('mface'),
      data: z
        .object({
          emoji_package_id: z.number().int().positive(),
          emoji_id: z.string().min(1),
          key: z.string().min(1),
          summary: z.string().min(1),
        })
        .strict(),
    })
    .strict(),
]);

const textWithFaceSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1) }).strict(),
  z.object({ type: z.literal('face'), faceId: z.string().min(1) }).strict(),
]);

/** 官方Schema直接声明模型可以提交的QQ动作。 */
const qqActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('send_text'), text: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal('send_msg'),
      message: z.array(sendMessageSegmentSchema).min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('send_text_with_face'),
      segments: z.array(textWithFaceSegmentSchema).min(2),
    })
    .strict(),
  z.object({ type: z.literal('send_face'), faceId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('send_custom_image'), file: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal('send_market_face'),
      emojiPackageId: z.number().int().positive(),
      emojiId: z.string().min(1),
      key: z.string().min(1),
      summary: z.string().min(1),
    })
    .strict(),
  z.object({ type: z.literal('poke_sender') }).strict(),
  z.object({ type: z.literal('react_to_message'), emojiId: z.string().min(1) }).strict(),
]);

/** 模型提交的最终结果类型。 */
const finishInputSchema = z
  .object({
    result: z.enum(['reply', 'ignore', 'review']).describe('本轮最终处理方式'),
    text: z.string().trim().min(1).max(10000).optional().describe('可选回复文本'),
    actions: z.array(qqActionSchema).max(20).optional().describe('可选QQ白名单动作'),
    reason: z.string().trim().min(1).max(1000).describe('选择该结果的简短原因'),
  })
  .strict();

type FinishInput = z.infer<typeof finishInputSchema>;

/**
 * 创建Agent终止工具
 *
 * 模型只能提交候选终态。系统在这里校验强制回复、QQ动作白名单和资源来源，
 * 校验通过后才允许写入AgentRunState。
 *
 * @param state 单次Agent系统状态
 * @returns 不消耗普通工具预算的终止Tool
 */
export function createFinishTool(state: AgentRunState): CanonicalTool {
  return Tool.make({
    description: '结束本轮处理。可以回复、忽略或请求人工复核；回复时可提供文本和受支持的QQ动作。',
    parameters: finishInputSchema,
    policy: {
      source: 'finish',
      risk: 'low',
      approval: 'never',
      timeoutMs: 1000,
      consumesBudget: false,
    },
    execute: (input: FinishInput) => settleFinish(state, input),
  });
}

// 校验模型候选结果并提交唯一系统终态。
function settleFinish(state: AgentRunState, input: FinishInput): ToolExecutionOutput {
  if (input.result === 'review') {
    state.finish({ type: 'human_review', reason: input.reason });
    return { success: true, summary: '已转交人工复核。' };
  }

  if (input.result === 'ignore') {
    if (state.replyIntent === 'required_group_reply') {
      return reject('本轮由群聊节奏门控触发，必须回复，不能忽略。');
    }
    state.finish({ type: 'ignore', reason: input.reason });
    return { success: true, summary: '本轮已忽略。' };
  }

  if (state.replyIntent === 'required_group_reply' && !state.recentMessagesReady) {
    return reject('本轮必须回复，但最近消息观察尚未成功，请先读取当前会话上下文。');
  }

  const actionsResult = parseActions(input.actions ?? []);
  if (!actionsResult.success) return reject(actionsResult.error);
  const text = normalizeOptionalText(input.text);
  if (!text && actionsResult.actions.length === 0) {
    return reject('回复至少需要文本或一个合法QQ动作。');
  }

  const resourceError = validateObservedResources(state, actionsResult.actions);
  if (resourceError) return reject(resourceError);
  if (hasInvalidPokeCombination(text, actionsResult.actions)) {
    return reject('戳一戳必须单独使用，不能与文本或其他动作组合。');
  }

  state.finish({
    type: 'reply',
    ...(text ? { text } : {}),
    actions: actionsResult.actions.length > 0 ? actionsResult.actions : undefined,
  });
  return { success: true, summary: '最终回复已通过系统校验。' };
}

// QQ动作采用全有或全无校验，避免静默丢弃部分模型意图。
function parseActions(
  inputs: readonly unknown[],
):
  | { readonly success: true; readonly actions: readonly QqReplyAction[] }
  | { readonly success: false; readonly error: string } {
  const actions: QqReplyAction[] = [];
  for (const [index, input] of inputs.entries()) {
    const action = parseQqReplyAction(input);
    if (!action) {
      return { success: false, error: `第 ${index + 1} 个QQ动作不合法。` };
    }
    actions.push(action);
  }
  return { success: true, actions };
}

// 自定义图片只能使用本轮get_custom_faces已确认的资源。
function validateObservedResources(
  state: AgentRunState,
  actions: readonly QqReplyAction[],
): string | undefined {
  for (const action of actions) {
    if (action.type === 'send_custom_image' && !state.hasCustomFace(action.file)) {
      return `自定义表情 ${action.file} 不属于本轮已确认目录。`;
    }
    if (action.type !== 'send_msg') continue;
    for (const segment of action.message) {
      if (segment.type === 'image' && !state.hasCustomFace(segment.file)) {
        return `消息图片 ${segment.file} 不属于本轮已确认目录。`;
      }
    }
  }
  return undefined;
}

// 戳一戳在平台侧是独立互动，不能和其他外发内容混为一次终态。
function hasInvalidPokeCombination(
  text: string | undefined,
  actions: readonly QqReplyAction[],
): boolean {
  const pokeCount = actions.filter((action) => action.type === 'poke_sender').length;
  return pokeCount > 0 && (Boolean(text) || actions.length !== 1);
}

// Zod已做输入校验，此处只统一终态中的空白处理。
function normalizeOptionalText(text: string | undefined): string | undefined {
  const normalized = text?.trim();
  return normalized ? normalized : undefined;
}

// 生成可让模型调整后重试的受控失败。
function reject(summary: string): ToolExecutionOutput {
  return {
    success: false,
    summary,
    error: summary,
    retryable: true,
  };
}
