# Agent Runtime Harness 设计知识

本文记录 Ye-Kitty 自研可审计 Agent Harness 的设计约束。README 只保留架构入口，本文件承载后续开发时需要反复查看的细节。

## 定位

`agent-runtime` 是连接 Ye-Kitty 业务规则和 Agent 执行引擎的服务边界。它负责把人格、会话、策略、工具权限和能力包组装成一次可追踪的 Agent 运行，并将底层执行委托给 OpenAI Agents SDK、LangGraph 或未来其他可替换运行时。

Agent Runner 只能生成候选回复、候选计划或候选动作，不能绕过 `policy`、`risk` 和 `actions` 直接对外发送消息、发布内容、读取敏感数据或执行平台动作。

## 目录结构建议

```text
services/agent-runtime
  domain/           # AgentRun、AgentStep、SkillDefinition、ToolPermission 等领域对象
  application/      # 运行编排、上下文准备、工具审批、运行记录等用例
  ports/            # AgentRunner、SkillRegistry、McpClient、AgentRunRepository 等端口
  infrastructure/   # OpenAI Agents SDK、MCP 工具注册、本地 Skill 注册等实现
```

## 核心约束

- Ye-Kitty 自研 Harness 负责人格、策略、权限、审计、风控前置和动作后置约束。
- OpenAI Agents SDK 先作为默认 `AgentRunner` 实现，负责 Agent loop、工具调用、MCP 接入、会话、追踪和人工介入等底层执行能力。
- 业务模块只能依赖 `agent-runtime/ports`，不能直接依赖 OpenAI Agents SDK、LangGraph 或具体 MCP 客户端。
- MCP 只作为工具接入标准，不作为信任边界。所有 MCP Server、工具名称、工具参数、调用预算和高风险调用都必须经过 Ye-Kitty 的权限治理。
- Skills 是可版本化的中文能力包，用于描述叶猫猫的专项能力、Prompt 片段、示例、可用工具和风险等级。
- LangGraph 只用于长任务、复杂状态流、可暂停恢复流程和多 Agent 协作，不进入普通短链路 QQ 回复的默认路径。

## 推荐端口

- `AgentRunnerPort`：执行一次 Agent 任务，并返回最终候选结果、步骤、工具调用和用量。
- `SkillRegistryPort`：按平台、人格、策略结果和任务类型选择可用 Skill。
- `McpClientPort`：连接 MCP Server，并在 Harness 授权后暴露工具。
- `AgentRunRepositoryPort`：记录 Agent 运行输入、步骤、工具调用、结果和错误。
- `ToolPermissionPort`：判断工具是否可用、是否需要人工确认、是否超出预算。

## Agent 运行记录

一次 Agent 运行至少应记录：

- 输入事件 ID、会话 ID、平台、触发用户和触发时间。
- 使用的人格版本、策略版本、Skill ID 和 Skill 版本。
- 暴露给 Agent 的工具清单、MCP Server 清单和工具权限结果。
- 模型请求摘要、模型输出摘要、工具调用参数摘要和工具返回摘要。
- 运行成本、耗时、错误、人工确认结果和最终候选输出。

## QQ 短链路流程

```text
policy
  -> agent-runtime
  -> risk
  -> actions
```

普通 QQ 回复应保持短链路：

1. `policy` 判断是否回复、拒绝、转人工或静默。
2. `agent-runtime` 基于策略结果选择 Skill、授权 MCP 工具并准备 Agent 上下文。
3. OpenAI Agents SDK Runner 执行短链路 Agent loop，生成候选回复或候选动作。
4. `agent-runtime` 记录 Agent 步骤、工具调用、模型结果和候选输出。
5. `risk` 检查候选回复或候选动作。
6. `actions` 创建并执行 `OutgoingAction`。

如果任务需要等待人工确认、跨多轮收集资料、定时恢复或多 Agent 分工，应由 `agent-runtime` 创建长任务，并交给 LangGraph 类运行时处理。

## 分阶段建设

### 可观测和可回放阶段

- 增加 `agent-runtime` 运行记录，支持查看 Agent 步骤、工具调用、Skill 版本、MCP 权限和候选输出。
- 增加 Agent 运行回放能力，确保同一历史事件可以按当时的人格、策略、Skill 和工具权限重新分析。

### 多平台扩展阶段

- 为不同平台选择不同 Skills 和 MCP 工具集合。
- 保持平台行为差异在 `policy` 与 `agent-runtime` 内可审计。

### 风险管控增强阶段

- 对高风险 MCP 工具、平台发布动作、外部私有数据读取和自动运营动作增加人工确认。
- 对 Agent 工具调用增加预算、频率、域名白名单、参数脱敏和返回结果脱敏。

### Agent 能力平台阶段

- 接入 OpenAI Agents SDK 作为默认短链路 Agent Runner。
- 建立本地中文 Skills 目录，支持 Skill 版本、启停、适用平台、允许工具和风险等级。
- 接入 MCP 工具注册与权限治理，优先支持联网检索、公开网页读取和内部只读查询。
- 引入 LangGraph 类长任务 Runner，支持可暂停恢复、多步骤运营流程和多 Agent 协作。
- 在控制面展示 Agent 运行、Skill 版本、MCP 工具调用、人工确认和回放入口。

## 开发约定

- 新增 Agent 能力时，优先在 `agent-runtime/ports` 表达边界，再在 `infrastructure` 接入 OpenAI Agents SDK、MCP 或 LangGraph。
- 新增 Skill 时必须使用中文说明，并声明版本、适用平台、可用工具、风险等级和示例。
- 任何外发消息、发布内容、删除内容或读取敏感数据的 Agent 结果，都必须经过 `policy`、`risk` 和 `actions` 的显式约束。
