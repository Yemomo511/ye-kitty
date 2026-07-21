/** Skill元信息，启动时只读取SKILL.md的最小声明。 */
export interface SkillMetadata {
  /** Skill名称。 */
  readonly name: string;
  /** Skill用途描述。 */
  readonly description: string;
  /** Skill建议开放的工具。 */
  readonly allowedTools?: readonly string[];
  /** Skill扩展元信息。 */
  readonly metadata?: Readonly<Record<string, string>>;
  /** Skill资产根目录。 */
  readonly rootPath: string;
}

/** 命中Skill后按需加载的完整内容。 */
export interface SkillContent {
  /** Skill元信息。 */
  readonly metadata: SkillMetadata;
  /** SKILL.md正文。 */
  readonly body: string;
}
