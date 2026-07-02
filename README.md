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

暂不优先实现：

- 多平台完整接入。
- 图片、语音、视频理解。
- 复杂长期记忆。
- 自动发帖和主动运营。
- 高级攻击检测和完整风控体系。

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
  shared/           # 共享类型、抽象、策略和模板
```

### shared

`shared` 只放跨模块共享的稳定能力，不放具体业务流程。

```text
shared/types        # 共享结构体、接口、类型定义
shared/abstracts    # 可继承的共同抽象类
shared/strategies   # 策略注册、选择、执行能力
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
- `llm`：构造模型请求并返回结构化生成结果。
- `risk`：在外部发送前检查生成内容。
- `actions`：持久化并执行对外社交动作。

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

项目优先采用模板方法模式和策略模式沉淀可复用能力。

### 模板方法模式

具有固定处理流程的应用服务应优先继承 `TemplateUseCase`。

适用场景：

- 事件接入流程。
- 回复生成流程。
- 动作执行流程。
- 风险检查流程。

模板负责固定流程，子类只实现核心步骤或必要钩子。

```text
execute
  -> beforeExecute
  -> validate
  -> executeCore
  -> afterExecute
  -> onError
```

### 策略模式

具有多种可替换算法或决策路径的能力应优先实现 `Strategy`，并通过 `StrategyRegistry` 选择执行。

适用场景：

- 回复触发策略。
- 群聊和私聊策略。
- 风险判断策略。
- 模型供应商选择策略。
- 平台动作执行策略。

策略对象应只关心自己是否适用，以及如何执行当前策略。

### 能力抽象

新能力应先设计接口或抽象类，再让具体子类通过实现接口或继承抽象类获得能力。

优先顺序：

1. 在 `shared/types` 定义能力接口。
2. 在 `shared/abstracts` 定义可复用基类。
3. 在具体服务的 `ports` 定义服务边界接口。
4. 在具体服务的 `infrastructure` 实现外部依赖。
5. 在 `bootstrap` 组装具体实现。

## 一次 QQ 消息的处理流程

```text
1. QQ Adapter 收到 QQ 原始消息
2. platforms/qq 转换为 ChatEventContract
3. event-gateway 标准化、去重并发布事件
4. conversation 读取会话和近期上下文
5. persona 选择当前人格版本
6. policy 判断是否回复、拒绝、转人工或静默
7. llm 构造模型请求并生成候选回复
8. risk 检查回复内容
9. actions 创建并执行 OutgoingAction
10. platforms/qq 发送消息
11. 全链路记录事件、决策、动作和执行结果
```

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

### 第三阶段：多平台扩展

- 新增小红书、飞书等平台适配器。
- 保持平台输入输出只通过 `contracts` 进入核心服务。
- 复用 `services` 中的人格、策略、风险和动作能力。

### 第四阶段：风险管控增强

- 增加 Prompt 泄露防护。
- 增加敏感内容检测。
- 增加平台限流和用户信任等级。
- 增加人工审核和高风险动作拦截。

## 开发约定

- 项目文档、Prompt、代码注释优先使用中文。
- 修改架构时同步更新 `packages/kitty-service/src/ARCHITECTURE.md`。
- 修改共享类型、抽象或策略能力时同步更新本 README。
- 每个服务优先通过 `ports` 暴露能力，不让调用方直接依赖基础设施。
- 每次修改后运行服务包验证：

```bash
cd packages/kitty-service
npm test
```
