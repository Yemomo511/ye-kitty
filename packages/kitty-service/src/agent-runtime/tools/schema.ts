import { z } from 'zod';

/** MCP服务端提供的对象JSON Schema。 */
export interface ToolJsonObjectSchema extends Record<string, unknown> {
  /** 顶层必须是对象 */
  readonly type: 'object';
  /** 字段定义 */
  readonly properties?: Readonly<Record<string, ToolJsonSchema>>;
  /** 必填字段 */
  readonly required?: readonly string[];
  /** 是否允许额外字段 */
  readonly additionalProperties?: boolean | ToolJsonSchema;
}

/** Tool支持的JSON Schema节点。 */
export interface ToolJsonSchema extends Record<string, unknown> {
  /** JSON类型 */
  readonly type?: string | readonly string[];
  /** 对象字段 */
  readonly properties?: Readonly<Record<string, ToolJsonSchema>>;
  /** 必填字段 */
  readonly required?: readonly string[];
  /** 额外字段规则 */
  readonly additionalProperties?: boolean | ToolJsonSchema;
  /** 数组元素 */
  readonly items?: ToolJsonSchema;
  /** 枚举值 */
  readonly enum?: readonly unknown[];
  /** 固定值 */
  readonly const?: unknown;
  /** 字符串最小长度 */
  readonly minLength?: number;
  /** 字符串最大长度 */
  readonly maxLength?: number;
  /** 字符串正则 */
  readonly pattern?: string;
  /** 数值下限 */
  readonly minimum?: number;
  /** 数值上限 */
  readonly maximum?: number;
  /** 数值严格下限 */
  readonly exclusiveMinimum?: number;
  /** 数值严格上限 */
  readonly exclusiveMaximum?: number;
  /** 数值倍数 */
  readonly multipleOf?: number;
  /** 数组最小长度 */
  readonly minItems?: number;
  /** 数组最大长度 */
  readonly maxItems?: number;
  /** 数组元素是否唯一 */
  readonly uniqueItems?: boolean;
  /** 对象最少字段数 */
  readonly minProperties?: number;
  /** 对象最多字段数 */
  readonly maxProperties?: number;
  /** 组合分支 */
  readonly anyOf?: readonly ToolJsonSchema[];
  /** 唯一分支 */
  readonly oneOf?: readonly ToolJsonSchema[];
  /** 组合约束 */
  readonly allOf?: readonly ToolJsonSchema[];
  /** 反向约束 */
  readonly not?: ToolJsonSchema;
}

/** SDK函数工具可消费的参数定义。 */
export type ToolParameters = z.ZodObject<z.ZodRawShape> | ToolJsonObjectSchema;

/**
 * 判断Zod参数定义
 * @param parameters 参数Schema
 * @returns 是否为Zod对象
 */
export function isZodToolParameters(
  parameters: ToolParameters,
): parameters is z.ZodObject<z.ZodRawShape> {
  return parameters instanceof z.ZodType;
}

/** Tool输入解码结果。 */
export type ToolInputDecodeResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly error: string };

/**
 * 解码Tool输入
 * @param parameters 参数Schema
 * @param input 不可信输入
 * @returns 已校验输入或中文错误
 */
export function decodeToolInput(parameters: ToolParameters, input: unknown): ToolInputDecodeResult {
  if (isZodToolParameters(parameters)) {
    const parsed = parameters.safeParse(input);
    if (parsed.success) return { success: true, data: parsed.data };
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join('；'),
    };
  }

  const error = validateJsonSchema(parameters, input, '$');
  return error ? { success: false, error } : { success: true, data: input };
}

/**
 * 检查远端JSON Schema是否落在运行时可完整验证的子集中
 * @param schema 不可信Schema
 * @returns 不兼容原因；undefined表示可用
 */
export function validateToolJsonSchemaDefinition(schema: unknown): string | undefined {
  return validateSchemaNode(schema, '$');
}

// 校验项目支持的JSON Schema子集。
function validateJsonSchema(
  schema: ToolJsonSchema,
  value: unknown,
  path: string,
): string | undefined {
  if ('const' in schema && !Object.is(schema.const, value)) {
    return `${path} 不等于固定值`;
  }
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    return `${path} 不在允许值中`;
  }

  const combinationError =
    validateAnyOf(schema.anyOf, value, path) ??
    validateOneOf(schema.oneOf, value, path) ??
    validateAllOf(schema.allOf, value, path);
  if (combinationError) return combinationError;

  const allowedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (allowedTypes.length > 0 && !allowedTypes.some((type) => matchesType(type, value))) {
    return `${path} 类型不符合Schema`;
  }
  const scalarError =
    validateString(schema, value, path) ??
    validateNumber(schema, value, path) ??
    validateArrayShape(schema, value, path);
  if (scalarError) return scalarError;

  if (isRecord(value) && (schema.type === 'object' || schema.properties)) {
    return validateObject(schema, value, path);
  }
  if (Array.isArray(value) && schema.items) {
    for (const [index, item] of value.entries()) {
      const itemError = validateJsonSchema(schema.items, item, `${path}[${index}]`);
      if (itemError) return itemError;
    }
  }
  if (schema.not && !validateJsonSchema(schema.not, value, path)) {
    return `${path} 命中了禁止的Schema`;
  }
  return undefined;
}

// 校验对象字段和额外属性。
function validateObject(
  schema: ToolJsonSchema,
  value: Record<string, unknown>,
  path: string,
): string | undefined {
  const properties = schema.properties ?? {};
  if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
    return `${path} 字段数小于 ${schema.minProperties}`;
  }
  if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) {
    return `${path} 字段数大于 ${schema.maxProperties}`;
  }
  for (const required of schema.required ?? []) {
    if (!(required in value)) return `${path}.${required} 为必填字段`;
  }
  for (const [key, item] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (propertySchema) {
      const propertyError = validateJsonSchema(propertySchema, item, `${path}.${key}`);
      if (propertyError) return propertyError;
      continue;
    }
    if (schema.additionalProperties === false) return `${path}.${key} 不允许出现`;
    if (isRecord(schema.additionalProperties)) {
      const extraError = validateJsonSchema(schema.additionalProperties, item, `${path}.${key}`);
      if (extraError) return extraError;
    }
  }
  return undefined;
}

// 校验字符串约束。
function validateString(schema: ToolJsonSchema, value: unknown, path: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    return `${path} 长度小于 ${schema.minLength}`;
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    return `${path} 长度大于 ${schema.maxLength}`;
  }
  if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
    return `${path} 不符合正则约束`;
  }
  return undefined;
}

// 校验数值约束。
function validateNumber(schema: ToolJsonSchema, value: unknown, path: string): string | undefined {
  if (typeof value !== 'number') return undefined;
  if (schema.minimum !== undefined && value < schema.minimum) return `${path} 小于最小值`;
  if (schema.maximum !== undefined && value > schema.maximum) return `${path} 大于最大值`;
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
    return `${path} 不大于严格下限`;
  }
  if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
    return `${path} 不小于严格上限`;
  }
  if (schema.multipleOf !== undefined && !isMultipleOf(value, schema.multipleOf)) {
    return `${path} 不是指定数值的倍数`;
  }
  return undefined;
}

// 校验数组整体约束。
function validateArrayShape(
  schema: ToolJsonSchema,
  value: unknown,
  path: string,
): string | undefined {
  if (!Array.isArray(value)) return undefined;
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    return `${path} 元素数小于 ${schema.minItems}`;
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    return `${path} 元素数大于 ${schema.maxItems}`;
  }
  if (schema.uniqueItems && new Set(value.map(stableJson)).size !== value.length) {
    return `${path} 存在重复元素`;
  }
  return undefined;
}

// 校验任一分支。
function validateAnyOf(
  schemas: readonly ToolJsonSchema[] | undefined,
  value: unknown,
  path: string,
): string | undefined {
  if (!schemas) return undefined;
  return schemas.some((schema) => !validateJsonSchema(schema, value, path))
    ? undefined
    : `${path} 不符合任一Schema分支`;
}

// 校验唯一分支。
function validateOneOf(
  schemas: readonly ToolJsonSchema[] | undefined,
  value: unknown,
  path: string,
): string | undefined {
  if (!schemas) return undefined;
  const matched = schemas.filter((schema) => !validateJsonSchema(schema, value, path));
  return matched.length === 1 ? undefined : `${path} 必须且只能符合一个Schema分支`;
}

// 校验全部分支。
function validateAllOf(
  schemas: readonly ToolJsonSchema[] | undefined,
  value: unknown,
  path: string,
): string | undefined {
  if (!schemas) return undefined;
  for (const schema of schemas) {
    const error = validateJsonSchema(schema, value, path);
    if (error) return error;
  }
  return undefined;
}

// 判断JSON基础类型。
function matchesType(type: string, value: unknown): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === type;
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
]);
const JSON_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'string', 'integer']);

// 递归检查Schema结构，未知验证关键字不允许静默降级。
function validateSchemaNode(schema: unknown, path: string): string | undefined {
  if (!isRecord(schema)) return `${path} 必须是Schema对象`;
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) return `${path} 包含不支持的关键字 ${key}`;
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (
    types.some((type) => typeof type !== 'string' || !JSON_TYPES.has(type)) ||
    new Set(types).size !== types.length
  ) {
    return `${path}.type 包含不支持的类型`;
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    return `${path}.enum 必须是非空数组`;
  }
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') {
    return `${path}.uniqueItems 必须是布尔值`;
  }
  if (schema.required !== undefined && !isStringArray(schema.required)) {
    return `${path}.required 必须是字符串数组`;
  }
  if (schema.properties !== undefined && !isRecord(schema.properties)) {
    return `${path}.properties 必须是对象`;
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== 'boolean' &&
    !isRecord(schema.additionalProperties)
  ) {
    return `${path}.additionalProperties 必须是布尔值或Schema`;
  }
  const numericError = validateSchemaNumbers(schema, path);
  if (numericError) return numericError;
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') return `${path}.pattern 必须是字符串`;
    try {
      new RegExp(schema.pattern, 'u');
    } catch {
      return `${path}.pattern 不是有效正则`;
    }
  }
  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      const error = validateSchemaNode(child, `${path}.properties.${key}`);
      if (error) return error;
    }
  }
  if (isRecord(schema.additionalProperties)) {
    const error = validateSchemaNode(schema.additionalProperties, `${path}.additionalProperties`);
    if (error) return error;
  }
  if (schema.items !== undefined) {
    const error = validateSchemaNode(schema.items, `${path}.items`);
    if (error) return error;
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const branches = schema[keyword];
    if (branches === undefined) continue;
    if (!Array.isArray(branches) || branches.length === 0) {
      return `${path}.${keyword} 必须是非空Schema数组`;
    }
    for (const [index, branch] of branches.entries()) {
      const error = validateSchemaNode(branch, `${path}.${keyword}[${index}]`);
      if (error) return error;
    }
  }
  if (schema.not !== undefined) {
    const error = validateSchemaNode(schema.not, `${path}.not`);
    if (error) return error;
  }
  return undefined;
}

// 检查Schema数值关键字类型和值域。
function validateSchemaNumbers(schema: Record<string, unknown>, path: string): string | undefined {
  const nonNegativeIntegerKeys = [
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
    'minProperties',
    'maxProperties',
  ];
  const numberKeys = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'];
  for (const key of nonNegativeIntegerKeys) {
    const value = schema[key];
    if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0)) {
      return `${path}.${key} 必须是非负整数`;
    }
  }
  for (const key of numberKeys) {
    const value = schema[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      return `${path}.${key} 必须是有限数值`;
    }
  }
  if (
    schema.multipleOf !== undefined &&
    typeof schema.multipleOf === 'number' &&
    schema.multipleOf <= 0
  ) {
    return `${path}.multipleOf 必须大于0`;
  }
  return undefined;
}

// 避免浮点倍数判断受到常见二进制精度误差影响。
function isMultipleOf(value: number, divisor: number): boolean {
  const quotient = value / divisor;
  return Math.abs(quotient - Math.round(quotient)) < Number.EPSILON * 16;
}

// 为唯一数组约束生成稳定比较键。
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value) ?? String(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

// 判断字符串数组。
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// 判断非数组对象。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
