import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative } from 'node:path';
import type { SkillContent, SkillMetadata } from './skill';

/** Skill引用读取限制。 */
export interface SkillReferenceLimits {
  readonly maxChars: number;
  readonly maxReferencesPerRun: number;
}

/** 已启用Skill的引用内容。 */
export interface SkillReferenceContent {
  readonly skill: SkillMetadata;
  readonly referencePath: string;
  readonly absolutePath: string;
  readonly content: string;
}

/** 读取已启用Skill引用文件的能力。 */
export interface SkillReferenceReader {
  loadSkillReference(skill: SkillContent, referencePath: string): Promise<SkillReferenceContent>;
}

const allowedReferenceExtensions = new Set(['.md', '.txt', '.json']);

/** 默认引用读取限制。 */
export const DEFAULT_SKILL_REFERENCE_LIMITS: SkillReferenceLimits = {
  maxChars: 20 * 1024,
  maxReferencesPerRun: 3,
};

/** 受限读取已启用Skill的references目录。 */
export class SkillReferenceLoader implements SkillReferenceReader {
  constructor(private readonly limits: SkillReferenceLimits = DEFAULT_SKILL_REFERENCE_LIMITS) {}

  /** 校验路径边界并读取引用正文。 */
  async loadSkillReference(
    skill: SkillContent,
    referencePath: string,
  ): Promise<SkillReferenceContent> {
    const normalizedPath = referencePath.trim();
    if (!normalizedPath) throw new Error('Skill引用路径不能为空');
    if (isAbsolute(normalizedPath)) throw new Error('Skill引用路径不能是绝对路径');
    if (normalizedPath.split(/[\\/]+/).includes('..')) {
      throw new Error('Skill引用路径不能包含上级目录');
    }

    const extension = extname(normalizedPath).toLowerCase();
    if (!allowedReferenceExtensions.has(extension)) {
      throw new Error(`Skill引用文件扩展名不允许: ${extension || '无扩展名'}`);
    }

    const referencesRoot = join(skill.metadata.rootPath, 'references');
    const rootRealPath = await realpath(referencesRoot);
    const candidatePath = join(referencesRoot, normalizedPath);
    if ((await lstat(candidatePath)).isSymbolicLink()) throw new Error('Skill引用文件不能是软链接');

    const candidateRealPath = await realpath(candidatePath);
    const relativePath = relative(rootRealPath, candidateRealPath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error('Skill引用文件不能逃逸references目录');
    }

    const candidateStat = await stat(candidateRealPath);
    if (!candidateStat.isFile()) throw new Error('Skill引用路径不是文件');
    if (candidateStat.size > this.limits.maxChars) {
      throw new Error(`Skill引用文件超过大小限制: ${this.limits.maxChars}`);
    }

    const content = await readFile(candidateRealPath, 'utf8');
    if (content.length > this.limits.maxChars) {
      throw new Error(`Skill引用正文超过长度限制: ${this.limits.maxChars}`);
    }

    console.info(
      `✅ [AgentRuntime-Skill] 已读取Skill引用 skill=${skill.metadata.name} reference=${normalizedPath} length=${content.length}`,
    );
    return {
      skill: skill.metadata,
      referencePath: normalizedPath,
      absolutePath: candidateRealPath,
      content,
    };
  }
}
