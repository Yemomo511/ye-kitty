/**
 * Code Agent Registry Port
 *
 * 查询本地可用的 code agent 及其能力信息。
 */

/** Code Agent 能力信息（对外开放的只读视图，AgentDef 的能力投影） */
export interface CodeAgentCapability {
  /** 与 AgentDef.id 一致 */
  readonly id: string;
  /** 人类可读名称 */
  readonly name: string;
  /** 探测结果（当前是否可用） */
  readonly available: boolean;
  /** 版本号（探测成功时） */
  readonly version?: string;
  /** 不可用原因（探测失败时的诊断文本，含可操作建议） */
  readonly unavailableReason?: string;
  /** 是否支持指定工作目录 */
  readonly supportsWorkdir: boolean;
  /** 是否支持图片输入 */
  readonly supportsImagePaths: boolean;
  /** 支持的 resume 模式（MVP 恒为空数组） */
  readonly resumeModes: readonly string[];
}

export interface CodeAgentRegistryPort {
  /** 列出所有已注册 agent 的能力信息（含可用性、版本、诊断） */
  listAgents(): Promise<readonly CodeAgentCapability[]>;

  /** 按 id 查找单个 agent 的能力信息 */
  getAgent(id: string): Promise<CodeAgentCapability | undefined>;

  /** 重新探测本地 CLI 可用性（清除缓存） */
  refresh(): Promise<void>;
}
