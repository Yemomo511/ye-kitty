/** 小红书登录二维码 */
export interface XiaohongshuLoginQrcode {
  /** Base64图片数据 */
  readonly data: string;
  /** 图片类型 */
  readonly mimeType: string;
}

/** 小红书二维码展示能力 */
export interface XiaohongshuQrcodePresenterPort {
  /**
   * 保存并展示二维码
   * @param qrcode 二维码内容
   * @returns 本地文件路径
   */
  present(qrcode: XiaohongshuLoginQrcode): Promise<string>;
}
