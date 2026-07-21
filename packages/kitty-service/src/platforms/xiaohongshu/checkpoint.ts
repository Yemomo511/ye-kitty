import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { XiaohongshuMentionCheckpoint } from './message';
import type { XiaohongshuMentionCheckpointRepositoryPort } from './store';

/**
 * JSON小红书被提及检查点仓库
 *
 * 先写入同目录临时文件再原子替换，避免进程退出时留下半个JSON。
 * 文件只保存去重ID，不保存Cookie、用户昵称或通知正文。
 */
export class JsonXiaohongshuMentionCheckpointRepository implements XiaohongshuMentionCheckpointRepositoryPort {
  constructor(private readonly filePath: string) {}

  /** 读取并校验检查点，文件不存在表示首次启动 */
  async load(): Promise<XiaohongshuMentionCheckpoint | undefined> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isFileNotFound(error)) return undefined;
      throw error;
    }

    const payload: unknown = JSON.parse(content);
    if (!isCheckpoint(payload)) throw new Error('小红书被提及检查点结构无效');
    return payload;
  }

  /** 原子保存检查点 */
  async save(checkpoint: XiaohongshuMentionCheckpoint): Promise<void> {
    const directory = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}

function isCheckpoint(value: unknown): value is XiaohongshuMentionCheckpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.initialized === true &&
    Array.isArray(candidate.recentMentionIds) &&
    candidate.recentMentionIds.every((id) => typeof id === 'string' && id.length > 0)
  );
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
