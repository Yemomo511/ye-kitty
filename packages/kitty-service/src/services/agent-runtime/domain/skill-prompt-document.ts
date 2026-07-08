/**
 * Skill Prompt Schema版本
 *
 * 版本号进入模型上下文，方便后续压缩、审计和兼容升级时识别文档结构。
 */
export const SKILL_PROMPT_DOCUMENT_SCHEMA_VERSION = 'ye-kitty.skill.prompt.v1';

/** Skill Reference Prompt Schema版本 */
export const SKILL_REFERENCE_PROMPT_DOCUMENT_SCHEMA_VERSION = 'ye-kitty.skill.reference.v1';

/** Skill正文安全边界 */
export interface SkillPromptSafety {
  /** 是否允许覆盖System Prompt */
  readonly canOverrideSystemPrompt: false;
  /** 是否允许授予工具权限 */
  readonly canGrantToolPermission: false;
  /** 是否允许绕过Harness协议 */
  readonly canBypassHarnessProtocol: false;
}

/** Skill正文定位小节 */
export interface SkillPromptSection {
  /** 稳定小节ID */
  readonly id: string;
  /** 小节标题 */
  readonly title: string;
  /** Markdown标题层级 */
  readonly level: number;
  /** 小节正文 */
  readonly content: string;
}

/** Skill引用索引 */
export interface SkillReferenceIndex {
  /** references下的相对路径 */
  readonly path: string;
  /** 是否允许模型按需读取 */
  readonly readable: true;
  /** 文件扩展名 */
  readonly extension: '.md' | '.txt' | '.json';
}

/** Skill引用读取入口 */
export interface SkillReferenceAccess {
  /** 读取入口类型 */
  readonly type: 'skill_reference_call';
  /** 触发条件 */
  readonly trigger: string;
  /** 读取约束 */
  readonly constraint: string;
  /** 可读取文件索引 */
  readonly references: readonly SkillReferenceIndex[];
}

/** Skill结构化Prompt文档 */
export interface SkillPromptDocument {
  /** 文档类型 */
  readonly type: 'skill_document';
  /** Schema版本 */
  readonly schemaVersion: typeof SKILL_PROMPT_DOCUMENT_SCHEMA_VERSION;
  /** Skill基础信息 */
  readonly skill: {
    /** Skill名称 */
    readonly name: string;
    /** Skill描述 */
    readonly description: string;
  };
  /** 来源信息 */
  readonly source: {
    /** 来源类型 */
    readonly kind: 'SKILL.md';
    /** Skill内相对路径 */
    readonly relativePath: 'SKILL.md';
  };
  /** 上下文优先级 */
  readonly priority: 'observation';
  /** 安全边界 */
  readonly safety: SkillPromptSafety;
  /** 可定位小节 */
  readonly sections: readonly SkillPromptSection[];
  /** 可按需读取的引用索引 */
  readonly references: readonly SkillReferenceIndex[];
  /** 引用读取入口 */
  readonly referenceAccess: SkillReferenceAccess;
  /** Markdown原文 */
  readonly rawBody: string;
}

/** Skill引用结构化Prompt文档 */
export interface SkillReferencePromptDocument {
  /** 文档类型 */
  readonly type: 'skill_reference_document';
  /** Schema版本 */
  readonly schemaVersion: typeof SKILL_REFERENCE_PROMPT_DOCUMENT_SCHEMA_VERSION;
  /** 所属Skill */
  readonly skill: {
    /** Skill名称 */
    readonly name: string;
  };
  /** 引用文件 */
  readonly reference: {
    /** references下的相对路径 */
    readonly path: string;
    /** 文件扩展名 */
    readonly extension: '.md' | '.txt' | '.json';
  };
  /** 上下文优先级 */
  readonly priority: 'observation';
  /** 安全边界 */
  readonly safety: Pick<SkillPromptSafety, 'canOverrideSystemPrompt'>;
  /** 引用正文 */
  readonly content: string;
}
