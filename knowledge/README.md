# Ye-Kitty 知识库

本目录用于沉淀 Ye-Kitty 的长期项目知识，帮助后续开发者、产品设计者和 Agent 在同一套背景下理解项目。README.md 负责给出项目总览，本目录负责承载更细的架构、模块、能力边界和落地约束。

## 阅读入口

- [总体架构知识](architecture-overview.md)：说明 Ye-Kitty 的目标、MVP 范围、模块边界、依赖方向和 QQ 消息处理链路。
- [Agent Runtime Harness 设计知识](Agent/agent-runtime-harness.md)：说明 `agent-runtime` 如何连接业务规则、Skill、MCP 工具权限和底层 Agent Runner。

## 文档分层

```text
README.md
  -> 项目定位、核心目标、建设路线和开发约定

knowledge/
  -> 长期有效的项目知识、架构约束、模块边界和能力说明

design-docs/
  -> 具体迭代方案、任务进度、验收标准和阶段性设计决策
```

当某个内容已经稳定成为项目长期约束时，应从 `design-docs` 同步到 `knowledge`。当某个内容仍处于迭代讨论、方案对比或验收阶段时，应优先放在 `design-docs`。

## 维护原则

- 所有文档使用中文，避免中英混杂造成理解成本。
- 知识文档应描述真实代码路径和真实运行边界，不写脱离当前项目的泛化架构。
- 修改核心架构、模块边界、启动入口或 Agent 运行约束时，应同步检查本目录是否需要更新。
- 如果 README 中引用了 `knowledge` 文档，必须确保对应文件存在且内容能独立阅读。
