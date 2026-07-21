import type { SkillRuntime } from '../skills';
import type { Tool, ToolContext, ToolResult } from './tool';

/** Skill Tool依赖的最小渐进读取能力。 */
type SkillAccess = Pick<SkillRuntime, 'load' | 'loadReference'>;

/** Skill工具输入。 */
interface SkillToolInput {
  readonly name: string;
  readonly reference?: string;
}

/**
 * Skill渐进读取工具。
 *
 * 正文只能从本轮可见目录启用，引用只能从已经启用的Skill读取，防止该工具
 * 退化为任意文件读取入口。
 */
export class SkillTool implements Tool {
  readonly name = 'skill';
  readonly description = '按需启用可见Skill，或读取已启用Skill的references文件。';
  readonly risk = 'low' as const;
  readonly input = '{"name":"Skill名称","reference":"可选的references相对路径"}';

  constructor(private readonly skills: SkillAccess) {}

  /** 根据是否提供reference读取Skill正文或引用。 */
  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const parsed = parseSkillToolInput(input);
    if (!parsed) {
      return {
        success: false,
        summary: 'Skill工具输入无效，需要提供name和可选reference。',
        error: 'Skill工具输入无效',
      };
    }

    if (parsed.reference) return await this.loadReference(parsed, context);
    return await this.loadContent(parsed.name, context);
  }

  // 只有目录中可见或已经启用的Skill才能读取正文。
  private async loadContent(name: string, context: ToolContext): Promise<ToolResult> {
    const enabled = context.enabledSkills?.find((skill) => skill.metadata.name === name);
    if (enabled) {
      return {
        success: true,
        summary: `Skill ${name} 已启用。`,
        data: { contextMessages: [{ type: 'skill_content', skill: enabled }] },
      };
    }

    const available = context.availableSkills?.some((skill) => skill.name === name) ?? false;
    if (!available) {
      return {
        success: false,
        summary: `Skill ${name} 未出现在本轮可见目录中。`,
        error: 'Skill本轮不可用',
      };
    }

    const content = await this.skills.load(name);
    return {
      success: true,
      summary: `已启用Skill ${name}。`,
      data: { contextMessages: [{ type: 'skill_content', skill: content }] },
    };
  }

  // 引用必须绑定已启用正文，避免绕过Skill渐进读取顺序。
  private async loadReference(input: SkillToolInput, context: ToolContext): Promise<ToolResult> {
    const skill = context.enabledSkills?.find((item) => item.metadata.name === input.name);
    if (!skill) {
      return {
        success: false,
        summary: `Skill ${input.name} 尚未启用，不能读取引用。`,
        error: 'Skill尚未启用',
      };
    }

    const referenceKey = `${input.name}:${input.reference}`;
    const loadedReferences = context.loadedSkillReferences ?? [];
    const existing = loadedReferences.find(
      (item) => `${item.skill.name}:${item.referencePath}` === referenceKey,
    );
    if (existing) {
      return {
        success: true,
        summary: `Skill ${input.name}引用 ${input.reference} 已读取。`,
        data: { contextMessages: [] },
      };
    }

    if (
      context.maxSkillReferences !== undefined &&
      loadedReferences.length >= context.maxSkillReferences
    ) {
      return {
        success: false,
        summary: `Skill引用读取已达到本轮上限 ${context.maxSkillReferences}。`,
        error: 'Skill引用读取超限',
      };
    }

    const reference = await this.skills.loadReference(skill, input.reference!);
    return {
      success: true,
      summary: `已读取Skill ${input.name}引用 ${input.reference}。`,
      data: { contextMessages: [{ type: 'skill_reference', reference }] },
    };
  }
}

/** 从不可信Action输入中读取Skill工具参数。 */
function parseSkillToolInput(input: unknown): SkillToolInput | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const candidate = input as Record<string, unknown>;
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const reference =
    typeof candidate.reference === 'string' ? candidate.reference.trim() : undefined;
  if (!name || (candidate.reference !== undefined && !reference)) return undefined;
  return { name, ...(reference ? { reference } : {}) };
}
