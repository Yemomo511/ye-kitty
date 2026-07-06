---
name: agent-harness-eval
description: 当 Codex 需要为 Ye-Kitty 的 Agent Runtime Harness 编写、调整或审查大模型评估测试时使用。适用于新增 eval case、验证 tool_call、skill_call、skill_reference_call、reply、ignore、human_review 等结构化决策协议、将真实模型评估接入 pnpm check warning-only 流程，或区分单元测试、Prompt 契约测试和真实模型 eval。
---

# Agent Harness Eval

## 核心目标

为 Ye-Kitty 编写 Agent/Harness 评估测试时，只验证模型是否遵守结构化调用协议、是否命中预期工具或 Skill、是否进入正确终态，不验证自然语言回复内容。

## 测试分层

1. 确定性单元测试：测试本地代码，如 JSON 解析、非法动作过滤、工具预算、Skill 加载和 fallback。可以精确断言字段值。
2. Prompt 契约测试：测试 Prompt 是否包含 Harness 协议、可见工具、Skill 目录和观察消息。不得调用真实模型。
3. 真实模型 eval：调用真实 `OpenAiHarnessAgentRunner`，只断言结构化决策类型、工具名、Skill 名、引用路径和最终状态。

不要把 mock Runner 固定返回某个结果的测试称为大模型能力测试。mock Runner 只能证明 Harness 能处理该结果，不能证明真实模型会按预期调用。

## Eval 设计规则

- Eval case 必须写清输入场景、可见 Skill、可见 Tool、已启用 Skill 或引用观察，以及期望决策。
- 断言只允许检查协议结构：`type`、`toolName`、`skillName`、`referencePath`、是否属于允许终态。
- 不断言 `reply.text` 的具体文案，只允许验证 `reply` 类型存在且结构合法。
- 如果新增 Harness 决策类型、工具、Skill 注入方式或 references 读取方式，必须同步新增或更新 eval case。
- 真实模型 eval 失败应输出中文报告，包含 case 名称、输入摘要、期望结构、实际决策或错误原因。
- 缺少模型环境时不得伪装通过，应输出 `⚠️` 跳过原因；接入 `pnpm check` 时只能 warning-only。

## Ye-Kitty 协议重点

当前 Harness 接受六类决策：

- `tool_call`：请求 Harness 执行可见工具。
- `skill_call`：请求 Harness 启用可见 Skill 正文。
- `skill_reference_call`：请求读取已启用 Skill 的 references 文件。
- `reply`：信息充分且风险可控时回复。
- `ignore`：不需要参与时静默。
- `human_review`：安全、隐私、权限、合规或平台边界不清时转人工。

评估必须围绕这些协议写，而不是围绕模型“说得像不像”写。

## 工作流程

1. 先读取当前 `AgentDecision`、Harness Prompt、工具注册表和 Skill 注入路径。
2. 判断要测的是单元逻辑、Prompt 契约还是真实模型行为。
3. 对真实模型 eval，优先构造最小观察输入，让模型只能在少量合法决策之间选择。
4. 写断言时只验证调用意图和结构，不验证自然语言内容。
5. 将 eval 接入 warning-only 检查，避免模型波动、网络或环境缺失阻断普通工程校验。
6. 运行 `pnpm --filter @ye-kitty/kitty-service eval:agent` 做严格验证，运行 `pnpm check` 验证 warning-only 接入。
