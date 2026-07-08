import type { QqBotClientPort } from '@kitty/platforms/qq/ports/qq-bot-client.port';
import type { QqCustomFaceResource } from '@kitty/platforms/qq/infrastructure/api';
import type {
  CustomFaceQuery,
  DescribedCustomFace,
  RecommendedCustomFace,
} from '../domain/custom-face';
import type { CustomFaceVisionAgentPort } from '../ports/custom-face-vision-agent.port';

/** 默认表情目录返回上限 */
const DEFAULT_CUSTOM_FACE_LIMIT = 30;
/** 最大表情目录返回上限 */
const MAX_CUSTOM_FACE_LIMIT = 100;

/** 自定义表情目录状态 */
export type CustomFaceCatalogStatus = 'idle' | 'refreshing' | 'ready' | 'failed';

/** 自定义表情目录快照 */
export interface CustomFaceCatalogSnapshot {
  /** 当前状态 */
  readonly status: CustomFaceCatalogStatus;
  /** 最后刷新成功时间 */
  readonly refreshedAt?: Date;
  /** 最后失败原因 */
  readonly lastFailureReason?: string;
  /** 已缓存表情数量 */
  readonly faceCount: number;
}

/**
 * 自定义表情目录
 *
 * 负责从QQ平台读取自定义表情，调用视觉Agent生成中文描述，并向聊天Agent提供可推荐目录。
 * 只有刷新过程会触发 NapCat 只读动作和视觉模型请求，聊天期只读取内存缓存。
 */
export class CustomFaceCatalogService {
  // 已理解表情缓存
  private faces: DescribedCustomFace[] = [];
  // 当前目录状态
  private status: CustomFaceCatalogStatus = 'idle';
  // 最后成功刷新时间
  private refreshedAt?: Date;
  // 最近一次刷新失败原因
  private lastFailureReason?: string;
  // 防止重复刷新
  private refreshTask?: Promise<void>;

  constructor(
    private readonly botClient: QqBotClientPort,
    private readonly visionAgent?: CustomFaceVisionAgentPort,
  ) {}

  /**
   * 刷新自定义表情目录
   */
  async refresh(): Promise<void> {
    if (this.refreshTask) return await this.refreshTask;

    this.refreshTask = this.refreshNow();
    try {
      await this.refreshTask;
    } finally {
      this.refreshTask = undefined;
    }
  }

  /**
   * 查询已理解表情
   * @param query 查询条件
   * @returns 表情目录
   */
  list(query: CustomFaceQuery = {}): readonly DescribedCustomFace[] {
    const limit = normalizeLimit(query.limit);
    return this.faces.slice(0, limit);
  }

  /**
   * 读取目录快照
   * @returns 当前目录状态
   */
  getSnapshot(): CustomFaceCatalogSnapshot {
    return {
      status: this.status,
      refreshedAt: this.refreshedAt,
      lastFailureReason: this.lastFailureReason,
      faceCount: this.faces.length,
    };
  }

  /**
   * 读取启动期缓存表情
   * @param query 聊天Agent的需求
   * @returns 缓存表情
   */
  async recommend(query: CustomFaceQuery = {}): Promise<readonly RecommendedCustomFace[]> {
    const limit = normalizeLimit(query.limit);
    const demand = query.query?.trim();
    const fallbackFaces = this.list({ limit });

    if (demand) {
      console.info(
        `✅ [AgentRuntime-CustomFaceCatalog-recommend] 已读取启动期缓存目录 count=${fallbackFaces.length} demandLength=${demand.length} status=${this.status}`,
      );
    }

    return fallbackFaces;
  }

  // 执行真实刷新。
  private async refreshNow(): Promise<void> {
    this.status = 'refreshing';
    console.info('🚧 [AgentRuntime-CustomFaceCatalog-refresh] 开始刷新QQ自定义表情目录');
    try {
      const rawFaces = await this.botClient.fetchCustomFaces();
      const uniqueFaces = dedupeFaces(rawFaces);
      const describedFaces: DescribedCustomFace[] = [];

      for (const face of uniqueFaces) {
        describedFaces.push(await this.describeFace(face));
      }

      this.faces = describedFaces;
      this.status = 'ready';
      this.refreshedAt = new Date();
      this.lastFailureReason = undefined;
      console.info(
        `✅ [AgentRuntime-CustomFaceCatalog-refresh] QQ自定义表情目录刷新完成 count=${describedFaces.length}`,
      );
    } catch (error) {
      const reason = formatError(error);
      this.status = 'failed';
      this.lastFailureReason = reason;
      console.warn(
        `⚠️ [AgentRuntime-CustomFaceCatalog-refresh] QQ自定义表情目录刷新失败，已保留旧缓存 count=${this.faces.length} reason=${reason}`,
      );
      throw error;
    }
  }

  // 对单个表情生成描述；视觉失败时使用平台摘要降级。
  private async describeFace(face: QqCustomFaceResource): Promise<DescribedCustomFace> {
    try {
      if (!this.visionAgent) {
        return toFallbackDescription(face, '视觉Agent未配置');
      }

      const description = await this.visionAgent.describeFace(face);
      return {
        ...face,
        ...description,
        describedAt: new Date(),
      };
    } catch (error) {
      console.warn(
        `⚠️ [AgentRuntime-CustomFaceCatalog-describeFace] 自定义表情理解失败，已使用平台摘要降级 faceId=${maskId(
          face.id,
        )} reason=${formatError(error)}`,
      );
      return toFallbackDescription(face, formatError(error));
    }
  }
}

// 根据可发送资源去重，避免同一图片重复占用上下文。
function dedupeFaces(faces: readonly QqCustomFaceResource[]): readonly QqCustomFaceResource[] {
  const seenFiles = new Set<string>();
  const uniqueFaces: QqCustomFaceResource[] = [];

  for (const face of faces) {
    if (seenFiles.has(face.file)) continue;
    seenFiles.add(face.file);
    uniqueFaces.push(face);
  }

  return uniqueFaces;
}

// 视觉能力不可用时生成保守描述。
function toFallbackDescription(face: QqCustomFaceResource, reason: string): DescribedCustomFace {
  const content = face.summary ?? face.name ?? '未理解的自定义表情';
  return {
    ...face,
    content,
    emotion: '未知',
    suitableScenes: face.summary || face.name ? [content] : [],
    avoidScenes: ['严肃通知', '敏感话题'],
    tags: [content, reason].filter(Boolean),
    confidence: 0.2,
    describedAt: new Date(),
  };
}

// 限制工具输出规模。
function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isSafeInteger(limit) || limit <= 0) return DEFAULT_CUSTOM_FACE_LIMIT;
  return Math.min(limit, MAX_CUSTOM_FACE_LIMIT);
}

// 压缩错误内容。
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// 脱敏表情ID。
function maskId(value: string): string {
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}
