import type { SkillMetadata } from './skill';

/** Skill引用读取限制 */
export interface SkillReferenceLimits {
  /** 单文件最大字符数 */
  readonly maxChars: number;
  /** 单次运行最大读取数 */
  readonly maxReferencesPerRun: number;
}

/**
 * Skill引用内容
 *
 * references 文件是 Skill 的低优先级补充上下文，只能服务已启用 Skill。
 */
export interface SkillReferenceContent {
  /** 所属Skill */
  readonly skill: SkillMetadata;
  /** 用户请求路径 */
  readonly referencePath: string;
  /** 真实文件路径 */
  readonly absolutePath: string;
  /** 文件正文 */
  readonly content: string;
}
