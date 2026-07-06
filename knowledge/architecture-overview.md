# Ye-Kitty 总体架构知识

Ye-Kitty 是叶墨沫为虚拟互联网形象“叶猫猫”设计的服务系统。叶猫猫会接入 QQ、小红书、飞书等互联网平台，感知外部事件和用户消息，并基于人格、策略、上下文和大模型能力进行回应。

当前阶段的核心目标不是做一个简单聊天机器人，而是建设一套可扩展、可审计、可管控的虚拟形象服务底座。

## 核心目标

- 人格一致：不同平台、不同会话里的叶猫猫都应表现为同一个稳定形象。
- 事件统一：平台输入统一转换为标准事件，避免业务逻辑绑定某个平台协议。
- 策略驱动：系统先判断是否回应、如何回应、是否拒绝或转人工，再生成动作。
- 行为可追踪：输入事件、策略决策、模型结果、风险检查和最终动作都应可记录、可回放。
- 能力可扩展：后续新增平台、数据源、模型、风险策略时，应有清晰依赖路径和落点。

## MVP 范围

第一阶段聚焦 QQ 文本聊天：

- 接入 QQ 私聊和群聊文本消息。
- 将 QQ 原始载荷转换为统一聊天事件。
- 基于会话上下文、人格配置和策略判断生成回复。
- 在对外发送前执行基础风险检查。
- 将外部回复抽象为统一动作，并交给平台适配器执行。
- 提供最小控制面能力，用于查看事件、会话、人格、策略和动作记录。

暂不优先实现：

- 多平台完整接入。
- 图片、语音、视频理解。
- 复杂长期记忆。
- 自动发帖和主动运营。
- 高级攻击检测和完整风控体系。

## 架构形态

项目 MVP 阶段采用模块化单体架构，但所有模块按微服务边界设计。这样可以先降低部署和调试成本，同时为后续拆分 HTTP、RPC、队列或 Worker 服务保留空间。

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

### platforms

`platforms` 负责平台协议适配，不承载核心业务策略。

以 `platforms/qq` 为例，它负责将 QQ 原始消息转换为统一 `ChatEventContract`，并将统一 `OutgoingActionContract` 转换为 QQ 发送行为。QQ SDK、Webhook、鉴权和平台协议变化都应隔离在平台适配层。

### contracts

`contracts` 存放跨服务共享契约，例如：

- `ChatEventContract`
- `IncomingMessageContract`
- `OutgoingActionContract`

契约应保持稳定，避免直接暴露平台原始载荷。

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

普通 QQ 回复应保持短链路：`policy -> agent-runtime -> risk -> actions`。如果任务需要等待人工确认、跨多轮收集资料、定时恢复或多 Agent 分工，应由 `agent-runtime` 创建长任务，并交给 LangGraph 类运行时处理。

## 设计模式约束

项目允许使用模板方法模式和策略模式，但它们应服务于具体问题，而不是成为统筹所有服务的统一框架。

模板方法模式适用于同一服务内存在稳定且重复的处理流程，流程相同但局部步骤不同的场景。不应为所有应用服务建立统一 `TemplateUseCase`，也不应在没有重复流程前提前抽象。

策略模式适用于同一服务内存在多种可替换算法、规则或决策路径的场景，例如回复触发策略、群聊和私聊策略、风险判断策略、模型供应商选择策略、平台动作执行策略。不应为所有策略建立全局统一 `StrategyRegistry`。

新能力应先通过具体服务的 `ports` 表达边界。只有当多个实现真实出现，或者流程和算法确实需要替换时，再建立局部抽象或局部策略。只有跨服务稳定复用后，才将抽象、类型或工具上沉到 `shared`。

## 建设路线

1. QQ MVP：完成 QQ 文本消息接入、事件标准化、动作发送、基础人格、策略、LLM、风险模块和最小控制面。
2. 可观测和可回放：增加结构化日志、事件处理链路追踪、人格版本、策略版本、模型结果、Agent 运行记录和回放能力。
3. 多平台扩展：新增小红书、飞书等平台适配器，保持平台输入输出只通过 `contracts` 进入核心服务。
4. 风险管控增强：增加 Prompt 泄露防护、敏感内容检测、平台限流、用户信任等级、人工审核和高风险动作拦截。
5. Agent 能力平台：接入 OpenAI Agents SDK、MCP、中文 Skills 和 LangGraph 类长任务 Runner，并在控制面展示运行、权限、人工确认和回放入口。
