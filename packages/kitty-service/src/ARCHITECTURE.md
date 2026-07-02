# Kitty Service MVP 架构

该包承载 Ye-Kitty 的服务层。MVP 阶段采用模块化单体架构，但以微服务形态划分边界，确保后续可以在不修改领域契约的前提下，将模块迁移到 HTTP、RPC、队列或 Worker 进程之后。

## 依赖方向

```text
bootstrap
  -> control-plane
  -> platforms
  -> services
  -> contracts
  -> shared
```

规则：

- `shared` 不依赖任何服务模块或平台模块。
- `shared/types` 统一存放跨模块共享的类型、接口和结构体定义。
- `contracts` 只包含跨服务共享的事件和动作 DTO。
- `services/*/domain` 存放业务对象和服务内局部值类型。
- `services/*/application` 编排单个服务边界内的用例流程。
- `services/*/ports` 定义入站接口和出站接口。
- `services/*/infrastructure` 适配数据库、队列、SDK 和模型提供方。
- `platforms/*` 将平台特定载荷转换为统一契约，并执行平台动作。
- `control-plane` 读取服务状态并修改配置，但不能绕过服务端口直接访问基础设施。
- `bootstrap` 是唯一负责组装具体实现的地方。

## MVP 消息流

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

## 服务边界

- `event-gateway`：接收原始入口数据，标准化事件，执行去重，并发布聊天事件。
- `conversation`：负责会话、参与者和近期消息上下文。
- `persona`：负责 Ye-Kitty 人格版本和启用规则。
- `policy`：判断事件应当触发回复、拒绝、人工审核还是静默处理。
- `llm`：构造模型请求，并返回结构化生成结果。
- `risk`：在对外发送前检查生成内容。
- `actions`：持久化并执行对外社交动作。

每个边界都优先暴露端口。后续可以在不修改调用方的情况下补充基础设施实现。
