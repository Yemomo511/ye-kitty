# Kitty Service MVP 架构

该包承载 Ye-Kitty 的服务层。MVP 阶段采用模块化单体架构，但以微服务形态划分边界，确保后续可以在不修改领域契约的前提下，将模块迁移到 HTTP、RPC、队列或 Worker 进程之后。

## 依赖方向

```text
bootstrap
  -> control-plane
  -> services
  -> platforms
  -> contracts
  -> shared
```

规则：

- `shared` 不依赖任何服务模块或平台模块。
- `shared/types` 统一存放跨模块共享的类型、接口和结构体定义。
- `shared` 只承载已经被多个模块稳定复用的共同能力，不预设全局统一抽象或统一策略注册器。
- `shared/infrastructure` 存放跨模块可复用的轻量基础设施，例如 RxJS 消息总线实现。
- `contracts` 只包含跨服务共享的事件和动作 DTO。
- `services/*/domain` 存放业务对象和服务内局部值类型。
- `services/*/application` 编排单个服务边界内的用例流程。
- `services/*/ports` 定义入站接口和出站接口。
- `services/*/infrastructure` 适配数据库、队列、SDK 和模型提供方。
- `platforms/*` 将平台特定载荷转换为统一契约，并执行平台动作。
- 全局 `EventBus` 只用于项目配置、并发策略等通用系统消息，不承载 QQ 消息、Agent 回复等具体业务通信。
- 每个 `platforms/*` 服务各自持有 RxJS `Subject`，并通过统一 public `subscribe` 暴露平台标准消息。
- 具体业务订阅只能由上层应用模块订阅下层平台服务，禁止下层平台模块订阅后反向调用上层服务。
- 下层模块不能依赖上层模块；例如 QQ 平台模块不能 import `agent-runtime`，应由 `agent-runtime` 主动订阅 QQ 服务。
- `control-plane` 读取服务状态并修改配置，但不能绕过服务端口直接访问基础设施。
- `bootstrap` 是唯一负责组装具体实现的地方。

## MVP 消息流

```text
QQ 原始载荷
  -> platforms/qq
  -> contracts/events
  -> services/agent-runtime
  -> platforms/qq
```

完整链路补齐后会继续扩展为：

```text
contracts/events
  -> services/event-gateway
  -> services/conversation
  -> services/persona
  -> services/policy
  -> services/agent-runtime
  -> services/llm
  -> services/risk
  -> services/actions
  -> platforms/qq
```

`agent-runtime` 是 Ye-Kitty 自研的可审计 Agent Harness。它负责编排人格、会话、策略结果、Skill、MCP 工具权限和底层 Agent Runner，让 Agent 生成候选回复或候选动作。候选结果必须继续经过 `risk` 和 `actions`，不能由 Agent Runner 直接执行对外平台动作。

## 服务边界

- `event-gateway`：接收原始入口数据，标准化事件，执行去重，并发布聊天事件。
- `conversation`：负责会话、参与者和近期消息上下文。
- `persona`：负责 Ye-Kitty 人格版本和启用规则。
- `policy`：判断事件应当触发回复、拒绝、人工审核还是静默处理。
- `agent-runtime`：承载可审计 Agent Harness，负责上下文组装、Skill 选择、MCP 工具授权、运行记录和 OpenAI Agents SDK 等底层 Runner 调用。
- `llm`：构造模型请求并返回结构化生成结果；同时作为**智能供应端**承载 code agent 子进程编排（进程编排 + 协议翻译，不做会话/Prompt/工具治理）。提供两套并行 port：`LlmProviderPort.generateReply()`（HTTP API 模型回复）和 `CodeAgentRunnerPort.submit()`（stdio 子进程 code agent 任务执行）。
- `risk`：在对外发送前检查生成内容。
- `actions`：持久化并执行对外社交动作。
- `platforms/qq`：MVP 阶段提供 QQ 官方契约占位，并新增 OneBot v11 + NapCat 的 QQ 账号实验通道；实验通道只负责接收白名单消息、通过自身 `subscribe` 发布统一聊天事件，并提供 OneBot 发送端口。
- `platforms/xiaohongshu`：通过 MCP 内部 `list_mentions` 读取通知中心最新一页，负责首次基线、持久化去重、轮询退避和被提及事件发布；不读取 Cookie，不反向依赖 Agent Runtime。

每个边界都优先暴露端口。后续可以在不修改调用方的情况下补充基础设施实现。

### agent-runtime 约束

- 业务模块只能依赖 `agent-runtime/ports`，不能直接依赖 OpenAI Agents SDK、LangGraph 或具体 MCP 客户端。
- `AgentRuntimeHarness` 是 Agent loop、工具预算、Skill 状态和最终决策的唯一 owner；OpenAI Agents SDK 只作为模型请求和 MCP 传输基础设施，不能绕过 Harness 执行工具。
- MCP 只作为工具接入协议，不作为信任边界。MCP Server、工具名称、工具参数、调用预算和高风险工具都必须经过 Ye-Kitty 的权限治理。
- 通用 MCP 配置使用项目根目录 `.mcp.json`，兼容 stdio、Streamable HTTP、旧版 SSE、`type`/`transport`、`allowedTools`/`disabledTools` 和多 Server；也可以通过 `YE_KITTY_MCP_CONFIG_PATH` 显式指定配置文件。
- MCP Server 在启动期连接并发现工具，对外工具名统一为 `{server}_{tool}`。单个 Server 失败只隔离自身；进程退出时由 bootstrap 统一关闭所有已连接会话。
- MCP `internalTools` 只注册到原始调用表，不出现在 Harness 工具目录，也不能经 `execute()` 执行；小红书 `list_mentions` 使用该边界。
- MCP 工具默认风险为 `medium`，只有配置为 `low` 的工具允许 Harness 自动执行；`medium`、`high` 工具返回风险观察，等待后续 `risk/actions` 或人工审核链路。
- 项目统一启动入口位于 `scripts/start.ts`，提供 QQ、小红书和组合启动。小红书启动由 `bootstrap` 编排 Docker 健康检查、MCP 连接、二维码登录和状态确认；Cookie 只由上游容器持久化，业务代码不得读取或打印。
- 小红书 MCP 登录检查使用原始工具调用端口读取二维码图片内容，但原始 Base64 不进入 Harness observation；登录完成后工具仍通过组合注册表和风险门禁提供给 Agent。
- 小红书被提及事件已进入 Agent Runtime 订阅边界，但当前订阅器不持有 Agent、Harness、Skill、工具执行器或动作端口，收到后只记录脱敏跳过日志。
- Skills 是可版本化的中文能力包，用于描述专项能力、Prompt 片段、示例、可用工具和风险等级。
- 平台固定 Skill 由 `agent-runtime` 内的平台订阅边界预启用；QQ 消息固定注入 `qq-chat`，通用 Harness 只接收结构化的预启用正文，不直接判断平台。
- 每次 Harness 首轮模型决策前自动执行 `get_recent_messages` 并注入当前会话历史；前置执行不消耗模型工具预算，失败时以观察结果降级而不是中断运行。
- LangGraph 类运行时只用于长任务、复杂状态流、可暂停恢复流程和多 Agent 协作，不进入普通 QQ 短回复默认路径。
- Agent 运行记录至少应包含事件 ID、人格版本、策略版本、Skill 版本、工具权限、工具调用、模型结果、候选输出、成本、耗时和错误信息。

### llm code agent 约束

- code agent 接入层只做**进程编排 + 协议翻译**，不做会话历史治理、不做 Prompt/Skill 治理、不做工具决策（三条禁忌）。
- 工具透传走**中间人模式**：code agent 产出的 `tool_use` 事件经由 llm 透传给 harness，由 harness 的 ToolExecutor 执行，结果经 `injectToolResult()` 注回子进程 stdin。code agent 不直接执行任何工具。
- 安全门禁经 `CodeAgentGateHook` 接口注入，不引入反向依赖（risk 已 `dependsOn: ['llm']`）。
- 子进程启动时在 env 注入进程印章，服务启动时清理残留孤儿进程（PID 登记文件 + CommandLine 校验防 PID 复用）。
- control-plane HTTP API（`/admin/code-agent/*`）仅监听 127.0.0.1，Bearer 鉴权；API key 为空则不启动。
- Agent CLI 的所有参数经 `buildArgs` 函数构建（prompt 不得进入 argv），prompt 恒经 stdin（stream-json 格式）传递。
- 声明式 AgentDef 注册新 agent：加一个 plain object，不改引擎代码。

## 设计模式约束

- 模板方法模式和策略模式按需引入，不建立统筹所有服务的统一基类或统一策略注册器。
- 当某个服务内存在稳定且重复的处理流程时，可以在该服务内建立对应抽象类，让子类覆写必要步骤。
- 当某个服务内存在多种可替换算法、规则或决策路径时，可以在该服务内建立对应策略接口和选择逻辑。
- 只有某个抽象、模板或策略被多个服务稳定复用，且语义足够通用时，才允许上沉到 `shared`。
- 服务内的差异化逻辑应收敛到 `application`、`ports`、`infrastructure` 的边界中，不为了套用设计模式污染共享层。
