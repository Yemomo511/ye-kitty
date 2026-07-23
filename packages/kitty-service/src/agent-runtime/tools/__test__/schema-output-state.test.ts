import type { PlatformMessage } from '@kitty/platforms/message';
import type { ChatEventId, ConversationId, MessageId, ParticipantId } from '@kitty/shared/ids';
import { describe, expect, test } from 'vitest';
import { AgentRunState } from '../../state';
import { projectToolSettlement } from '../output';
import {
  decodeToolInput,
  type ToolJsonObjectSchema,
  validateToolJsonSchemaDefinition,
} from '../schema';

describe('JSON Schema系统校验', () => {
  const schema: ToolJsonObjectSchema = {
    type: 'object',
    properties: {
      mode: { enum: ['read', 'write'] },
      values: { type: 'array', items: { type: 'integer' } },
    },
    required: ['mode'],
    additionalProperties: false,
  };

  test('校验必填、枚举、数组元素和额外字段', () => {
    expect(decodeToolInput(schema, { mode: 'read', values: [1, 2] }).success).toBe(true);
    expect(decodeToolInput(schema, { values: [1] })).toMatchObject({ success: false });
    expect(decodeToolInput(schema, { mode: 'delete' })).toMatchObject({ success: false });
    expect(decodeToolInput(schema, { mode: 'read', values: ['1'] })).toMatchObject({
      success: false,
    });
    expect(decodeToolInput(schema, { mode: 'read', extra: true })).toMatchObject({
      success: false,
    });
  });

  test('支持anyOf、oneOf和allOf组合约束', () => {
    expect(
      decodeToolInput(
        {
          type: 'object',
          properties: {
            value: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
          },
        },
        { value: 1 },
      ).success,
    ).toBe(true);
    expect(
      decodeToolInput(
        {
          type: 'object',
          properties: {
            value: { oneOf: [{ type: 'number' }, { type: 'integer' }] },
          },
        },
        { value: 1 },
      ).success,
    ).toBe(false);
  });

  test('完整校验字符串、数值、数组、对象和反向约束', () => {
    const constrained: ToolJsonObjectSchema = {
      type: 'object',
      minProperties: 4,
      maxProperties: 4,
      properties: {
        code: { type: 'string', minLength: 2, maxLength: 4, pattern: '^[A-Z]+$' },
        score: { type: 'number', exclusiveMinimum: 0, maximum: 10, multipleOf: 0.5 },
        tags: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true },
        state: { not: { const: 'blocked' } },
      },
      required: ['code', 'score', 'tags', 'state'],
      additionalProperties: false,
    };

    expect(
      decodeToolInput(constrained, {
        code: 'OK',
        score: 1.5,
        tags: ['a'],
        state: 'ready',
      }).success,
    ).toBe(true);
    expect(
      decodeToolInput(constrained, {
        code: 'bad',
        score: 0,
        tags: ['a', 'a'],
        state: 'blocked',
      }).success,
    ).toBe(false);
    expect(
      decodeToolInput(constrained, {
        code: 'TOOLONG',
        score: 10.1,
        tags: [],
        state: 'ready',
      }).success,
    ).toBe(false);
    expect(
      decodeToolInput(constrained, {
        code: 'OK',
        score: 1.3,
        tags: ['a', 'b', 'c'],
        state: 'ready',
      }).success,
    ).toBe(false);
    expect(
      decodeToolInput(
        {
          type: 'object',
          maxProperties: 1,
          additionalProperties: { type: 'integer' },
        },
        { first: 1, second: 'bad' },
      ).success,
    ).toBe(false);
  });

  test('隔离未知关键字和结构错误，不允许校验能力静默降级', () => {
    expect(
      validateToolJsonSchemaDefinition({
        type: 'object',
        properties: { query: { type: 'string', format: 'email' } },
      }),
    ).toContain('不支持的关键字 format');
    expect(
      validateToolJsonSchemaDefinition({
        type: 'object',
        properties: { query: { type: 'string', pattern: '[' } },
      }),
    ).toContain('不是有效正则');
    expect(validateToolJsonSchemaDefinition({ type: 'mystery' })).toContain('不支持的类型');
    expect(validateToolJsonSchemaDefinition(null)).toContain('必须是Schema对象');
    expect(validateToolJsonSchemaDefinition({ type: ['string', 'string'] })).toContain(
      '不支持的类型',
    );
    expect(validateToolJsonSchemaDefinition({ enum: [] })).toContain('必须是非空数组');
    expect(validateToolJsonSchemaDefinition({ uniqueItems: 'yes' })).toContain('必须是布尔值');
    expect(validateToolJsonSchemaDefinition({ required: 'query' })).toContain('字符串数组');
    expect(validateToolJsonSchemaDefinition({ properties: [] })).toContain('必须是对象');
    expect(validateToolJsonSchemaDefinition({ additionalProperties: 1 })).toContain(
      '布尔值或Schema',
    );
    expect(validateToolJsonSchemaDefinition({ minLength: -1 })).toContain('非负整数');
    expect(validateToolJsonSchemaDefinition({ minimum: 'zero' })).toContain('有限数值');
    expect(validateToolJsonSchemaDefinition({ multipleOf: 0 })).toContain('必须大于0');
    expect(validateToolJsonSchemaDefinition({ pattern: 1 })).toContain('必须是字符串');
    expect(
      validateToolJsonSchemaDefinition({ additionalProperties: { format: 'date' } }),
    ).toContain('不支持的关键字');
    expect(validateToolJsonSchemaDefinition({ items: [] })).toContain('必须是Schema对象');
    expect(validateToolJsonSchemaDefinition({ anyOf: [] })).toContain('非空Schema数组');
    expect(validateToolJsonSchemaDefinition({ allOf: [{ format: 'date' }] })).toContain(
      '不支持的关键字',
    );
    expect(validateToolJsonSchemaDefinition({ not: { format: 'date' } })).toContain(
      '不支持的关键字',
    );
  });
});

describe('模型输出安全投影', () => {
  test('脱敏键名和自由文本中的凭证', () => {
    const projected = projectToolSettlement({
      status: 'success',
      audit: createAudit(),
      output: {
        success: true,
        summary: 'Authorization: Bearer abc123 token=secret-value',
        data: {
          apiKey: 'sk-private',
          nested: 'password=hunter2',
        },
      },
    });

    expect(JSON.stringify(projected)).not.toContain('abc123');
    expect(JSON.stringify(projected)).not.toContain('secret-value');
    expect(JSON.stringify(projected)).not.toContain('sk-private');
    expect(JSON.stringify(projected)).not.toContain('hunter2');
  });

  test('循环、深层和超长结果均转换为有界观察', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    circular.long = 'x'.repeat(13000);
    let deep: Record<string, unknown> = circular;
    for (let index = 0; index < 8; index += 1) deep = { next: deep };

    const projected = projectToolSettlement({
      status: 'success',
      audit: createAudit(),
      output: { success: true, summary: '完成', data: deep },
    });
    const text = JSON.stringify(projected);

    expect(text).toContain('层级已截断');
    expect(text.length).toBeLessThan(13000);
  });

  test.each([
    ['denied', '工具调用未通过系统权限校验。'],
    ['review', '工具调用需要人工审核'],
    ['timeout', '工具执行超时'],
    ['cancelled', '工具调用已取消'],
  ] as const)('为%s状态生成固定安全摘要', (status, summary) => {
    expect(
      projectToolSettlement({
        status,
        audit: createAudit(),
        error: {
          code: status === 'review' ? 'approval_required' : 'permission_denied',
          message: '内部错误 token=private',
          retryable: false,
        },
      }).summary,
    ).toContain(summary);
  });

  test('输入错误和受控执行失败只回传安全业务摘要', () => {
    const invalid = projectToolSettlement({
      status: 'error',
      audit: createAudit(),
      error: { code: 'invalid_input', message: '$.query 为必填字段', retryable: true },
    });
    const failed = projectToolSettlement({
      status: 'error',
      audit: createAudit(),
      output: {
        success: false,
        summary: '远端拒绝 token=private',
      },
      error: { code: 'execution_failed', message: '内部错误', retryable: false },
    });

    expect(invalid.summary).toContain('$.query 为必填字段');
    expect(failed.summary).toBe('远端拒绝 token=***');
  });

  test('数组结果限制数量且成功结果可以声明retryable', () => {
    const projected = projectToolSettlement({
      status: 'success',
      audit: createAudit(),
      output: {
        success: true,
        summary: '完成',
        data: Array.from({ length: 60 }, (_, index) => index),
        retryable: false,
      },
    });

    expect(projected.retryable).toBe(false);
    expect(projected.data).toHaveLength(50);
  });
});

describe('AgentRunState系统治理', () => {
  test('不可变快照、审批和预算均由系统判定', async () => {
    const state = createState(1);
    state.bindToolSnapshot(['read', 'write']);
    const context = state.createToolContext(new AbortController().signal);
    const lowPolicy = {
      source: 'builtin' as const,
      risk: 'low' as const,
      approval: 'never' as const,
      timeoutMs: 1000,
    };

    await expect(
      context.authorize({
        name: 'unknown',
        policy: lowPolicy,
        input: {},
        callId: 'unknown-1',
        approvalGranted: false,
        budgetExempt: false,
      }),
    ).resolves.toMatchObject({ status: 'denied' });
    await expect(
      context.authorize({
        name: 'read',
        policy: lowPolicy,
        input: {},
        callId: 'read-1',
        approvalGranted: false,
        budgetExempt: false,
      }),
    ).resolves.toEqual({ status: 'allowed' });
    await expect(
      context.authorize({
        name: 'read',
        policy: lowPolicy,
        input: {},
        callId: 'read-2',
        approvalGranted: false,
        budgetExempt: false,
      }),
    ).resolves.toMatchObject({ status: 'denied' });
    await expect(
      context.authorize({
        name: 'write',
        policy: { ...lowPolicy, risk: 'high', approval: 'required' },
        input: {},
        callId: 'write-1',
        approvalGranted: false,
        budgetExempt: false,
      }),
    ).resolves.toMatchObject({ status: 'review' });
    expect(() => state.bindToolSnapshot(['other'])).toThrow('已经绑定');
  });

  test('向调用方返回数组快照，不暴露内部Skill集合', () => {
    const state = createState(1);
    const enabled = state.enabledSkills as unknown[];
    const references = state.loadedReferences as unknown[];

    expect(Object.isFrozen(enabled)).toBe(true);
    expect(Object.isFrozen(references)).toBe(true);
    expect(() => enabled.push({})).toThrow();
    expect(() => references.push({})).toThrow();
  });
});

function createState(maxToolCalls: number): AgentRunState {
  return new AgentRunState({
    runId: 'run-1',
    traceId: 'trace-1',
    agentName: '叶猫猫',
    event: createMessage(),
    availableSkills: [],
    enabledSkills: [],
    replyIntent: 'normal',
    maxToolCalls,
    maxSkillReferences: 3,
  });
}

function createAudit() {
  return {
    runId: 'run-1',
    traceId: 'trace-1',
    callId: 'call-1',
    toolName: 'test',
    startedAt: 1,
    finishedAt: 2,
  };
}

function createMessage(): PlatformMessage {
  return {
    id: 'event-1' as ChatEventId,
    platform: 'qq',
    eventType: 'message.received',
    conversationId: 'group-1' as ConversationId,
    conversationType: 'group',
    senderId: 'user-1' as ParticipantId,
    message: {
      id: 'message-1' as MessageId,
      type: 'text',
      text: '测试',
      mentions: [],
    },
    receivedAt: new Date('2026-07-23T00:00:00.000Z'),
  };
}
