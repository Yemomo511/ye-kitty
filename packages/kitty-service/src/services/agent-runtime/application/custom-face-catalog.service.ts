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

/**
 * 自定义表情目录
 *
 * 负责从QQ平台读取自定义表情，调用视觉Agent生成中文描述，并向聊天Agent提供可推荐目录。
 * 刷新过程会触发 NapCat 只读动作和视觉模型请求。
 */
export class CustomFaceCatalogService {
  // 已理解表情缓存
  private faces: DescribedCustomFace[] = [];
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
   * 根据聊天需求推荐表情
   * @param query 聊天Agent的需求
   * @returns 推荐表情
   */
  async recommend(query: CustomFaceQuery = {}): Promise<readonly RecommendedCustomFace[]> {
    const limit = normalizeLimit(query.limit);
    const demand = query.query?.trim();
    const fallbackFaces = this.list({ limit });

    if (!demand) return fallbackFaces;
    if (!this.visionAgent) {
      console.warn(
        `⚠️ [AgentRuntime-CustomFaceCatalog-recommend] 视觉Agent未配置，已返回未过滤表情目录 count=${fallbackFaces.length} demandLength=${demand.length}`,
      );
      return fallbackFaces;
    }

    try {
      const selections = await this.visionAgent.selectFaces(demand, this.faces, limit);
      const recommendedFaces = toRecommendedFaces(this.faces, selections);
      if (recommendedFaces.length > 0) return recommendedFaces;

      console.warn(
        `⚠️ [AgentRuntime-CustomFaceCatalog-recommend] 视觉Agent未推荐可用表情，已返回未过滤目录 count=${fallbackFaces.length} demandLength=${demand.length}`,
      );
      return fallbackFaces;
    } catch (error) {
      console.warn(
        `⚠️ [AgentRuntime-CustomFaceCatalog-recommend] 自定义表情推荐失败，已返回未过滤目录 count=${fallbackFaces.length} demandLength=${demand.length} reason=${formatError(
          error,
        )}`,
      );
      return fallbackFaces;
    }
  }

  /**
   * 确保目录已有数据
   */
  async ensureReady(): Promise<void> {
    if (this.faces.length > 0) return;
    await this.refresh();
  }

  // 执行真实刷新。
  private async refreshNow(): Promise<void> {
    console.info('🚧 [AgentRuntime-CustomFaceCatalog-refresh] 开始刷新QQ自定义表情目录');
    const rawFaces = await this.botClient.fetchCustomFaces();
    const uniqueFaces = dedupeFaces(rawFaces);
    const describedFaces: DescribedCustomFace[] = [];

    for (const face of uniqueFaces) {
      describedFaces.push(await this.describeFace(face));
    }

    this.faces = describedFaces;
    console.info(
      `✅ [AgentRuntime-CustomFaceCatalog-refresh] QQ自定义表情目录刷新完成 count=${describedFaces.length}`,
    );
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

// 按视觉Agent推荐顺序回查真实缓存，避免模型返回不存在的表情ID。
function toRecommendedFaces(
  faces: readonly DescribedCustomFace[],
  selections: readonly { readonly id: string; readonly reason: string; readonly score: number }[],
): readonly RecommendedCustomFace[] {
  const faceById = new Map(faces.map((face) => [face.id, face]));
  const recommendedFaces: RecommendedCustomFace[] = [];
  const seenIds = new Set<string>();

  for (const selection of selections) {
    if (seenIds.has(selection.id)) continue;
    const face = faceById.get(selection.id);
    if (!face) continue;

    seenIds.add(selection.id);
    recommendedFaces.push({
      ...face,
      recommendationReason: selection.reason,
      recommendationScore: selection.score,
    });
  }

  return recommendedFaces;
}

// 限制工具输出规模。
function normalizeLimit(limit: number | undefined): number {
  if (!limit || !Number.isSafeInteger(limit) || limit <= 0) return DEFAULT_CUSTOM_FACE_LIMIT;
  return Math.min(limit, MAX_CUSTOM_FACE_LIMIT);
}

// 脱敏表情ID。
function maskId(value: string): string {
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

// 压缩错误内容。
function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
