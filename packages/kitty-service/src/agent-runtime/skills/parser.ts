/** Skill Markdown解析结果。 */
export interface ParsedSkillMarkdown {
  readonly name: string;
  readonly description: string;
  readonly allowedTools?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * 解析SKILL.md中的受限frontmatter和正文。
 * @param content SKILL.md内容
 * @param sourcePath 文件路径，用于错误定位
 */
export function parseSkillMarkdown(content: string, sourcePath: string): ParsedSkillMarkdown {
  const normalizedContent = content.replace(/\r\n/g, '\n');
  if (!normalizedContent.startsWith('---\n')) {
    throw new Error(`Skill文件缺少frontmatter: ${sourcePath}`);
  }

  const closingIndex = normalizedContent.indexOf('\n---', 4);
  if (closingIndex < 0) throw new Error(`Skill文件frontmatter未闭合: ${sourcePath}`);

  const frontmatter = normalizedContent.slice(4, closingIndex);
  const bodyStartIndex = closingIndex + '\n---'.length;
  const body = normalizedContent.slice(bodyStartIndex).replace(/^\n/, '').trim();
  const fields = parseFrontmatterFields(frontmatter, sourcePath);
  return { ...fields, body };
}

/** 解析当前运行时支持的frontmatter字段，避免为少量字段引入YAML运行依赖。 */
function parseFrontmatterFields(
  frontmatter: string,
  sourcePath: string,
): Omit<ParsedSkillMarkdown, 'body'> {
  const fields = new Map<string, string>();
  const metadata = new Map<string, string>();
  let section: 'metadata' | undefined;

  for (const line of frontmatter.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) continue;

    if (section === 'metadata' && isIndented(line)) {
      const separatorIndex = trimmedLine.indexOf(':');
      if (separatorIndex < 1) continue;
      metadata.set(
        trimmedLine.slice(0, separatorIndex).trim(),
        unwrapQuotedValue(trimmedLine.slice(separatorIndex + 1).trim()),
      );
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

/** 判断frontmatter字段是否属于嵌套块。 */
function isIndented(line: string): boolean {
  return line.startsWith(' ') || line.startsWith('\t');
}

/** 将Skill建议工具拆分为名称列表。 */
function parseAllowedTools(value: string | undefined): readonly string[] | undefined {
  const tools = value
    ?.split(/[\s,]+/)
    .map((tool) => tool.trim())
    .filter(Boolean);
  return tools && tools.length > 0 ? tools : undefined;
}

/** 去掉简单包裹引号，保留字段原文。 */
function unwrapQuotedValue(value: string): string {
  const quote = value[0];
  return (quote === '"' || quote === "'") && value.endsWith(quote) ? value.slice(1, -1) : value;
}
