# Kitty Service 文件命名迁移表

## 使用方式

本文档是 [`platform-agent-shared-refactor.md`](./platform-agent-shared-refactor.md) 的文件级迁移清单。迁移源码前必须先确认当前文件的真实职责；表中目标是默认归属，不得为了机械对齐保留错误边界。

统一规则：

- 目录提供上下文，文件名不重复目录名。
- 删除 `harness`、`service`、`factory`、`adapter`、`port`、`contract`、`controller` 等架构角色后缀。
- 删除平台目录内的 `qq`、`xiaohongshu`、`onebot` 重复前缀。
- 删除 `lm/code-agent` 内的 `code-agent` 重复前缀。
- 测试与被测源文件同名并使用 `.test.ts`。
- 多个旧文件可以合并到同一个新文件；空骨架和无调用方抽象直接删除。

## Bootstrap

| 当前文件或职责                   | 目标文件                          | 说明                                       |
| -------------------------------- | --------------------------------- | ------------------------------------------ |
| Runtime 环境读取                 | `bootstrap/environment.ts`        | 统一读取进程环境。                         |
| 启动模式与平台选择               | `bootstrap/platform.ts`           | 只负责选择和装配 Platform。                |
| MCP 装配                         | `bootstrap/tools.ts`              | MCP 作为 Tool 装配。                       |
| Model Pool 与 Code Agent 装配    | `bootstrap/lm.ts`                 | LM 的唯一装配入口。                        |
| Agent Runtime 装配               | `bootstrap/agent.ts`              | 连接 Platform、Agent、Tools 和 LM。        |
| 小红书 Docker 启动               | `platforms/xiaohongshu/docker.ts` | 平台自身生命周期。                         |
| `service-registry.ts`            | 删除                              | 不再使用 Service Locator。                 |
| `scripts/start-qq.ts` 等平台脚本 | `bootstrap/start.ts`              | 脚本改为参数转发，不保留多套业务启动逻辑。 |

## Shared 与旧 Contracts

| 当前文件或职责                                    | 目标文件                                          | 说明                           |
| ------------------------------------------------- | ------------------------------------------------- | ------------------------------ |
| 稳定 ID                                           | `shared/ids.ts`                                   | 只保留跨层 ID。                |
| Logger 接口                                       | `shared/logger.ts`                                | 共享最小日志能力。             |
| 日志辅助                                          | `shared/logging.ts`                               | 不包含业务流程。               |
| 通用错误序列化                                    | `shared/error.ts`                                 | 不包含供应商或平台语义。       |
| Chat Event                                        | `platforms/message.ts`                            | 消息公共语言由 Platform 拥有。 |
| 小红书 Mention Event                              | `platforms/xiaohongshu/message.ts`                | 平台特有事件不进入 Shared。    |
| Outgoing Action                                   | `platforms/action.ts`                             | 平台动作公共语言。             |
| Code Agent Contracts                              | `agent-runtime/lm/code-agent/task.ts`、`event.ts` | 由 Code Agent 子模块拥有。     |
| EventBus、Repository、ServiceModule、UseCase 抽象 | 删除或移入真实 owner                              | 不保留全局架构抽象。           |

## Platforms 公共文件

| 当前文件或职责           | 目标文件               | 说明                        |
| ------------------------ | ---------------------- | --------------------------- |
| `PlatformMessageService` | `platforms/channel.ts` | 使用 Channel 表达订阅能力。 |
| 平台公共消息结构         | `platforms/message.ts` | Agent 只接收该结构。        |
| 平台公共动作结构         | `platforms/action.ts`  | Agent 只调用该结构。        |
| 平台导出                 | `platforms/index.ts`   | 公开消息、动作与 Channel。  |

## QQ 与 OneBot

| 当前文件或职责               | 目标文件                         | 说明                               |
| ---------------------------- | -------------------------------- | ---------------------------------- |
| `qq-message.ts`              | `platforms/qq/message.ts`        | 目录已表达 QQ。                    |
| `onebot-v11.ts`              | `platforms/qq/onebot/schema.ts`  | 协议结构集中。                     |
| Bot Client Port              | `platforms/qq/client.ts`         | 去掉 Port 后缀。                   |
| OneBot Bot Client            | `platforms/qq/onebot/client.ts`  | OneBot 具体实现。                  |
| OneBot WebSocket Server      | `platforms/qq/onebot/server.ts`  | 目录已表达协议。                   |
| OneBot External Action       | `platforms/qq/onebot/action.ts`  | 原始协议动作。                     |
| QQ External Action           | `platforms/qq/action.ts`         | QQ 语义动作。                      |
| OneBot Event Ingress         | `platforms/qq/onebot/ingress.ts` | 原始事件入口。                     |
| QQ Event Ingress             | `platforms/qq/ingress.ts`        | 转为 PlatformMessage。             |
| Experiment Channel           | `platforms/qq/channel.ts`        | QQ 消息订阅实现。                  |
| QQ Factory                   | `platforms/qq/runtime.ts`        | 只在确有多个协作者时保留聚合对象。 |
| Group Cadence                | `platforms/qq/cadence.ts`        | 去掉 Service/Port。                |
| Admission Queue              | `platforms/qq/queue.ts`          | 去掉 Service/Port。                |
| Custom Face Catalog          | `platforms/qq/faces.ts`          | 平台数据与 `tools/faces.ts` 分开。 |
| Visual Agent Interface       | `platforms/qq/vision.ts`         | 视觉消息适配留在平台。             |
| Reply Executor、Reply Action | `platforms/qq/reply.ts`          | 合并同一回复流程。                 |
| Reply Event Subscriber       | `agent-runtime/subscriber.ts`    | Agent 主动订阅 Platform。          |

## 小红书

| 当前文件或职责        | 目标文件                              | 说明                      |
| --------------------- | ------------------------------------- | ------------------------- |
| Mention Domain Object | `platforms/xiaohongshu/message.ts`    | 目录已表达平台。          |
| Mention Source        | `platforms/xiaohongshu/source.ts`     | 消息来源。                |
| Source Factory        | `platforms/xiaohongshu/runtime.ts`    | 只保留实际装配逻辑。      |
| Mention Reader        | `platforms/xiaohongshu/reader.ts`     | 平台读取流程。            |
| Checkpoint Repository | `platforms/xiaohongshu/checkpoint.ts` | 接口与文件实现靠近放置。  |
| MCP Config            | `platforms/xiaohongshu/mcp.ts`        | 平台私有 MCP 配置。       |
| Login Service         | `platforms/xiaohongshu/login.ts`      | 去掉 Service。            |
| QRCode Service        | `platforms/xiaohongshu/qrcode.ts`     | 去掉 Service。            |
| Docker Bootstrap      | `platforms/xiaohongshu/docker.ts`     | 平台生命周期。            |
| Mention Subscriber    | `agent-runtime/subscriber.ts`         | Agent 主动订阅 Platform。 |

## Agent 核心

| 当前文件或职责                     | 目标文件                        | 说明                        |
| ---------------------------------- | ------------------------------- | --------------------------- |
| `agent-runtime-harness.ts`         | `agent-runtime/agent.ts`        | Agent 是运行循环的 owner。  |
| Harness Port                       | 合并到 `agent-runtime/agent.ts` | 使用最小 Agent 接口。       |
| Agent Decision                     | `agent-runtime/action.ts`       | 重命名为 AgentAction。      |
| Observation                        | `agent-runtime/observation.ts`  | 统一工具结果。              |
| Conversation Message               | `agent-runtime/message.ts`      | Agent 内部消息。            |
| Runtime State                      | `agent-runtime/state.ts`        | 循环状态与预算。            |
| Conversation History、History Port | `agent-runtime/history.ts`      | 接口与默认实现靠近放置。    |
| QQ Agent Factory                   | `bootstrap/agent.ts`            | 移除平台前缀和 Factory。    |
| Safe Agent Wrapper                 | 合并到 `agent-runtime/agent.ts` | Agent 自身保证边界。        |
| Agent Fallback                     | `agent-runtime/lm/fallback.ts`  | 降级属于 LM。               |
| OpenAI QQ Agent                    | `agent-runtime/lm/openai.ts`    | 去掉平台与 Agent 重复语义。 |
| QQ Agent Port                      | `agent-runtime/lm/lm.ts`        | Agent 只依赖 LM。           |

## Prompt

| 当前文件或职责              | 目标文件                           | 说明                       |
| --------------------------- | ---------------------------------- | -------------------------- |
| Harness Prompt State        | `agent-runtime/prompt/state.ts`    | 动态治理状态。             |
| Base/System Prompt          | `agent-runtime/prompt/system.ts`   | System 规则。              |
| `harness-runtime.prompt.md` | `agent-runtime/prompt/system.md`   | 去掉 Harness。             |
| Outside Context             | `agent-runtime/prompt/context.ts`  | 结构化运行上下文。         |
| Conversation Renderer       | `agent-runtime/prompt/history.ts`  | 历史渲染。                 |
| Harness Action Prompt       | `agent-runtime/prompt/action.ts`   | AgentAction 协议。         |
| Skill Prompt                | `agent-runtime/prompt/skills.ts`   | 只渲染 Skills 结构化目录。 |
| Tool Prompt                 | `agent-runtime/prompt/tools.ts`    | 只渲染 Registry 快照。     |
| QQ Reply Prompt             | `agent-runtime/prompt/turn.ts`     | 平台消息先归一化。         |
| Prompt Composer             | `agent-runtime/prompt/composer.ts` | 唯一拼装入口。             |

## Skills

| 当前文件或职责                       | 目标文件                            | 说明                             |
| ------------------------------------ | ----------------------------------- | -------------------------------- |
| Skill Definition                     | `agent-runtime/skills/skill.ts`     | 元数据和正文结构。               |
| Skill Reference                      | `agent-runtime/skills/reference.ts` | 引用结构与加载。                 |
| Selection Context、Default Selector  | `agent-runtime/skills/selector.ts`  | 只选择目录候选。                 |
| Skill Runtime、Content Loader        | `agent-runtime/skills/loader.ts`    | 渐进式读取正文。                 |
| Filesystem Skill Market              | `agent-runtime/skills/catalog.ts`   | Skill 发现与目录。               |
| Frontmatter Parser                   | `agent-runtime/skills/parser.ts`    | Markdown 解析。                  |
| Skill Port、Loader Port、Market Port | 合并到对应文件                      | 去掉 Port 目录和后缀。           |
| Skill Prompt Document                | `agent-runtime/skills/skill.ts`     | 保留数据，不持有 Prompt 字符串。 |

## Tools 与 Schedule

| 当前文件或职责          | 目标文件                                           | 说明                          |
| ----------------------- | -------------------------------------------------- | ----------------------------- |
| Tool Domain Object      | `agent-runtime/tools/tool.ts`                      | 统一 ToolDefinition。         |
| Composite Tool Registry | `agent-runtime/tools/registry.ts`                  | 统一注册和发现。              |
| Runtime Tools           | `agent-runtime/tools/messages.ts`、`faces.ts`      | 按真实 Tool 拆分。            |
| Tool Registry Port      | 合并到 `agent-runtime/tools/registry.ts`           | 去掉 Port。                   |
| Tool Executor Port      | `agent-runtime/tools/executor.ts`                  | 同时拥有执行约束。            |
| Actions Dispatcher Port | `agent-runtime/schedule/dispatcher.ts`             | Action 定位到 Tool。          |
| Outgoing Action         | `agent-runtime/action.ts` 或 `platforms/action.ts` | 按 Agent 动作与平台动作拆分。 |
| Skill Call              | `agent-runtime/tools/skill.ts`                     | Skill 是普通 Tool。           |
| Code Agent Call         | `agent-runtime/tools/code.ts`                      | Code Agent 是普通 Tool。      |
| Tool Risk Policy        | `agent-runtime/tools/permission.ts`                | 执行前权限与确认。            |
| Agent Action Loop       | `agent-runtime/schedule/schedule.ts`               | 单次 Action 调度。            |
| Dispatch Result         | `agent-runtime/schedule/result.ts`                 | 转换为 Observation。          |

## MCP

| 当前文件或职责                  | 目标文件                                    | 说明                          |
| ------------------------------- | ------------------------------------------- | ----------------------------- |
| MCP Domain Types                | `agent-runtime/tools/mcp/schema.ts`         | MCP 工具结构。                |
| MCP Config、Config Loader       | `agent-runtime/tools/mcp/config.ts`         | 配置解析。                    |
| MCP Service                     | `agent-runtime/tools/mcp/runtime.ts`        | Server 生命周期与工具发现。   |
| MCP Client Factory、Client Port | `agent-runtime/tools/mcp/client.ts`         | Client 构造和最小接口。       |
| Raw MCP Caller                  | 合并到 `agent-runtime/tools/mcp/runtime.ts` | 调用仍由 Tool Executor 触发。 |

## LM 与 Model Pool

| 当前文件或职责           | 目标文件                          | 说明                            |
| ------------------------ | --------------------------------- | ------------------------------- |
| Model Pool               | `agent-runtime/lm/pool.ts`        | LM 内部节点池。                 |
| Model Pool Config        | `agent-runtime/lm/config.ts`      | 节点与模型配置。                |
| Model Definition         | `agent-runtime/lm/model.ts`       | 模型能力和运行信息。            |
| Model Request Error      | `agent-runtime/lm/error.ts`       | 统一模型错误。                  |
| Model Pool Port          | 合并到 `agent-runtime/lm/pool.ts` | 不向 Agent 暴露节点池。         |
| OpenAI Compatible Client | `agent-runtime/lm/openai.ts`      | 供应商协议。                    |
| OpenAI Harness Runner    | `agent-runtime/lm/lm.ts`          | 去掉 Harness，公开 run/stream。 |
| LLM Provider Port        | 合并到 `agent-runtime/lm/lm.ts`   | Agent 只依赖 LM。               |
| Fallback Runner          | `agent-runtime/lm/fallback.ts`    | 重试和降级。                    |

## Code Agent

| 当前文件或职责              | 目标文件                                             | 说明                         |
| --------------------------- | ---------------------------------------------------- | ---------------------------- |
| Code Agent Definition       | `agent-runtime/lm/code-agent/definition.ts`          | 目录已表达 Code Agent。      |
| Code Agent Task             | `agent-runtime/lm/code-agent/task.ts`                | 任务结构。                   |
| Code Agent Event            | `agent-runtime/lm/code-agent/event.ts`               | 归一化事件。                 |
| Code Agent Session          | `agent-runtime/lm/code-agent/session.ts`             | 会话结构。                   |
| Failure、Errors、Classifier | `agent-runtime/lm/code-agent/error.ts`               | 统一失败分类。               |
| Orchestrator                | `agent-runtime/lm/code-agent/agent.ts`               | Code Agent 运行 owner。      |
| Confirmation Gate           | `agent-runtime/lm/code-agent/gate.ts`                | 人工确认边界。               |
| Factory                     | `agent-runtime/lm/code-agent/index.ts`               | 简单构造直接由公开入口完成。 |
| Claude Adapter              | `agent-runtime/lm/code-agent/claude.ts`              | 去掉 Adapter 后缀。          |
| Codex Adapter               | `agent-runtime/lm/code-agent/codex.ts`               | 去掉 Adapter 后缀。          |
| Definition Registry         | `agent-runtime/lm/code-agent/registry.ts`            | 子模块内部注册。             |
| Event Logger                | `agent-runtime/lm/code-agent/log.ts`                 | 去掉 Code Agent 前缀。       |
| Runner Port                 | `agent-runtime/lm/code-agent/runner.ts`              | 接口与执行约束靠近放置。     |
| Registry Port               | 合并到 `agent-runtime/lm/code-agent/registry.ts`     | 去掉 Port。                  |
| Argv Budget                 | `agent-runtime/lm/code-agent/process/args.ts`        | 进程参数预算。               |
| JSON Line Stream            | `agent-runtime/lm/code-agent/process/stream.ts`      | 流式协议。                   |
| Environment Builder         | `agent-runtime/lm/code-agent/process/environment.ts` | 子进程环境。                 |
| Process Lifecycle           | `agent-runtime/lm/code-agent/process/session.ts`     | 子进程会话。                 |
| Windows Command             | `agent-runtime/lm/code-agent/process/command.ts`     | 平台命令适配。               |
| HTTP Controller             | `agent-runtime/lm/code-agent/routes.ts`              | 去掉 Controller。            |
| HTTP Server                 | `agent-runtime/lm/code-agent/server.ts`              | 本地服务。                   |

## 空骨架处理

| 当前模块         | 处理方式                                                       |
| ---------------- | -------------------------------------------------------------- |
| `conversation`   | 真实历史能力迁入 `agent-runtime/history.ts`，空层级删除。      |
| `event-gateway`  | 来源协议迁入 Platforms，公共消息进入 `platforms/message.ts`。  |
| `persona`        | 已使用规则迁入 `prompt/system.ts`；无调用方骨架删除。          |
| `policy`、`risk` | 工具风险迁入 `tools/permission.ts`；无调用方骨架删除。         |
| `actions`        | AgentAction、Schedule、PlatformAction 各归 owner；空模块删除。 |

## 测试改名示例

| 当前测试名                        | 目标测试名                                  |
| --------------------------------- | ------------------------------------------- |
| `agent-runtime-harness.test.ts`   | `agent-runtime/agent.test.ts`               |
| `prompt-composer.test.ts`         | `agent-runtime/prompt/composer.test.ts`     |
| `mcp-runtime.test.ts`             | `agent-runtime/tools/mcp/runtime.test.ts`   |
| `model-pool.test.ts`              | `agent-runtime/lm/pool.test.ts`             |
| `code-agent-orchestrator.test.ts` | `agent-runtime/lm/code-agent/agent.test.ts` |
| `qq-reply-subscriber.test.ts`     | `agent-runtime/subscriber.test.ts`          |

## 迁移核对

- 每迁移一个文件，更新导出与测试后立即删除旧文件，不保留双入口。
- 发现一个文件承担两个目标模块职责时，先补 characterization test，再拆分。
- 发现目标文件名仍需要 `Service`、`Manager` 或平台前缀才能辨认时，先检查目录边界是否错误。
- 每个提交必须能通过对应模块测试和架构校验，整个迁移不超过十个可回滚提交。
