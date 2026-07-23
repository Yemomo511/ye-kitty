# Ye-Kitty 当前迭代 Task

## 目标

- 将当前“一条 QQ 消息触发一次模型回复”的短链路升级为可审计的 Harness Agent 方案，支持循环观察、工具调用、Skill 加载、工具结果回灌和最终决策。
- 通过兼容市面常见 `.mcp.json` 的通用 MCP Runtime，让 Agent 能在 Harness 治理下发现并调用外部工具。
- 通过 `xpzouying/xiaohongshu-mcp` 完成项目级小红书启动、扫码登录、登录状态检查和 Harness 工具接入。
- 通过上游 `list_mentions`、小红书平台信息源和 Agent Runtime 暂不处理订阅，建立被 `@` 提醒的近实时输入链路。
- 让产品、开发、设计和 Agent 对第二版 Agent Runtime 的边界、分阶段实现、验收口径和唯一入口达成一致。
- 将自定义 JSON Action 工具协议改装为官方 OpenAPI FunctionTool，并把权限、状态、预算、审批和副作用收回系统治理。
- 摧毁当前微服务模块内重复的 application、domain、infrastructure、ports，收敛为 Platforms、Agent Runtime、Shared 三层和 Bootstrap 装配模块。

## 当前状态

- 状态：待验收
- 负责人：Codex
- 最近更新：2026-07-23
- 唯一入口：`design-docs/Agent/openapi-tool-runtime.md`

## 设计拆分

| 模块                         | 设计文档                                                        | 状态   | 进度说明                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kitty Service 三层模块化重构 | `design-docs/Architecture/platform-agent-shared-refactor.md`    | 待验收 | Platforms、Agent Runtime、Shared 与 Bootstrap 已完成迁移；Prompt、Skills、Tools、Schedule、LM、Model Pool 和 Code Agent 均已归入新 owner。旧 `services/contracts/control-plane`、四层目录、兼容入口及旧文件命名全部删除。52 个测试文件已集中至直接所属模块的 `__test__` 目录，并由架构规则禁止散落；`pnpm check` 全量通过：339 项测试和 8 项真实模型评估均通过，等待产品行为验收。        |
| OpenAPI Tool Runtime 改装    | `design-docs/Agent/openapi-tool-runtime.md`                     | 待验收 | 已完成不可伪造 Tool、Zod/JSON Schema 双层校验与不兼容 Schema 隔离、不可变 Registry 快照、官方 `tool()` 投影、统一 `Tool.settle()`、finish、Skill Effect、MCP/Code 迁移、SDK 审批中断和 Model 请求级 429 重试；旧 JSON Action、Schedule、RuntimeTool 与 Executor 已删除。58 项核心测试、311 项全量测试通过，7 个核心文件逐文件四项覆盖率均超过 80%；真实模型评估等待用户授权外发评估内容。 |
| Harness Agent 第二版整体方案 | `design-docs/Agent/agent-runtime-harness.md`                    | 已替代 | 旧自定义 Action/Schedule 方案只保留历史追溯；当前 Agent 使用官方 Runner 工具循环，系统状态与权限边界以 OpenAPI Tool Runtime 文档为准。                                                                                                                                                                                                                                                    |
| QQ 群聊低负载节奏控制        | `design-docs/QQ/chat-time.md`                                   | 待验收 | 将回复后门槛延长为 10-60 分钟与 10-50 条消息；随机片段改为每群每小时一个且只消费一次；冷却期屏蔽随机入口；所有群的未 @ 主动触发共享 2 分钟全局预算，节奏触发后仍强制读取最近 100 条群消息并回复；定向 12 项测试、Lint、类型与架构检查已通过。                                                                                                                                             |
| 模型请求池第一版             | `design-docs/Agent/model-request-pool-v1.md`                    | 待验收 | 已从单个 OpenAI 兼容模型配置演进为模型请求池，由统一调度层负责模型路由、单节点并发、请求间隔、429 退避、队列 TTL 和失败降级；定向模型池单元测试已通过。                                                                                                                                                                                                                                   |
| QQ Harness 准入优先队列      | `design-docs/Agent/qq-harness-admission-queue.md`               | 待验收 | 已实现全局并发 2、等待容量 10、私聊优先于群聊 @ 和未 @ 节奏触发、同会话串行、高优先级满载替换及中文调度日志；19 项定向测试与每文件 80% 覆盖率门槛通过。                                                                                                                                                                                                                                   |
| QQ 默认 Skill 自动注入       | `design-docs/Agent/qq-chat-skill-auto-injection.md`             | 待验收 | QQ 订阅边界已固定预启用 `qq-chat`，正文从 Harness 首轮开始生效并排除重复可请求目录；随后最近消息前置观察把首轮 phase 推进到 `tool_observing`，真实模型 eval 已同步新协议。                                                                                                                                                                                                                |
| Harness 最近消息前置观察     | `design-docs/Agent/harness-recent-messages-auto-observation.md` | 待验收 | 每次 Harness 首轮模型决策前自动执行 `get_recent_messages`，结果直接注入且不消耗模型工具预算；43 项相关测试通过，Harness 行覆盖率 89.29%、分支覆盖率 87.73%、函数覆盖率 100%，Lint、格式、类型和架构检查通过。                                                                                                                                                                             |
| Agent Runtime 通用 MCP 接入  | `design-docs/Agent/mcp-runtime.md`                              | 待验收 | 已迁移为 `ToolSource`：保留 `.mcp.json`、三种传输、多 Server 隔离、公开/内部工具过滤和优雅关闭；公开工具由 `Tool.make()` 封装，低风险进入统一结算，中高风险由官方 SDK 暂停审批，系统内部登录工具不进入模型目录。                                                                                                                                                                          |
| 小红书 MCP 启动与登录        | `design-docs/Agent/xiaohongshu-mcp-bootstrap.md`                | 已完成 | 已完成 QQ/小红书/组合启动、宿主架构镜像选择、Docker 健康检查、13 个工具默认配置、二维码展示、登录轮询和风险分级；60 项定向测试及每文件 80% 覆盖率门槛通过；真实扫码、容器重建、Cookie `0600`、重启登录检查和无环境覆盖启动均验收成功。                                                                                                                                                    |
| 小红书被提及信息源           | `design-docs/Agent/xiaohongshu-mention-event-source.md`         | 待验收 | 已完成固定上游补丁镜像、`list_mentions` 内部工具隔离、平台轮询信息源、持久化检查点和 Agent Runtime 暂不处理订阅。真实登录态已读取 20 条建立基线，30 秒后第二轮约 1.45 秒成功且无重复广播；待人工产生新 `@` 做产品验收。                                                                                                                                                                   |
| Code Agent 通用接入          | `design-docs/code-agent-integration.md`                         | 待验收 | Phase 1 完成：25 源文件 + 8 测试文件 + 1 fixture，63 tests 全绿。Claude Code 2.1.162 + DeepSeek 实测通过（spawn/stdin/SSE/session_end 全链路）。orchestrator 和 session-lifecycle perFile 覆盖率未达 80%，记录为技术债务。                                                                                                                                                                |
| Code Agent Phase 2 (Harness) | `design-docs/code-agent-integration-phase2-plan.md`             | 设计中 | Gateway 审批模型：harness 新增 `delegate_code_agent` 决策分支 + risk 三层门禁（准入/执行/产出）+ code-agent-executor 消费事件流做审批循环；harness prompt 扩展 code agent 能力描述；5 个硬编码点改造。9 个 Task 逐步实施。                                                                                                                                                                |

## 开发顺序

1. 确认 Harness Agent 第二版设计边界，明确 `agent-runtime` 是循环、权限、工具和审计的唯一 owner。
2. 实现最小闭环：QQ 消息进入 Harness，模型请求读取上下文工具，工具结果回灌后输出 `reply`、`ignore` 或 `human_review`。
3. 接入市场 Skill 协议解析和 Ye-Kitty 运行时转换，保证 Skill 只以 `name` 与 `description` 进入首轮目录，正文和引用由模型按需请求。
4. 设计并接入模型请求池，让 Harness 通过统一模型调度层获得结构化决策，避免单个模型入口被并发请求打爆。
5. 在 QQ 节奏门控后增加 Harness 准入队列，限制完整消息处理并发并保证同会话顺序。
6. QQ 消息在进入 Harness 前固定预启用 `qq-chat`，消除重复 `skill_call` 决策。
7. Harness 首轮模型决策前固定读取最近消息，消除重复 `get_recent_messages` 决策。
8. 扩展工具治理、RunTrace、risk/actions 对接、MCP 工具来源和长期记忆工具。
9. 按通用 `.mcp.json` 配置接入多 MCP Server，并把发现和执行统一收敛到 Harness 工具边界。
10. 在项目启动入口增加小红书选项，启动上游 MCP、完成扫码登录检查，并把工具交给同一 Harness 治理。
11. 扩展上游 `list_mentions`，把被提及提醒转换为小红书平台信息源并接入 Agent Runtime 暂不处理边界。
12. 在 `services/llm/` 下构建通用 code agent 接入基建：contracts → domain → infrastructure（json-line-stream + Claude Code/Codex adapter + 探测 + 失败分类）→ application（orchestrator + gate）→ control-plane API；第一消费者交付后验证，第二消费者（harness AgentDecision 集成）独立 PR 跟进。（Phase 1 ✅）
13. 在 `agent-runtime` 中新增 `delegate_code_agent` 决策分支 + Gatekeeper 审批模型：harness prompt 扩展 → risk 三层门禁 → code-agent-executor 审批循环 → harness 管线 5 个硬编码点改造 → QQ 端到端联调。（Phase 2 设计中）
14. 评审三层模块化重构方案，依次迁移 Prompt 与 Agent 命名、Skills/Tools/Schedule、LM/Code Agent、Platforms 和旧骨架，保持每个提交可运行和可回滚。
15. 已建立唯一 Tool、系统结算和官方 FunctionTool 投影，全部工具来源迁移完成，JSON Action、Schedule 与旧 RuntimeTool 执行链已删除。

## 阻塞与风险

| 问题                            | 影响                                                                                  | 下一步                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| risk/actions 正式链路尚未落地   | Harness 的高风险动作只能停留在候选动作设计，不能直接执行完整对外动作                  | MVP 只允许 `reply`、`ignore`、`human_review`、`get_recent_messages` 和 `get_custom_faces` 只读工具，后续在 risk/actions 落地后开放候选动作。 |
| 市场 Skill 扩展字段存在实现差异 | Skill 可能来自 Claude Code、Codex 或其他 Agent Skills 实现，字段支持程度不同          | 采用 Agent Skills 基线字段，未知字段只记录不阻断加载，Ye-Kitty 私有字段统一放入 `metadata.ye-kitty.*`。                                      |
| 工具执行权限边界容易漂移        | 如果模型、Skill 或外部来源绕过系统结算执行工具，会破坏审计和安全边界                  | Registry 只接受 `Tool.make()` 对象；模型只获得官方 FunctionTool 投影；执行必须经过 `Tool.settle()` 和 `AgentRunState.authorize()`。          |
| 模型 429 与队列积压             | 多个 QQ 消息同时触发 Harness 时，单个模型入口可能限流，队列也可能积压旧消息           | 模型请求池按模型节点限制并发和请求间隔，遇到 429 指数退避；聊天请求必须配置 TTL，过期后降级或丢弃。                                          |
| 模型配置迁移                    | 从单组 `OPENAI_BASE_URL` 迁移到 N 个模型节点时，配置缺失或格式错误会影响 Harness 启动 | 第一版保留单模型配置兼容路径，模型池配置存在且合法时才优先启用模型池。                                                                       |
| 本地 WebSocket 测试依赖端口权限 | 沙箱内监听会触发 `EPERM`，可能造成与业务无关的假失败                                  | 在获准的沙箱外环境复跑全量测试；本次 311 项测试已全部通过。                                                                                  |
| MCP 配置等同本机执行授权        | 项目级 stdio Server 可以启动本地命令，远端 Header 可以读取环境变量                    | 只加载明确发现或显式指定的配置；日志不输出敏感值；工具默认 `medium`，只有显式 `low` 才允许自主执行。                                         |
| 小红书 MCP 依赖 Docker          | 本机缺少 Docker、镜像拉取失败或 18060 端口冲突会阻断小红书启动                        | 不自动安装环境；启动失败输出 Compose 与日志命令；QQ 单独启动不受影响。                                                                       |
| 小红书 MCP 无内置鉴权           | 宿主机把 18060 暴露到局域网或公网后，其他设备可能直接调用写工具                       | Compose 默认只绑定 `127.0.0.1`；远程访问必须显式修改并在外层增加鉴权。                                                                       |
| 小红书 Cookie 文件权限          | 上游默认写出 `0644` 时，同机其他系统用户可能读取登录凭据                              | 容器入口将已有 Cookie 收紧到 `0600`，并设置 `umask 077` 保护后续文件。                                                                       |
| 小红书通知接口属于网页内部能力  | 页面路径、响应结构或签名链路变化会导致 `list_mentions` 失效                           | 固定上游提交，通过页面自身请求读取并做结构校验；失败时退避且不发布不完整事件。                                                               |
| 被提及内容包含提示注入          | 外部用户可以在 @内容中编写针对 Agent 的恶意指令                                       | 本期事件只到 Agent Runtime 订阅边界并明确跳过，不进入 Harness Prompt。                                                                       |
| 架构迁移与 Phase 2 开发冲突     | Code Agent Harness 接入若继续修改旧路径，会制造重复迁移和合并冲突                     | 先迁移完整 Code Agent 模块，后续 Phase 2 只在新路径开发；迁移提交不得顺带改业务算法。                                                        |

## 验收总览

- 产品验收：收到 QQ 消息后，Agent 能根据上下文决定回复、静默或转人工，而不是每条消息都直接生成回复。
- 开发验收：`agent-runtime` 使用官方 Runner 循环、规范 Tool 注册与结算、最小 Prompt 投影、LM 请求级调度和 `finish` 可信终态。
- 设计验收：Prompt、Skill、Tool、LM、权限、审批、日志和最终动作边界在设计文档中有清晰信息结构，能支撑后续控制面展示。
- Agent 验收：`design-docs/Task.md`、三层重构方案和文件命名迁移表状态一致，后续代码实现、测试和进度必须同步回写。
- 架构验收：目录收敛为 Platforms、Agent Runtime、Shared 三层和 Bootstrap 装配模块；Prompt、Skills、Tools、LM 边界清晰；旧 Schedule/Action/RuntimeTool、application、domain、infrastructure、ports、Harness 文件名、平台重复前缀、跨层深层 import 和依赖环均为零。Lint、本次文件格式、架构、类型与 311 项全量测试已通过；根 `pnpm check` 的真实模型评估等待用户授权，且全仓格式检查仍会报告本次范围外的 `AGENTS.md` 既有差异。

## 变更记录

| 日期       | 变更                                        | 原因                                                                                                          |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-07-23 | 落地 OpenAPI Tool Runtime                   | 全部工具迁移到官方 FunctionTool 投影和系统结算，删除模型可控 JSON Action、Schedule 与旧 Executor。            |
| 2026-07-21 | 集中模块测试目录并启用架构校验              | 将 52 个测试文件迁入直接所属模块的 `__test__`，统一测试发现方式并阻止后续测试重新散落。                       |
| 2026-07-23 | 设计 OpenAPI Tool Runtime                   | 参考 opencode 与官方 Agents SDK，明确模型最小投影、系统结算、finish、审批和 Model 请求级故障转移边界。        |
| 2026-07-21 | 完成三层架构迁移并启用严格校验              | Platforms、Agent Runtime、Shared 和 Bootstrap 全部就位，旧目录、兼容入口与冗余文件命名清零。                  |
| 2026-07-21 | 迁移 LM、Model Pool 与 Code Agent           | Agent 只依赖 LM；Code Agent 收进 LM 子模块，并作为统一 code Tool 接入 Schedule。                              |
| 2026-07-21 | 迁移 Agent 并统一 Action 调度循环           | Agent 主循环只消费 AgentAction，所有 Skill 与普通工具调用均通过 Schedule 执行。                               |
| 2026-07-21 | 迁移 Skills 并接入统一 Tool                 | 删除 Skill 的 application/domain/infrastructure/ports 文件，以目录、正文、引用三级渐进读取能力接入 Schedule。 |
| 2026-07-21 | 开始执行三层模块化重构阶段 0                | 先建立目标模块入口、依赖方向测试和旧结构递减额度，阻止迁移期间继续增加四层目录与旧命名。                      |
| 2026-07-21 | 收敛为 Platform、Agent、Shared 三层         | 用户确认平台消息、Agent 执行和共享三层，并要求新增 Prompt、Schedule、LM 及统一文件命名方案。                  |
| 2026-07-21 | 废弃六层方案并改为扁平能力模块              | 用户明确要求彻底删除 application、domain、infrastructure、ports，而不是把服务内分层翻转成全局分层。           |
| 2026-07-21 | 新增 Kitty Service 分层模块化重构方案       | 当前微服务四层骨架与真实单体运行方式不匹配，需要按运行职责分层并收紧跨层依赖。                                |
| 2026-07-06 | 新增 Harness Agent 第二版任务入口和进度拆分 | 将循环观察、工具调用和市场 Skill 协议对齐方案同步为团队进度。                                                 |
| 2026-07-06 | 完成 Harness Agent MVP 实现                 | 新增 Harness 循环、OpenAI Harness Runner、进程内最近消息工具、Prompt 分层治理和 Skill 扩展字段。              |
| 2026-07-06 | 优化 Harness System Prompt                  | 强化系统级约束、外部环境感知触发、Skill/Tool 边界和安全合规风险收束。                                         |
| 2026-07-06 | 补充 Skill 调用协议                         | 新增 `skill_call` JSON 格式，让模型能用结构化方式请求 Harness 确认 Skill 状态。                               |
| 2026-07-06 | 实现 Skill 渐进式注入                       | 首轮只提供 Skill 目录，模型请求后由 Harness 按需读取正文并注入下一轮上下文。                                  |
| 2026-07-06 | 完成平台无关 Skill MVP                      | 移除 Skill 操作中的 QQ 命名，目录仅展示 `name`/`description`，正文和 reference 进入 Observation。             |
| 2026-07-07 | 重构 Skill 外界上下文生态位                 | 将 Skill Prompt 与 Tool Prompt 从 SystemPrompt 抽离到第二章 Outside Context，并用结构化文档注入。             |
| 2026-07-07 | 新增 QQ 商城表情回复动作                    | 基于 NapCat `mface` 消息段扩展 `reply.actions` 白名单，允许 Agent 在 QQ 回复中发送受控商城表情。              |
| 2026-07-07 | 修正 QQ 群聊响应与互动动作                  | 群聊仅在 @ 叶猫猫时触发 Agent，戳一戳独占回复，QQ 内置表情支持与文本同条消息混排。                            |
| 2026-07-07 | 提升 Harness 循环轮次                       | 将 QQ Agent Harness 默认最大循环次数从 4 次提升到 100 次，支持更长的 Skill/Tool 观察链路。                    |
| 2026-07-07 | 修复 QQ 群聊重复回复                        | 当模型同时输出 `reply.text` 和同内容文本动作时，执行层只发送一次，避免群聊重复刷屏。                          |
| 2026-07-07 | 设计统一 send_msg 回复结构                  | 基于 NapCat WebUI 调试页确认 `send_msg` 参数，规划用统一 OneBot 11 消息段替代分散 QQ 发送动作。               |
| 2026-07-07 | 约束消息发送统一 send_msg                   | 平台执行层不再调用 `send_group_msg` 或 `send_private_msg`，所有普通 QQ 消息统一发 NapCat `send_msg`。         |
| 2026-07-07 | 新增自定义表情自主回复                      | 通过 `fetch_custom_face`、视觉 Agent 和 `get_custom_faces` 工具，让聊天 Agent 能自主选择自定义表情。          |
| 2026-07-07 | 调整自定义表情推荐链路                      | `get_custom_faces` 不再做文本命中，改由聊天 Agent 基于启动期缓存描述自行选择候选。                            |
| 2026-07-08 | 固化自定义表情启动期缓存                    | `get_custom_faces` 只读取启动期缓存，不在聊天过程中重新拉取、理解或视觉推荐自定义表情。                       |
| 2026-07-08 | 修复自定义表情降级兜底                      | 自定义表情目录刷新、视觉理解或工具读取失败时返回中文降级观察，避免聊天 Harness 中断。                         |
| 2026-07-07 | 新增 QQ 引用提醒回复                        | 所有 Agent 普通 `send_msg` 回复由执行层自动引用触发消息并 @ 当前发送者，模型不能手写任意引用消息。            |
| 2026-07-08 | 调整自定义表情拆分发送                      | 文字消息保留引用和 @，自定义表情 `image` 段单独发送，避免表情消息重复提醒。                                   |
| 2026-07-08 | 优化 Prompt 宪法与状态机                    | 参考 DeepAgents 状态分层思想，将 Harness System Prompt 拆为宪法、状态机和行动契约，并新增显式状态快照。       |
| 2026-07-08 | 调整 Prompt 第二章位置                      | 第二章 Outside Context 改由 instructions 维护，第三章 input 只保留每轮 Agent 循环观察。                       |
| 2026-07-08 | 新增 QQ 群聊节奏回复计时计数器              | 群聊消息先进入共享消息池，未 @ 群聊按随机片段或回复后爆发计数触发强制回复，最近消息工具群聊窗口改为 100 条。  |
| 2026-07-09 | 新增模型请求池第一版设计                    | 规划统一模型调度层，解决单模型入口在多消息并发、429 限流和队列积压下不稳定的问题。                            |
| 2026-07-09 | 实现模型请求池第一版                        | 新增 `YE_KITTY_MODEL_POOL`、进程内模型调度层、单模型独立队列、并发节流和 429 模型级退避。                     |
| 2026-07-14 | 收紧 QQ 群聊主动回复速率                    | 当前并发负载无法承受旧版高频节奏，延长回复后门槛并增加片段单次消费、冷却优先和跨群主动预算。                  |
| 2026-07-14 | 设计 QQ Harness 准入优先队列                | 在节奏门控与 Harness 之间增加消息级并发治理，优先保护私聊和明确 @，并保证同会话回复顺序。                     |
| 2026-07-14 | 实现 QQ Harness 准入优先队列                | 完成准入端口、进程内调度器、订阅器与启动装配，覆盖率和相关回归测试通过。                                      |
| 2026-07-15 | 开发 QQ 默认 Skill 自动注入                 | `qq-chat` 是 QQ 消息的固定方法论，不再由模型逐消息重复决策是否启用。                                          |
| 2026-07-15 | 实现最近消息前置观察                        | 最近消息成为每次 Harness 首轮决策前的固定运行观察，避免模型重复消耗一次工具决策。                             |
| 2026-07-16 | 设计 Agent Runtime 通用 MCP 接入            | 参考 LangGraph 和 Deep Agents，确定 `.mcp.json` 兼容、多 Server 生命周期和 Harness 风险治理边界。             |
| 2026-07-16 | 实现 Agent Runtime 通用 MCP 接入            | 复用 OpenAI Agents SDK 传输层，把多 MCP 工具统一接入 Harness 注册、预算、风险判断和观察回灌。                 |
| 2026-07-16 | 设计小红书 MCP 启动与登录                   | 以项目启动选项编排上游 Docker、MCP 登录二维码、状态检查和 Harness 风险工具目录。                              |
| 2026-07-16 | 实现小红书 MCP 启动与登录                   | 完成项目启动选择、上游容器编排、二维码扫码、状态轮询、工具风险配置和使用文档。                                |
| 2026-07-16 | 验收小红书 MCP 真实登录                     | Apple Silicon 自动选择 ARM64 镜像，扫码与重启登录检查成功，13 个工具可见，Cookie 权限为 `0600`。              |
| 2026-07-16 | 设计小红书被提及信息源                      | 确定上游 `list_mentions` 内部工具、平台轮询与检查点、Agent Runtime 暂不处理订阅和组合启动生命周期。           |
| 2026-07-16 | 落地小红书被提及信息源                      | 内部工具、轮询去重、检查点和暂不处理订阅已完成；真实 MCP 发现 14 个工具且只向 Harness 公开 13 个。            |
