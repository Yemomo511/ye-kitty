# Ye-Kitty

Ye-Kitty 是叶墨沫为虚拟互联网形象“叶猫猫”设计的服务系统。叶猫猫会接入 QQ、小红书、飞书等互联网平台，感知外部事件和用户消息，并基于人格、策略、上下文和大模型能力进行回应。

当前阶段的核心目标不是做一个简单聊天机器人，而是建设一套可扩展、可审计、可管控的虚拟形象服务底座。

## 核心目标

- **人格一致**：不同平台、不同会话里的叶猫猫都应表现为同一个稳定形象。
- **事件统一**：平台输入统一转换为标准事件，避免业务逻辑绑定某个平台协议。
- **策略驱动**：系统先判断是否回应、如何回应、是否拒绝或转人工，再生成动作。
- **行为可追踪**：输入事件、策略决策、模型结果、风险检查和最终动作都应可记录、可回放。
- **能力可扩展**：后续新增平台、数据源、模型、风险策略时，应有清晰路径依赖和落点。

## MVP 范围

第一阶段聚焦 QQ 文本聊天：

- 接入 QQ 私聊和群聊文本消息。
- 将 QQ 原始载荷转换为统一聊天事件。
- 基于会话上下文、人格配置和策略判断生成回复。
- 在对外发送前执行基础风险检查。
- 将外部回复抽象为统一动作并交给平台适配器执行。
- 提供最小控制面能力，用于查看事件、会话、人格、策略和动作记录。

本地 QQ 账号实验通道通过 NapCat + OneBot v11 反向 WebSocket 接入，Docker 部署与端口映射说明见 [NapCat Docker 接入 QQ 服务](docs/qq-napcat-docker.md)。

小红书实验通道通过浏览器驱动 MCP 接入。运行 `pnpm start` 可选择 QQ、小红书或两者同时启动；Docker、扫码登录、风险等级和排障说明见 [小红书 MCP 接入与登录](docs/xiaohongshu-mcp.md)。

暂不优先实现：

- 多平台完整接入。
- 图片、语音、视频理解。
- 复杂长期记忆。
- 自动发帖和主动运营。
- 高级攻击检测和完整风控体系。

## 本地运行 NapCat Docker

NapCat 在本项目中作为 QQ 账号侧 OneBot v11 适配器运行。连接方向是：Ye-Kitty 启动 OneBot 反向 WebSocket 服务，NapCat Docker 作为 WebSocket 客户端主动连接 Ye-Kitty。

### 端口映射

| 端口   | 所属进程      | 用途                                          |
| ------ | ------------- | --------------------------------------------- |
| `3001` | Ye-Kitty      | OneBot v11 反向 WebSocket，供 NapCat 主动连接 |
| `6099` | NapCat Docker | NapCat WebUI，用于登录 QQ 和配置 OneBot 网络  |

不要把 NapCat 的 `3001` 映射到宿主机，否则会和 Ye-Kitty 默认监听的 `3001` 冲突。

### 启动流程

先确认根目录 `.env` 至少配置：

```dotenv
YE_KITTY_ONEBOT_ACCESS_TOKEN=ye-kitty-local-secret
YE_KITTY_QQ_SELF_ID=你的机器人QQ号
YE_KITTY_QQ_GROUP_ALLOWLIST=[]
YE_KITTY_QQ_FRIEND_ALLOWLIST=[允许回复的好友QQ号]
YE_KITTY_ONEBOT_WS_HOST=0.0.0.0
YE_KITTY_ONEBOT_WS_PORT=3001
YE_KITTY_ONEBOT_WS_PATH=/onebot/v11
```

启动 Ye-Kitty QQ 服务：

```bash
pnpm --filter @ye-kitty/kitty-service start-platform:qq
```

另开终端启动 NapCat Docker：

```bash
pnpm napcat:up
```

查看 NapCat WebUI Token 和登录二维码：

```bash
pnpm napcat:logs
```

打开 WebUI：

```text
http://127.0.0.1:6099/webui
```

在 NapCat WebUI 中新增或确认 WebSocket 客户端：

```text
ws://host.docker.internal:3001/onebot/v11?access_token=ye-kitty-local-secret
```

如果修改了 `.env` 中的 `YE_KITTY_ONEBOT_ACCESS_TOKEN`、`YE_KITTY_ONEBOT_WS_PORT` 或 `YE_KITTY_ONEBOT_WS_PATH`，这里的 URL 必须同步修改。

也可以使用项目里的文件化配置示例：

```bash
mkdir -p deploy/napcat/data/config
cp deploy/napcat/onebot11.example.json deploy/napcat/data/config/onebot11.json
pnpm napcat:restart
```

### 验证连接

1. Ye-Kitty 日志出现 `NapCat连接已建立`。
2. NapCat 日志不再持续出现 WebSocket 重连失败。
3. 用白名单内 QQ 好友或群发送文本消息。
4. Ye-Kitty 日志出现 `开始生成QQ回复` 和 `已发送QQ回复`。

完整部署说明、排障和配置细节见 [NapCat Docker 接入 QQ 服务](docs/qq-napcat-docker.md)。

## 总体架构

项目采用模块化单体作为 MVP 形态，但所有模块都按微服务边界设计。这样可以先降低部署和调试成本，同时为后续拆分 HTTP、RPC、队列或 Worker 服务保留空间。

```text
QQ 原始载荷
  -> platforms/qq
  -> services/event-gateway
  -> contracts/events
  -> services/conversation
  -> services/persona
  -> services/policy
  -> services/agent-runtime
  -> services/llm
  -> services/risk
  -> services/actions
  -> platforms/qq
```

`agent-runtime` 是 Ye-Kitty 自研的可审计 Agent Harness。它负责把人格、会话、策略、工具权限和能力包组装成一次可追踪的 Agent 运行，并将底层执行委托给 OpenAI Agents SDK 等可替换运行时。详细设计见 [Agent Runtime Harness 设计知识](knowledge/Agent/agent-runtime-harness.md)。

核心依赖方向：

```text
bootstrap
  -> control-plane
  -> platforms
  -> services
  -> contracts
  -> shared
```

越靠下的模块越稳定，越靠上的模块越接近具体运行环境。业务代码不应反向依赖平台 SDK、数据库实现或模型供应商实现。

## 包结构

当前主要服务包位于 `packages/kitty-service`。

```text
packages/kitty-service/src
  bootstrap/        # 组装具体实现和服务注册
  control-plane/    # 控制面 API 与管理用例
  platforms/        # 平台适配器，例如 QQ
  services/         # 核心服务边界
  contracts/        # 跨服务事件和动作契约
  shared/           # 跨模块共享的稳定类型和基础能力
```

### shared

`shared` 只放跨模块共享的稳定能力，不放具体业务流程。

```text
shared/types        # 共享结构体、接口、类型定义
shared/application  # 共享应用辅助函数
shared/errors       # 共享错误类型
```

### services

每个服务边界保持统一目录：

```text
services/{service-name}
  domain/           # 服务内领域对象和值类型
  application/      # 服务内用例编排
  ports/            # 入站和出站接口
  infrastructure/   # 数据库、队列、SDK、模型供应商等实现
```

当前服务边界：

- `event-gateway`：接收原始入口数据，标准化事件，去重并发布事件。
- `conversation`：负责会话、参与者和近期消息上下文。
- `persona`：负责叶猫猫人格版本和启用规则。
- `policy`：判断事件应当回复、拒绝、转人工还是静默。
- `agent-runtime`：承载可审计 Agent Harness，负责上下文组装、Skill 选择、MCP 工具授权、运行记录和底层 Agent Runner 调用。
- `llm`：构造模型请求并返回结构化生成结果。
- `risk`：在外部发送前检查生成内容。
- `actions`：持久化并执行对外社交动作。

### agent-runtime

`agent-runtime` 是连接业务规则和 Agent 执行引擎的边界。它不拥有最终对外动作权限，只负责生成可审计的候选结果。目录结构、端口设计、运行记录和权限治理约束沉淀在 [Agent Runtime Harness 设计知识](knowledge/Agent/agent-runtime-harness.md)。

### platforms

`platforms` 负责平台协议适配，不承载核心业务策略。

例如 `platforms/qq`：

- 将 QQ 原始消息转换为统一 `ChatEventContract`。
- 将统一 `OutgoingActionContract` 转换为 QQ 发送行为。
- 隔离 QQ SDK、Webhook、鉴权和平台协议变化。

### contracts

`contracts` 存放跨服务共享契约，例如：

- `ChatEventContract`
- `IncomingMessageContract`
- `OutgoingActionContract`

契约应保持稳定，避免直接暴露平台原始载荷。

## 设计模式约束

项目允许使用模板方法模式和策略模式，但它们应服务于具体问题，而不是成为统筹所有服务的统一框架。

### 模板方法模式

当某个服务内出现稳定且重复的处理流程时，再为该场景建立对应抽象类。

适用场景：

- 同一服务内存在多个相似处理器，流程相同但局部步骤不同。
- 同一服务内的多个子类共享校验、执行、收尾、错误处理等稳定步骤。
- 抽象类的语义足够具体，例如 `MessageIngressProcessor`，而不是统筹所有用例的全局基类。

不推荐：

- 为所有应用服务建立统一 `TemplateUseCase`。
- 在没有重复流程前提前抽象。
- 为了套模板方法模式而拆分简单直白的服务逻辑。

### 策略模式

当某个服务内出现多种可替换算法、规则或决策路径时，再为该场景建立对应策略接口和选择逻辑。

适用场景：

- 回复触发策略。
- 群聊和私聊策略。
- 风险判断策略。
- 模型供应商选择策略。
- 平台动作执行策略。

不推荐：

- 为所有策略建立全局统一 `StrategyRegistry`。
- 把不同业务语义的策略强行塞进同一个接口。
- 在只有一种实现时提前设计策略体系。

### 能力抽象

新能力应先通过具体服务的 `ports` 表达边界。只有当多个实现真实出现，或者流程/算法确实需要替换时，再建立局部抽象或局部策略。

优先顺序：

1. 在具体服务的 `ports` 定义服务边界接口。
2. 在具体服务的 `application` 或 `domain` 中表达业务流程。
3. 当出现重复流程时，在该服务内建立模板方法抽象。
4. 当出现可替换算法时，在该服务内建立策略接口。
5. 只有跨服务稳定复用后，才将抽象、类型或工具上沉到 `shared`。

## 一次 QQ 消息的处理流程

```text
1. QQ Adapter 收到 QQ 原始消息
2. platforms/qq 转换为 ChatEventContract
3. event-gateway 标准化、去重并发布事件
4. conversation 读取会话和近期上下文
5. persona 选择当前人格版本
6. policy 判断是否回复、拒绝、转人工或静默
7. agent-runtime 基于策略结果选择 Skill、授权 MCP 工具并准备 Agent 上下文
8. OpenAI Agents SDK Runner 执行短链路 Agent loop，生成候选回复或候选动作
9. agent-runtime 记录 Agent 步骤、工具调用、模型结果和候选输出
10. risk 检查候选回复或候选动作
11. actions 创建并执行 OutgoingAction
12. platforms/qq 发送消息
13. 全链路记录事件、决策、Agent 运行、风险检查、动作和执行结果
```

普通 QQ 回复应保持短链路：`policy -> agent-runtime -> risk -> actions`。长任务和多 Agent 协作约束见 [Agent Runtime Harness 设计知识](knowledge/Agent/agent-runtime-harness.md)。

## 建设路线

### 第一阶段：QQ MVP

- 完成 QQ 文本消息接入。
- 完成事件标准化和动作发送。
- 完成基础人格、策略、LLM、风险模块的最小实现。
- 完成事件、决策、动作记录。
- 补齐最小控制面 API。

### 第二阶段：可观测和可回放

- 增加结构化日志。
- 增加事件处理链路追踪。
- 支持按历史事件重新执行策略和生成流程。
- 支持查看人格版本、策略版本和模型结果。
- 增加 `agent-runtime` 运行记录和回放能力，细节见 [Agent Runtime Harness 设计知识](knowledge/Agent/agent-runtime-harness.md)。

### 第三阶段：多平台扩展

- 新增小红书、飞书等平台适配器。
- 保持平台输入输出只通过 `contracts` 进入核心服务。
- 复用 `services` 中的人格、策略、风险和动作能力。
- 为不同平台选择不同 Skills 和 MCP 工具集合，保持平台行为差异可审计。

### 第四阶段：风险管控增强

- 增加 Prompt 泄露防护。
- 增加敏感内容检测。
- 增加平台限流和用户信任等级。
- 增加人工审核和高风险动作拦截。
- 对高风险 MCP 工具、平台发布动作、外部私有数据读取和自动运营动作增加人工确认。

### 第五阶段：Agent 能力平台

- 接入 OpenAI Agents SDK、MCP、中文 Skills 和 LangGraph 类长任务 Runner。
- 在控制面展示 Agent 运行、Skill 版本、MCP 工具调用、人工确认和回放入口。

## 开发约定

- 项目文档、Prompt、代码注释优先使用中文。
- 修改架构时同步更新 `packages/kitty-service/src/ARCHITECTURE.md`。
- 修改架构约束或跨模块共享能力时同步更新本 README。
- 每个服务优先通过 `ports` 暴露能力，不让调用方直接依赖基础设施。
- 依赖统一在仓库根目录执行 `pnpm install`，`pnpm-workspace.yaml` 会递归安装 `packages/*` 下所有 workspace 包依赖。
- 新增 package 时必须放入 `packages/*`，并同时确认根 `package.json` 的 `workspaces` 与 `pnpm-workspace.yaml` 能覆盖该目录。
- 每次修改后优先运行根目录验证：

```bash
pnpm check
```
