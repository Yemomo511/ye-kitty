import type { SkillContent, SkillMetadata, SkillReferenceContent, SkillRuntime } from '../skills';
import { z } from 'zod';
import { Tool, type Tool as CanonicalTool } from './tool';

/** Skill Tool依赖的渐进读取能力。 */
type SkillAccess = Pick<SkillRuntime, 'load' | 'loadReference'>;

/** Skill运行状态查询。 */
export interface SkillToolState {
  /** 可请求Skill */
  readonly availableSkills: readonly SkillMetadata[];
  /** 已启用Skill */
  readonly enabledSkills: readonly SkillContent[];
  /** 已读取引用 */
  readonly loadedReferences: readonly SkillReferenceContent[];
  /** 最大引用数 */
  readonly maxReferences: number;
}

/**
 * 创建Skill渐进读取工具
 * @param skills 文件读取能力
 * @param state 系统Skill状态
 * @returns 规范Tool
 */
export function createSkillTool(skills: SkillAccess, state: SkillToolState): CanonicalTool {
  return Tool.make({
    description: '按需启用可见Skill，或读取已启用Skill的references文件。',
    parameters: z
      .object({
        name: z.string().trim().min(1).describe('Skill名称'),
        reference: z.string().trim().min(1).optional().describe('references相对路径'),
      })
      .strict(),
    policy: {
      source: 'skill',
      risk: 'low',
      approval: 'never',
      timeoutMs: 5000,
      consumesBudget: false,
    },
    execute: async (input: { name: string; reference?: string }) => {
      if (input.reference) return await loadReference(skills, state, input.name, input.reference);
      return await loadContent(skills, state, input.name);
    },
  });
}

// 启用本轮可见Skill。
async function loadContent(skills: SkillAccess, state: SkillToolState, name: string) {
  const enabled = state.enabledSkills.find((skill) => skill.metadata.name === name);
  if (enabled) return { success: true, summary: `Skill ${name} 已启用。` };

  if (!state.availableSkills.some((skill) => skill.name === name)) {
    return {
      success: false,
      summary: `Skill ${name} 未出现在本轮可见目录中。`,
      error: 'Skill本轮不可用',
    };
  }

  const skill = await skills.load(name);
  return {
    success: true,
    summary: `已启用Skill ${name}。`,
    effects: [{ type: 'enable_skill' as const, skill }],
  };
}

// 读取已启用Skill引用。
async function loadReference(
  skills: SkillAccess,
  state: SkillToolState,
  name: string,
  path: string,
) {
  const skill = state.enabledSkills.find((item) => item.metadata.name === name);
  if (!skill) {
    return {
      success: false,
      summary: `Skill ${name} 尚未启用，不能读取引用。`,
      error: 'Skill尚未启用',
    };
  }

  const existing = state.loadedReferences.some(
    (item) => item.skill.name === name && item.referencePath === path,
  );
  if (existing) return { success: true, summary: `Skill ${name}引用 ${path} 已读取。` };
  if (state.loadedReferences.length >= state.maxReferences) {
    return {
      success: false,
      summary: `Skill引用读取已达到本轮上限 ${state.maxReferences}。`,
      error: 'Skill引用读取超限',
    };
  }

  const reference = await skills.loadReference(skill, path);
  return {
    success: true,
    summary: `已读取Skill ${name}引用 ${path}。`,
    effects: [{ type: 'load_skill_reference' as const, reference }],
  };
}
