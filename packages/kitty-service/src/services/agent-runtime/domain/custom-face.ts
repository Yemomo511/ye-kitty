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

/** 自定义表情查询 */
export interface CustomFaceQuery {
  /** 检索词 */
  readonly query?: string;
  /** 返回上限 */
  readonly limit?: number;
}
