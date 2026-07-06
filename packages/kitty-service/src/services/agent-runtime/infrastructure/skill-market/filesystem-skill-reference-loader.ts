import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative } from 'node:path';
import type { SkillContent } from '../../domain/skill';
import type { SkillReferenceContent, SkillReferenceLimits } from '../../domain/skill-reference';
import type { SkillReferenceLoaderPort } from '../../ports/skill-reference-loader.port';

const allowedReferenceExtensions = new Set(['.md', '.txt', '.json']);

/** 默认引用读取限制 */
export const DEFAULT_SKILL_REFERENCE_LIMITS: SkillReferenceLimits = {
  maxChars: 20 * 1024,
  maxReferencesPerRun: 3,
};

/**
 * 文件系统Skill引用加载器
 *
 * 只读取已启用 Skill 的 references 目录，避免 Skill 引用能力退化为任意文件读取。
 */
export class FilesystemSkillReferenceLoader implements SkillReferenceLoaderPort {
  constructor(private readonly limits: SkillReferenceLimits = DEFAULT_SKILL_REFERENCE_LIMITS) {}

  /**
   * 加载Skill引用文件
   * @param skill 已启用Skill
   * @param referencePath 引用路径
   * @returns 引用正文
   */
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
    const candidateLinkStat = await lstat(candidatePath);
    if (candidateLinkStat.isSymbolicLink()) throw new Error('Skill引用文件不能是软链接');

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
      `✅ [AgentRuntime-SkillReferenceLoader] 已读取Skill引用 skill=${skill.metadata.name} reference=${normalizedPath} length=${content.length}`,
    );
    return {
      skill: skill.metadata,
      referencePath: normalizedPath,
      absolutePath: candidateRealPath,
      content,
    };
  }
}
