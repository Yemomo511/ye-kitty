import type { QqCustomFaceResource } from '@kitty/platforms/qq/infrastructure/api';

/** 自定义表情视觉描述 */
export interface CustomFaceDescription {
  /** 表情内容 */
  readonly content: string;
  /** 主要情绪 */
  readonly emotion: string;
  /** 适用场景 */
  readonly suitableScenes: readonly string[];
  /** 避免场景 */
  readonly avoidScenes: readonly string[];
  /** 检索标签 */
  readonly tags: readonly string[];
  /** 置信度 */
  readonly confidence: number;
}

/** 已理解的自定义表情 */
export interface DescribedCustomFace extends QqCustomFaceResource, CustomFaceDescription {
  /** 最近理解时间 */
  readonly describedAt: Date;
}

/** 自定义表情推荐结果 */
export interface CustomFaceSelection {
  /** 推荐表情ID */
  readonly id: string;
  /** 推荐理由 */
  readonly reason: string;
  /** 匹配分数 */
  readonly score: number;
}

/** 带推荐理由的自定义表情 */
export interface RecommendedCustomFace extends DescribedCustomFace {
  /** 视觉Agent推荐理由 */
  readonly recommendationReason?: string;
  /** 视觉Agent匹配分数 */
  readonly recommendationScore?: number;
}

/** 自定义表情查询 */
export interface CustomFaceQuery {
  /** 聊天Agent的表情需求 */
  readonly query?: string;
  /** 返回上限 */
  readonly limit?: number;
}
