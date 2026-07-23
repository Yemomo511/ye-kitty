# Kitty Service 三层模块架构

Kitty Service 是模块化单体。源码按运行职责组织为 `platforms`、`agent-runtime`、`shared` 三个业务层级，另以 `bootstrap` 负责进程装配。项目不再使用微服务骨架，也不再创建 `application`、`domain`、`infrastructure`、`ports` 目录。

## 依赖方向

```text
bootstrap
  ├──> agent-runtime
  ├──> platforms
  └──> shared

agent-runtime ──> platforms ──> shared
      └───────────────────────> shared
```

- `shared` 只包含跨层稳定协议和通用能力，不依赖其他业务模块。
- `platforms` 负责外部平台协议、消息订阅和动作执行，只依赖 `shared`。
- `agent-runtime` 主动订阅 Platform，组织 Agent 执行循环，可依赖 `platforms` 和 `shared`。
- `bootstrap` 是唯一装配入口，可以依赖全部模块；业务模块禁止反向依赖它。
- `scripts` 只选择启动模式并调用 Bootstrap，不承载业务实现。

`pnpm run validate:architecture` 会以严格模式检查目录、文件名和依赖方向。旧目录、旧架构角色后缀与重复平台前缀的容忍额度均为零。

## Platforms：平台消息层

`platforms/message.ts` 是 Agent 可见的统一消息，`platforms/action.ts` 是平台动作公共语言，`platforms/channel.ts` 提供订阅能力。QQ、OneBot 和小红书的原始协议只能留在各自平台目录。

Platform 不组织 Prompt、不运行 LM，也不判断模型工具调用。平台只广播消息并暴露受控动作；Agent Runtime 在上层订阅消息并调用动作，从依赖结构上避免双向引用。

## Agent Runtime：Agent 执行层

`agent-runtime/agent.ts` 负责一次运行的系统编排：创建 `AgentRunState`、固定 Tool 快照、执行最近消息前置观察、物化官方 FunctionTool，并调用官方 Agents SDK Runner。模型与工具的多轮循环由 Runner 维护，业务终态只能由 `finish` Tool 提交。

- `prompt`：模型最小上下文的唯一组织模块，只投影身份、任务、Skill 和必要业务约束，不渲染预算、审批、调用ID、风险或追踪状态。
- `skills`：Skill 目录、正文和引用的渐进式读取，不直接拼接 Prompt。
- `tools`：统一组织内建、Skill、MCP、Code Agent 与 `finish`；内部只允许 `Tool.make()` 创建的规范 Tool，名称由 Registry 维护。
- `tools/materialize.ts`：把单次运行快照投影为官方 `tool()` FunctionTool，只向模型提供名称、说明和 Schema。
- `tools/tool.ts`：`Tool.settle()` 是唯一结算入口，统一输入校验、授权、审批、预算、超时、取消、Effect、幂等和审计。
- `state.ts`：维护运行ID、真实调用ID关联、不可变工具快照、预算、Skill、引用、审批事实和可信终态，不进入 Prompt。
- `lm`：使用官方 Runner 维护工具循环；Model Pool 在 `Model.getResponse()` 请求级别执行节点选择、并发、间隔和429退避。
- `lm/code-agent`：Code Agent 的定义、会话、门禁、进程协议和本地服务；通过需要审批的 `tools/code.ts` 接入统一 Tool 结算。
- `queue`：治理进入完整 Agent 循环前的并发、优先级与同会话顺序。
- `subscriber`：主动订阅 Platform Channel，完成平台消息到 Agent 的上层编排。

模型只选择官方 FunctionTool 并提交候选输入。可见性不等于授权；系统不会让模型维护 `callId`、预算、审批、状态阶段或副作用。Skill 状态只能通过白名单 Effect 变更，MCP 与其他来源不能伪造 Effect。旧 JSON Action、Schedule、RuntimeTool、Executor 和 Permission 执行链已经删除。

## Shared：共享层

只有被多个上层真实复用、没有更明确 owner 且不包含运行流程语义的内容才能进入 Shared。当前共享层包含稳定 ID、日志能力和 MCP 跨层协议。PlatformMessage 属于 Platforms，规范 Tool 属于 Agent Runtime，Model 属于 LM。

## Bootstrap：进程装配

- `environment.ts`：读取环境和资产位置。
- `platform.ts`：选择启动的平台组合。
- `agent.ts`：连接 Agent、LM、Skills、Tools 与平台能力。
- `tools.ts`：装配 MCP 等外部 `ToolSource`，只管理生命周期，不创建第二种执行协议。
- `code.ts`：装配 Code Agent 本地运行入口。

Bootstrap 只创建实例和管理生命周期，不沉淀平台协议、Prompt、Tool 算法或业务规则。

## 文件命名

- 目录提供上下文，文件只表达最小元素，例如 `prompt/composer.ts`、`tools/tool.ts`、`lm/pool.ts`。
- 文件名禁止包含 `harness` 以及 `.service`、`.factory`、`.adapter`、`.port`、`.contract`、`.controller` 等角色后缀。
- 平台目录内不重复平台名，`lm/code-agent` 内不重复 `code-agent`。
- 测试统一放入其直接所属模块的 `__test__/` 目录，文件名与被测元素对应并使用 `.test.ts`。

完整设计与迁移记录见 `design-docs/Architecture/platform-agent-shared-refactor.md`。
