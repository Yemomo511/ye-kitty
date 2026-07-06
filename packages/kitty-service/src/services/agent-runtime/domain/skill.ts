/**
 * Skill元信息
 *
 * 启动时只读取 SKILL.md frontmatter 中的最小字段。
 * rootPath 是运行时补充的资产目录位置，不属于 Skill 原始声明。
 */
export interface SkillMetadata {
  /** Skill名称 */
  readonly name: string;
  /** Skill描述 */
  readonly description: string;
  /** Skill目录 */
  readonly rootPath: string;
}

/**
 * Skill正文内容
 *
 * 运行时命中 Skill 后再渐进读取 Markdown 正文，避免启动时加载完整能力包。
 */
export interface SkillContent {
  /** Skill元信息 */
  readonly metadata: SkillMetadata;
  /** Markdown正文 */
  readonly body: string;
}
