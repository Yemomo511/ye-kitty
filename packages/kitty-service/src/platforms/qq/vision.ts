import type { QqCustomFaceResource } from '@kitty/platforms/qq/api';
import type { CustomFaceDescription, CustomFaceSelection, DescribedCustomFace } from './face';

/**
 * 自定义表情视觉理解端口
 *
 * 实现方负责把QQ自定义表情图片转换为聊天Agent可读的中文语义描述。
 */
export interface CustomFaceVisionAgentPort {
  /**
   * 理解自定义表情
   * @param face 自定义表情资源
   * @returns 中文描述
   */
  describeFace(face: QqCustomFaceResource): Promise<CustomFaceDescription>;

  /**
   * 选择自定义表情
   * @param demand 聊天Agent的表情需求
   * @param faces 已理解表情目录
   * @param limit 返回上限
   * @returns 推荐结果
   */
  selectFaces(
    demand: string,
    faces: readonly DescribedCustomFace[],
    limit: number,
  ): Promise<readonly CustomFaceSelection[]>;
}
