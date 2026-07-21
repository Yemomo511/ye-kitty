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

Platform 不组织 Prompt、不运行 LM，也不判断 AgentAction。平台只广播消息并暴露受控动作；Agent Runtime 在上层订阅消息并调用动作，从依赖结构上避免双向引用。

## Agent Runtime：Agent 执行层

`agent-runtime/agent.ts` 拥有一次 Agent 循环：构造当前上下文、请求 LM、取得 AgentAction、交给 Schedule 调度，并把 Observation 回灌下一轮。

- `prompt`：System Prompt 的唯一组织与动态治理模块。其他模块只能提供结构化数据。
- `skills`：Skill 目录、正文和引用的渐进式读取，不直接拼接 Prompt。
- `tools`：统一组织内建工具、Skill、MCP 与 Code Agent；执行能力必须先注册为 Tool。
- `schedule`：消费 AgentAction，把 ToolAction 定位到 Tool，并把结果转换为 Observation。
- `lm`：持有 Model Pool，为 Agent 提供统一运行接口；供应商差异、重试与模型路由不泄漏给 Agent。
- `lm/code-agent`：Code Agent 的定义、会话、门禁、进程协议和本地服务；通过 `tools/code.ts` 作为普通 Tool 接入 Schedule。
- `queue`：治理进入完整 Agent 循环前的并发、优先级与同会话顺序。
- `subscriber`：主动订阅 Platform Channel，完成平台消息到 Agent 的上层编排。

Agent 只消费 AgentAction，不保留 Skill、MCP 或 Code Agent 的专用调度分支。LM 不执行 Tool，Tool 不修改 Agent 状态，Schedule 不承担 cron 或跨进程定时任务。

## Shared：共享层

只有被多个上层真实复用、没有更明确 owner 且不包含运行流程语义的内容才能进入 Shared。当前共享层包含稳定 ID、日志能力和 MCP 跨层协议。PlatformMessage 属于 Platforms，AgentAction 属于 Agent Runtime，Model 属于 LM。

## Bootstrap：进程装配

- `environment.ts`：读取环境和资产位置。
- `platform.ts`：选择启动的平台组合。
- `agent.ts`：连接 Agent、LM、Skills、Tools 与平台能力。
- `tools.ts`：装配 MCP 等外部 Tool 来源。
- `code.ts`：装配 Code Agent 本地运行入口。

Bootstrap 只创建实例和管理生命周期，不沉淀平台协议、Prompt、Tool 算法或业务规则。

## 文件命名

- 目录提供上下文，文件只表达最小元素，例如 `prompt/composer.ts`、`tools/runtime.ts`、`lm/pool.ts`。
- 文件名禁止包含 `harness` 以及 `.service`、`.factory`、`.adapter`、`.port`、`.contract`、`.controller` 等角色后缀。
- 平台目录内不重复平台名，`lm/code-agent` 内不重复 `code-agent`。
- 测试统一放入其直接所属模块的 `__test__/` 目录，文件名与被测元素对应并使用 `.test.ts`。

完整设计与迁移记录见 `design-docs/Architecture/platform-agent-shared-refactor.md`。
