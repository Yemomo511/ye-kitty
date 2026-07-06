/**
 * Skill Markdown解析结果
 *
 * 解析 Agent Skills 基线字段，并保留 Ye-Kitty 运行时需要的扩展字段。
 */
export interface ParsedSkillMarkdown {
  /** Skill名称 */
  readonly name: string;
  /** Skill描述 */
  readonly description: string;
  /** 建议工具 */
  readonly allowedTools?: readonly string[];
  /** 扩展元信息 */
  readonly metadata?: Readonly<Record<string, string>>;
  /** Markdown正文 */
  readonly body: string;
}

/**
 * 解析Skill Markdown
 * @param content SKILL.md内容
 * @param sourcePath 文件路径
 * @returns 元信息和正文
 */
export function parseSkillMarkdown(content: string, sourcePath: string): ParsedSkillMarkdown {
  const normalizedContent = content.replace(/\r\n/g, '\n');
  if (!normalizedContent.startsWith('---\n')) {
    throw new Error(`Skill文件缺少frontmatter: ${sourcePath}`);
  }

  const closingIndex = normalizedContent.indexOf('\n---', 4);
  if (closingIndex < 0) {
    throw new Error(`Skill文件frontmatter未闭合: ${sourcePath}`);
  }

  const frontmatter = normalizedContent.slice(4, closingIndex);
  const bodyStartIndex = closingIndex + '\n---'.length;
  const body = normalizedContent.slice(bodyStartIndex).replace(/^\n/, '').trim();
  const fields = parseFrontmatterFields(frontmatter, sourcePath);

  return {
    name: fields.name,
    description: fields.description,
    allowedTools: fields.allowedTools,
    metadata: fields.metadata,
    body,
  };
}

// 解析受限字段，避免为了少量字段引入 YAML 依赖。
function parseFrontmatterFields(
  frontmatter: string,
  sourcePath: string,
): {
  readonly name: string;
  readonly description: string;
  readonly allowedTools?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
} {
  const fields = new Map<string, string>();
  const metadata = new Map<string, string>();
  let section: 'metadata' | undefined;

  for (const line of frontmatter.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) continue;

    if (section === 'metadata' && isIndented(line)) {
      const separatorIndex = trimmedLine.indexOf(':');
      if (separatorIndex < 1) continue;

      const key = trimmedLine.slice(0, separatorIndex).trim();
      const value = unwrapQuotedValue(trimmedLine.slice(separatorIndex + 1).trim());
      metadata.set(key, value);
      continue;
    }

    section = undefined;
    const separatorIndex = trimmedLine.indexOf(':');
    if (separatorIndex < 1) continue;

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = unwrapQuotedValue(trimmedLine.slice(separatorIndex + 1).trim());
    if (key === 'metadata' && value.length === 0) {
      section = 'metadata';
      continue;
    }

    fields.set(key, value);
  }

  const name = fields.get('name')?.trim();
  const description = fields.get('description')?.trim();
  if (!name) throw new Error(`Skill文件缺少name: ${sourcePath}`);
  if (!description) throw new Error(`Skill文件缺少description: ${sourcePath}`);

  return {
    name,
    description,
    allowedTools: parseAllowedTools(fields.get('allowed-tools')),
    metadata: metadata.size > 0 ? Object.fromEntries(metadata) : undefined,
  };
}

// 判断是否为嵌套字段。
function isIndented(line: string): boolean {
  return line.startsWith(' ') || line.startsWith('\t');
}

// 解析市场Skill建议工具。
function parseAllowedTools(value: string | undefined): readonly string[] | undefined {
  const tools = value
    ?.split(/[\s,]+/)
    .map((tool) => tool.trim())
    .filter(Boolean);

  return tools && tools.length > 0 ? tools : undefined;
}

// 去掉简单包裹引号，保留中文描述原文。
function unwrapQuotedValue(value: string): string {
  const quote = value[0];
  const shouldUnwrap = (quote === '"' || quote === "'") && value.endsWith(quote);
  return shouldUnwrap ? value.slice(1, -1) : value;
}
