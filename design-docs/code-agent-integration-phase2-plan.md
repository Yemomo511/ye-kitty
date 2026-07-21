# Code Agent 通用接入 — Phase 2 (Harness 接入) 执行计划

> 基于 `code-agent-integration.md` 设计定稿 Phase 2 · 2026-07-18 · 与 Phase 1 联动
> 分支：从 `dev` 切出 `feat/code-agent-gateway-phase2`
> 依赖：Phase 1 基础设施已在 dev 中就绪

## Phase 2 目标

QQ 群消息 → agent-runtime harness 判断 → 自动委托 code agent 执行任务 → 结果返回 QQ。

核心链路：
```
QQ 群消息 → harness.LlmProviderPort.decide()
  → AgentDecision { type: "delegate_code_agent", prompt: "..." }
    → CodeAgentRunnerPort.submit(task)
      → spawn code agent CLI → SSE 事件流
        → tool_use 事件 → harness gatekeeper 审批 → 继续/终止
        → 最终结果 → harness 聚合成 reply → 发送 QQ 回复
```

## 架构决策（新增）

### Gatekeeper 审批模型（vs Phase 1 的中间人执行）

```
                    ┌── harness 批准 ──→ stdin 写入"同意"
code agent 发出     │                       code agent 继续执行
  tool_use ──→ harness + risk 评估 ──┤
                    └── harness 拒绝 ──→ 告知用户原因 + cancel session
                                          优雅释放资源
```

- harness **不需要实现** Bash/Write/Edit 等工具
- harness **需要知道** code agent 支持哪些工具 + 风险级别（高风险 / 中风险 / 只读）
- code agent 的 `--tools ""` 禁掉 → 改为不加此参数，让 code agent 拥有完整工具集
- 审批通过 → stdin 写入 tool_result 格式的确认（code agent 继续）
- 审批拒绝 → `runner.cancel(sessionId)` 优雅终止

### Harness prompt 扩展

Harness system prompt 新增章节，描述 code agent 的能力：

```
## 2.x 委托 Code Agent

当当前请求需要以下能力时，应优先考虑 delegate_code_agent 而非尝试手工操作：
- 文件操作（创建/修改/删除任意文件）
- 终端命令执行
- 代码审查 / 仓库分析
- 数据爬取 / 文件处理
- 需要长时间执行的多步骤任务

Code Agent 支持的内置工具及风险级别：
| 工具 | 风险 | 说明 |
| Bash | 高风险 | 执行任意 Shell 命令 |
| Write | 高风险 | 创建/覆盖文件 |
| Edit | 高风险 | 修改文件内容 |
| Grep | 低风险 | 文件内容搜索 |
| Read | 低风险 | 读取文件内容 |
| WebSearch | 中风险 | 网络搜索 |
| WebFetch | 中风险 | 抓取网页内容 |
```

### risk 门禁三层

| 层级 | 检查点 | 策略（保守起步） |
|---|---|---|
| 准入层 | 触发者身份 | 仅 QQ 群管理员 + 群主。`senderId` 匹配白名单。私聊暂不开放。 |
| 执行层 | code agent 发出的每个 `tool_use` | 高风险操作（Bash/Write/Edit/rm 命令）→ harness 暂停，等待 review。低风险（Read/Grep）→ 自动批准。 |
| 产出层 | code agent 完成后的工作区产物 | 沙箱复制到 review 目录，harness 或管理员检查后放行到实际工作区。 |

## 文件清单

```
packages/kitty-service/src/services/
├── agent-runtime/
│   ├── domain/
│   │   └── agent-decision.ts                    ← [修改] +delegate_code_agent 分支（+20行）
│   ├── ports/
│   │   └── agent-runtime-harness.port.ts        ← [修改] +code_agent_run_result（+10行）
│   ├── application/
│   │   ├── agent-runtime-harness.ts             ← [修改] 决策分发 +code_agent 分支（+60行）
│   │   └── code-agent-executor.ts               ← [新增] delegate_code_agent 执行器（~150行）
│   ├── infrastructure/
│   │   ├── openai-harness-agent-runner.ts       ← [修改] toAgentDecision 加分支（+15行）
│   │   └── prompt/
│   │       └── harness.prompt.ts                ← [修改] code agent 能力章节（+30行）
│   └── __test__/
│       ├── code-agent-executor.test.ts          ← [新增] 审批/拒绝/终止/正常流程（~120行）
│       └── agent-decision-delegate.test.ts      ← [新增] delegate 决策不被误判为 final（~80行）
├── risk/
│   └── infrastructure/
│       └── code-agent-risk-gate.ts              ← [新增] risk Hook 实现（三层门禁）（~200行）
├── llm/
│   ├── application/
│   │   └── code-agent-gate.service.ts           ← [修改] 注入 risk hook 到 gate chain（±5行）
│   └── infrastructure/
│       └── process/
│           └── sandbox-review.ts                ← [新增] 沙箱 review 逻辑（复制/放行/清理）（~80行）`[待审计]`
├── control-plane/
│   └── api/
│       └── code-agent.controller.ts             ← [修改] +review approve/reject 路由（±20行）
└── bootstrap/
    └── code-agent-bootstrap.ts                  ← [修改] factory 装配 risk hook（±10行）

packages/kitty-service/src/
├── contracts/
│   └── code-agent/
│       └── code-agent-event.contract.ts         ← [修改] tool_use 事件 +approvalStatus（+10行）
└── shared/types/
    └── ids.ts                                   ← [修改] Platform 类型 ... +code_agent 来源标记？视需要

.env.template                                     ← [修改] 准入白名单配置
design-docs/Task.md                               ← [修改] Phase 2 登记
design-docs/code-agent-integration.md             ← [修改] 状态回写
```

**改动量**：新增 ~580 行 | 修改 ~160 行

**关键：B3 的 5 个硬编码点全部在修改清单中**

## 依赖 DAG 与执行顺序

```
Task 2.1 ─┬─ domain/agent-decision.ts (+delegate_code_agent)
          └─ contracts/code-agent/ (+approvalStatus)
               ↓
Task 2.2 ─── infrastructure/prompt/harness.prompt.ts（code agent 能力章节）
               ↓
Task 2.3 ─── risk/infrastructure/code-agent-risk-gate.ts（三层门禁实现）
               ↓
Task 2.4 ─── llm/application/code-agent-gate.service.ts（注入 risk hook）
               ↓
Task 2.5 ─── application/code-agent-executor.ts（gatekeeper 审批循环）
               ↓
Task 2.6 ─── infrastructure/openai-harness-agent-runner.ts（toAgentDecision + 3函数）
          └─ ports/agent-runtime-harness.port.ts (+code_agent_run_result)
          └─ application/agent-runtime-harness.ts（主循环分发）
               ↓
Task 2.7 ─── bootstrap 装配 + .env.template
               ↓
Task 2.8 ─── 2 个测试文件（+ pnpm check 全绿）
               ↓
Task 2.9 ─── 联调验证（QQ 群消息 → code agent → 实际干活 → QQ 回复）
```

## 逐 Task 详细规格

### Task 2.1：AgentDecision + 事件契约扩展（2 个修改文件）

`domain/agent-decision.ts`：
```typescript
// 新增分支
export interface DelegateCodeAgentDecision {
  type: 'delegate_code_agent';
  agentId: string;           // "claude-code"
  prompt: string;            // 任务描述
  workdirTemplate?: 'temp' | 'git-clone' | 'sandbox';  // 默认 sandbox
  reason: string;            // harness 为何选择委托
}

// AgentDecision union 加项
export type AgentDecision =
  | ToolCallDecision
  | SkillCallDecision
  | SkillReferenceCallDecision
  | ReplyDecision
  | IgnoreDecision
  | HumanReviewDecision
  | DelegateCodeAgentDecision;  // ← 新增
```

`contracts/code-agent/code-agent-event.contract.ts`：
```typescript
// tool_use 事件增加审批状态
export interface CodeAgentToolUseEvent {
  ... // 原有字段
  readonly approvalStatus?: 'pending' | 'approved' | 'rejected';
}
```

### Task 2.2：Harness prompt 扩展（1 个修改文件）

`infrastructure/prompt/harness.prompt.ts` 的 outside context 章节新增 code agent 能力描述表（工具列表 + 风险级别 + 适用场景），让 LLM 知道何时选 `delegate_code_agent`。

### Task 2.3：risk 门禁实现（1 个新增文件）

`risk/infrastructure/code-agent-risk-gate.ts`：
- 实现 `CodeAgentGateHook` 接口
- 准入层：读取 `YE_KITTY_CODE_AGENT_ADMIN_QQ` 环境变量配置的白名单 QQ 号列表，检查 `senderId`
- 执行层：`classifyToolRisk(toolName)` 函数返回工具风险级别（high/medium/low）。高风险 → `check()` 返回拒绝原因（待 review），低风险 → null（自动通过）
- 产出层：`reviewOutput(workdir)` 函数，将产出复制到 `review/` 目录，返回"待管理员检查"的提示

#### 沙箱机制（产出层详细实现）`[待审计]`

code agent 的 workdir 是隔离的临时目录（sandbox），完成任务后产出不自动提交，需 review 通过才放行。

```
Code agent 执行
  workdir: ./data/code-agent-workspaces/task-{uuid}/    ← 沙箱（code agent 只能在这里操作）
  完成后 →
    session_end(succeeded)
      → orchestrator 自动将沙箱复制到 review 区:
        ./data/code-agent-workspaces/review/task-{uuid}/
      → 通知 harness: "任务完成，产出待 review"
      → 管理员查看 review 区内容
        ├─ 通过: POST /admin/code-agent/review/:id/approve → 复制到实际目标目录
        └─ 拒绝: POST /admin/code-agent/review/:id/reject → 删除沙箱 + review 区
  reject 后或超时未审核（24h）→ 自动清理 review 区
```

| 层面 | 实现位置 | 逻辑 |
|---|---|---|
| 隔离 | gate service（已有） | workdir = `task-{uuid}` 独立目录，天然隔离 |
| 保留 | orchestrator | `session_end(succeeded)` 时**不删** workdir，复制到 `review/` |
| 审核 | control-plane API（新增） | `POST /admin/code-agent/review/:id/approve` / `reject` |
| 放行 | executor | approve 后 `cp -r` 到目标路径 |
| 清理 | orchestrator | reject 或 24h 超时 → `rm -rf` review 区 |

> **[待审计]** 当前方案仅用目录隔离，未用 Docker/虚拟机。如 code agent 被诱导执行 `rm -rf /` 或读取敏感文件（`.env`、`~/.ssh`），目录隔离无法防御。后续 Phase 3 安全加固需评估容器隔离方案。

### Task 2.4：risk hook 注入（1 个修改文件）

`llm/application/code-agent-gate.service.ts`：factory 中将 `CodeAgentRiskGate` 注册到 gate chain。

### Task 2.5：Code Agent Executor（1 个新增文件，核心）

`application/code-agent-executor.ts`：

职责：
1. 接收 `DelegateCodeAgentDecision` → 构建 `CodeAgentTask` → 调用 `CodeAgentRunnerPort.submit()`
2. 消费 session.events() 流
3. 遇到 `tool_use` 事件 → 调 risk gate check → approved（批准，stdin 写 tool_result 确认）或 rejected（拒绝 → cancel session → 结果入 AgentObservation）
4. 收集最终结果（text_delta 累加）→ 构造 `AgentObservation` 回灌 harness
5. 处理 `session_end(succeeded)` → 触发沙箱 review 流程（复制到 review 区）+ 聚合结果给 harness

### Task 2.6：Harness 管线改造（3 个修改文件）

这是 B3 的 5 个硬编码点：

| # | 文件 | 函数 | 改动 |
|---|---|---|---|
| 1 | `openai-harness-agent-runner.ts` | `toAgentDecision()` | +`delegate_code_agent` 解析分支 |
| 2 | `agent-decision.ts` | `isFinalAgentDecision()` | `delegate_code_agent` 标记为 final（harness 不再自己回复，等 code agent 结果） |
| 3 | `agent-runtime-harness.ts` | `toRunResult()` | 新增 `code_agent_run` 结果类型，防止静默降级 human_review |
| 4 | `agent-runtime-harness.ts` | `getDecisionTarget()` | 新增 code-agent 目标 |
| 5 | `agent-runtime-harness.ts` | harness 主循环 | `decision.type` 分发 → `delegate_code_agent` → 调 code-agent-executor |

`ports/agent-runtime-harness.port.ts`：
```typescript
// AgentRuntimeRunResult union 加项
export type AgentRuntimeRunResult =
  | ...  // 原有
  | { type: 'code_agent_run'; sessionId: string; result: string; session: CodeAgentSession };
```

### Task 2.7：Bootstrap 装配 + 配置（2 个文件）

`bootstrap/code-agent-bootstrap.ts`：factory 调用时传入 risk hook：`createCodeAgentRuntime({ extraHooks: [createCodeAgentRiskGate(config)] })`

`.env.template`：
```env
# Phase 2 - Code Agent 准入
YE_KITTY_CODE_AGENT_ADMIN_QQ=1274997936
# code agent 高风险操作确认（true = 自动批准 Bash/Write/Edit，false = 每次暂停等待确认）
YE_KITTY_CODE_AGENT_AUTO_APPROVE_HIGH_RISK=false
```

### Task 2.8：测试（2 个新增测试文件）

`code-agent-executor.test.ts`（10 cases）：
- 正常流程：delegate → submit → tool_use → approve → 继续 → succeeded
- 拒绝流程：delegate → submit → tool_use → reject → cancel → failed
- 终止流程：delegate → cancel mid-task → canceled
- 低风险自动通过：Read/Grep → 不触发 reject
- 高风险暂停：Bash/Write → 等待 review
- 产出 review：succeeded 后产出入 sandbox/review/

`agent-decision-delegate.test.ts`（5 cases）：
- delegate 不被 isFinalAgentDecision 误判
- delegate 不被 toRunResult 静默降级
- delegate 不被 getDecisionTarget 漏掉
- harness prompt 渲染后可见 code agent 描述

### Task 2.9：联调验证

1. QQ 群发消息"帮我分析一下 packages/kitty-service 的代码结构" → harness 选 delegate → code agent 执行 → 结果回复到 QQ
2. 管理员身份通过 → 非管理员被拒绝
3. 高风险工具（如"删掉 build 目录"）→ 暂停等确认
4. 产出在 review 目录可见

## 与 Phase 1 的联动

Phase 1 已实现并在 Phase 2 中复用的：
| 组件 | Phase 1 状态 | Phase 2 用法 |
|---|---|---|
| `CodeAgentRunnerPort` | ✅ submit/events/cancel/injectToolResult | code-agent-executor 直接调用 |
| `CodeAgentGateHook` | ✅ 接口 + workdir 内置 hook | risk 实现此接口注入 |
| `CodeAgentGateRejectedError` | ✅ | risk 拒绝时抛出 |
| `CodeAgentSession.events()` | ✅ SSE + ring buffer | gatekeeper 消费事件流 |
| `runner.cancel(sessionId)` | ✅ 阶梯取消 | 拒绝时优雅终止 |
| fake-agent fixture | ✅ 7 场景 | code-agent-executor 测试替身 |

## 与 Phase 1 的设计差异

| 设计点 | Phase 1（旧理解） | Phase 2（正确理解） |
|---|---|---|
| 工具执行权 | harness 替 code agent 执行 | code agent 自己执行，harness 审批 |
| `--tools ""` | 禁用全部工具 | **不加**此参数，让 code agent 拥有完整工具集 |
| `injectToolResult` 用途 | harness 执行完写入结果 | harness 写审批确认（同意/拒绝） |
| harness 职责 | 实现 code agent 的工具 | 只需知道工具清单 + 风险级别，不实现 |

## 校验门

| 门 | 要求 |
|---|---|
| 5 个硬编码点 | 逐一核验，不能遗漏 |
| pnpm check | 全绿 |
| 测试 | 新文件覆盖率 perFile ≥ 80% |
| 中文 | 注释/错误消息/日志 全中文 |
| 架构 | agent-runtime 不直接 import llm/infrastructure，通过 port 调用 |
| 安全 | 非管理员 QQ 消息不可触发 code agent |
