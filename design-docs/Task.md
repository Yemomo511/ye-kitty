# Ye-Kitty Harness Agent 第二版 Task

## 目标

- 将当前“一条 QQ 消息触发一次模型回复”的短链路升级为可审计的 Harness Agent 方案，支持循环观察、工具调用、Skill 加载、工具结果回灌和最终决策。
- 让产品、开发、设计和 Agent 对第二版 Agent Runtime 的边界、分阶段实现、验收口径和唯一入口达成一致。

## 当前状态

- 状态：待验收
- 负责人：Codex
- 最近更新：2026-07-07
- 唯一入口：`design-docs/Agent/agent-runtime-harness.md`

## 设计拆分

| 模块                         | 设计文档                                     | 状态   | 进度说明                                                                                                                                                                                                                |
| ---------------------------- | -------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harness Agent 第二版整体方案 | `design-docs/Agent/agent-runtime-harness.md` | 待验收 | MVP 已实现 Harness 主循环、`get_recent_messages`、`get_custom_faces`、Prompt 三章治理、Outside Context Prompt、平台无关 Skill 目录、结构化 Skill 文档、`skill_call`、`skill_reference_call` 和 `references/` 按需读取。 |

## 开发顺序

1. 确认 Harness Agent 第二版设计边界，明确 `agent-runtime` 是循环、权限、工具和审计的唯一 owner。
2. 实现最小闭环：QQ 消息进入 Harness，模型请求读取上下文工具，工具结果回灌后输出 `reply`、`ignore` 或 `human_review`。
3. 接入市场 Skill 协议解析和 Ye-Kitty 运行时转换，保证 Skill 只以 `name` 与 `description` 进入首轮目录，正文和引用由模型按需请求。
4. 扩展工具治理、RunTrace、risk/actions 对接、MCP 工具来源和长期记忆工具。

## 阻塞与风险

| 问题                            | 影响                                                                                                  | 下一步                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| risk/actions 正式链路尚未落地   | Harness 的高风险动作只能停留在候选动作设计，不能直接执行完整对外动作                                  | MVP 只允许 `reply`、`ignore`、`human_review`、`get_recent_messages` 和 `get_custom_faces` 只读工具，后续在 risk/actions 落地后开放候选动作。 |
| 市场 Skill 扩展字段存在实现差异 | Skill 可能来自 Claude Code、Codex 或其他 Agent Skills 实现，字段支持程度不同                          | 采用 Agent Skills 基线字段，未知字段只记录不阻断加载，Ye-Kitty 私有字段统一放入 `metadata.ye-kitty.*`。                                      |
| 工具执行权限边界容易漂移        | 如果模型或 Skill 绕过 Harness 执行工具，会破坏审计和安全边界                                          | 工具执行只能经过 `ToolExecutor`，权限判断只能经过 `PermissionPolicy`，外发动作必须进入 risk/actions。                                        |
| 本地 WebSocket 监听受限         | `pnpm check` 中 OneBot WebSocket 测试在当前环境触发 `listen EPERM: operation not permitted 127.0.0.1` | Harness 相关定向测试已通过，完整校验结果中单独记录该环境限制。                                                                               |

## 验收总览

- 产品验收：收到 QQ 消息后，Agent 能根据上下文决定回复、静默或转人工，而不是每条消息都直接生成回复。
- 开发验收：`agent-runtime` 内存在可测试的 Harness 主循环、工具注册、权限判断、工具执行和运行记录端口。
- 设计验收：Skill、工具、权限、日志和最终动作边界在设计文档中有清晰信息结构，能支撑后续控制面展示。
- Agent 验收：`design-docs/Task.md` 和 `design-docs/Agent/agent-runtime-harness.md` 状态一致，后续代码实现、测试和进度必须同步回写。

## 变更记录

| 日期       | 变更                                        | 原因                                                                                                  |
| ---------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 2026-07-06 | 新增 Harness Agent 第二版任务入口和进度拆分 | 将循环观察、工具调用和市场 Skill 协议对齐方案同步为团队进度。                                         |
| 2026-07-06 | 完成 Harness Agent MVP 实现                 | 新增 Harness 循环、OpenAI Harness Runner、进程内最近消息工具、Prompt 分层治理和 Skill 扩展字段。      |
| 2026-07-06 | 优化 Harness System Prompt                  | 强化系统级约束、外部环境感知触发、Skill/Tool 边界和安全合规风险收束。                                 |
| 2026-07-06 | 补充 Skill 调用协议                         | 新增 `skill_call` JSON 格式，让模型能用结构化方式请求 Harness 确认 Skill 状态。                       |
| 2026-07-06 | 实现 Skill 渐进式注入                       | 首轮只提供 Skill 目录，模型请求后由 Harness 按需读取正文并注入下一轮上下文。                          |
| 2026-07-06 | 完成平台无关 Skill MVP                      | 移除 Skill 操作中的 QQ 命名，目录仅展示 `name`/`description`，正文和 reference 进入 Observation。     |
| 2026-07-07 | 重构 Skill 外界上下文生态位                 | 将 Skill Prompt 与 Tool Prompt 从 SystemPrompt 抽离到第二章 Outside Context，并用结构化文档注入。     |
| 2026-07-07 | 新增 QQ 商城表情回复动作                    | 基于 NapCat `mface` 消息段扩展 `reply.actions` 白名单，允许 Agent 在 QQ 回复中发送受控商城表情。      |
| 2026-07-07 | 修正 QQ 群聊响应与互动动作                  | 群聊仅在 @ 叶猫猫时触发 Agent，戳一戳独占回复，QQ 内置表情支持与文本同条消息混排。                    |
| 2026-07-07 | 提升 Harness 循环轮次                       | 将 QQ Agent Harness 默认最大循环次数从 4 次提升到 100 次，支持更长的 Skill/Tool 观察链路。            |
| 2026-07-07 | 修复 QQ 群聊重复回复                        | 当模型同时输出 `reply.text` 和同内容文本动作时，执行层只发送一次，避免群聊重复刷屏。                  |
| 2026-07-07 | 设计统一 send_msg 回复结构                  | 基于 NapCat WebUI 调试页确认 `send_msg` 参数，规划用统一 OneBot 11 消息段替代分散 QQ 发送动作。       |
| 2026-07-07 | 约束消息发送统一 send_msg                   | 平台执行层不再调用 `send_group_msg` 或 `send_private_msg`，所有普通 QQ 消息统一发 NapCat `send_msg`。 |
| 2026-07-07 | 新增自定义表情自主回复                      | 通过 `fetch_custom_face`、视觉 Agent 和 `get_custom_faces` 工具，让聊天 Agent 能自主选择自定义表情。  |
| 2026-07-07 | 调整自定义表情推荐链路                      | `get_custom_faces` 不再做文本命中，改由视觉 Agent 根据聊天需求和表情描述推荐候选。                    |
