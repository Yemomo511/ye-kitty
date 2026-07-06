/**
 * Skill Markdown解析结果
 *
 * 第一版只解析 Open Design 风格 SKILL.md 的 name、description 和正文。
 */
export interface ParsedSkillMarkdown {
  /** Skill名称 */
  readonly name: string;
  /** Skill描述 */
  readonly description: string;
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
    body,
  };
}

// 解析受限字段，避免第一版为了两个字段引入 YAML 依赖。
function parseFrontmatterFields(
  frontmatter: string,
  sourcePath: string,
): {
  readonly name: string;
  readonly description: string;
} {
  const fields = new Map<string, string>();

  for (const line of frontmatter.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith('#')) continue;

    const separatorIndex = trimmedLine.indexOf(':');
    if (separatorIndex < 1) continue;

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = unwrapQuotedValue(trimmedLine.slice(separatorIndex + 1).trim());
    fields.set(key, value);
  }

  const name = fields.get('name')?.trim();
  const description = fields.get('description')?.trim();
  if (!name) throw new Error(`Skill文件缺少name: ${sourcePath}`);
  if (!description) throw new Error(`Skill文件缺少description: ${sourcePath}`);

  return { name, description };
}

// 去掉简单包裹引号，保留中文描述原文。
function unwrapQuotedValue(value: string): string {
  const quote = value[0];
  const shouldUnwrap = (quote === '"' || quote === "'") && value.endsWith(quote);
  return shouldUnwrap ? value.slice(1, -1) : value;
}
