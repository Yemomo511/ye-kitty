# Code Agent 通用接入方案

## 目标

- 在 `services/llm/` 下构建通用 code agent 接入层，以声明式 AgentDef + streamFormat 分发 + 统一事件 union 的模式，支持接入 Claude Code、Codex CLI 等本地 code agent CLI 作为子进程。
- 接入层只做**进程编排 + 协议翻译**，不做会话历史治理、不做 prompt/skill 治理、不做工具决策（三条禁忌）。llm 服务的定位从单一 `LlmProviderPort.generateReply()` 扩展为"智能供应端"：高级抽象（回复生成）和低级抽象（code agent 事件流）并列。
- 第一消费者为 control-plane API（`POST /admin/code-agent/runs`），第二消费者为 agent-runtime harness（`AgentDecision` 新增 `delegate_code_agent` 分支）。两入口共享同一套基建。
- 参考 nexus-io/open-design 的 RuntimeAgentDef + streamFormat + 统一事件 + 阶梯取消 + resume 能力矩阵设计，在 ye-kitty 的场景下增加 risk 门禁 Hook 和安全层。

## 非目标（本方案不做的事）

- 不做跨 agent 会话共享和任务内 agent 切换（一个 task 绑定一个 agent，S2 会话结对属未来扩展）
- 不做 agent 产出文件的收集与归档（消费者自己读 workdir）
- 不做事件的持久化回放服务（MVP 事件只落 JSONL 日志；conversation 集成推迟到阶段二）
- 不做 agent 间负载均衡和自动路由（agentId 由调用方显式指定）
- 不做 ACP 协议兼容层（streamFormat 枚举预留 `acp-json-rpc` 值，不实现）
- 不做 resume（AgentDef 预留能力字段，MVP 全部 one-shot）
- 不迁移 agent-runtime 的 `openai-compatible-model.client.ts`（独立 PR）

## 当前状态

- 状态：开发中（Task 1-9 完成，Task 10 真实验证进行中；63 tests 全绿）
- 负责人：叶墨沫 + Claude Code
- 最近更新：2026-07-16
- 参考仓库：`D:\GitHub\open-design-ref`（nexus-io/open-design，已 shallow clone 到本地）
- 开发分支：从 `dev` 切出 `feat/code-agent-gateway`

## 架构决策

### 决策 1：llm 服务定位 = 智能供应端

```
llm/ports/
├── llm-provider.port.ts          # 已有：高级，"给我回复"（HTTP API 模型）
├── code-agent-runner.port.ts     # 新增：低级，"启动 agent 给我事件流"（stdio 子进程）
└── code-agent-registry.port.ts   # 新增：发现可用 agent + 能力查询
```

两条 port 同属"智能供应"层，差异仅是传输方式（HTTP vs stdio）和产出粒度（单结果 vs 事件流）。消费端（agent-runtime harness）不感知此差异。

### 决策 2：三条禁忌（对照 open-design 做法）

| 禁忌 | llm 不做的事 | open-design 做法 | ye-kitty 做法 |
|---|---|---|---|
| 会话历史 | 不存对话内容 | 只存 session handle（ID + hash + model + cwd）到 SQLite | llm 只存 `{agentDefId, sessionHandle, status}` 于内存注册表 + JSONL 事件日志；UI 回放（阶段二）抄 open-design `chat-run-messages.ts` 的 `events_json` 模式由 conversation 承载 |
| Prompt/Skill 治理 | 不构建认知 prompt | daemon 拼长 prompt（系统指令 + SKILL.md body + 设计系统） | harness 已做分章治理，llm 只发精简 task prompt（`{任务描述 + 约束引用 + workdir}`） |
| 工具决策 | 不决定是否执行工具 | `--permission-mode bypassPermissions` / auto approve all | **必须中间人**：工具透传事件给 harness，由 harness ToolExecutor 执行，结果经 `injectToolResult()` 注回。不同于 open-design 的全 bypass |

### 决策 3：open-design 可抄设计（两轮审查后共 11 项）

| # | 设计 | open-design 文件 | ye-kitty 对应 |
|---|------|-----------------|--------------|
| 1 | 声明式 AgentDef（plain object，非基类） | `runtimes/types.ts:98-250` | `llm/domain/code-agent-definition.ts` |
| 2 | streamFormat 分发 + `createJsonLineStream` 共享传输层 | `agent-protocol/core/json-line-stream.ts:23-123` | `llm/infrastructure/process/json-line-stream.ts`（抄并增强：原版对非 JSON 行静默丢弃，本实现增加 onRawLine 回调路由为 raw 事件） |
| 3 | 统一事件 discriminated union | `contracts/src/sse/chat.ts:106-143` | `contracts/code-agent/code-agent-event.contract.ts` |
| 4 | 阶梯取消（abort → 3s → SIGTERM → 3s → SIGKILL） | `runtimes/runs.ts:474-513` | Windows 退化为 `stdin.end() → 3s → taskkill /T /F` |
| 5 | resume = 5 种获取模式 + 能力矩阵（非布尔） | `contracts/src/api/agent-sessions.ts:13-21`（5 种 acquisition mode）+ `:95-105`（9 字段布尔能力矩阵） | AgentDef 预留字段，MVP 不做 resume |
| 6 | 进程印章（stamp 编码进 argv，启动时枚举清理孤儿进程） | `packages/platform/src/process.ts` | `session-lifecycle.ts` 启动时孤儿清理 |
| 7 | Windows 命令包裹（`cmd.exe /d /s /c` + `%` 转义） | `packages/platform/src/command.ts` | spawn `.cmd`/`.ps1` 二进制的正确姿势 |
| 8 | Prompt argv 预算（Windows 32KB） → 强制 stdin 传 prompt | `runtimes/prompt-budget.ts` | 所有 adapter `promptViaStdin: true`，argv 只放 flag |
| 9 | 失败分类 + retryable 标记 + error code 回退链 | `run-failure-classification.ts`、`run-result.ts:31-49` | `failure-classifier.ts`（9 类，见下） |
| 10 | 事件 ring buffer（2000 条）+ "背压是消费者的责任" | `runs.ts:167-194`、`critique/orchestrator.ts` | orchestrator 内 ring buffer，SSE 断连不阻塞子进程 |
| 11 | 假 agent 测试替身（fake CLI 脚本输出固定协议流） | `e2e/lib/playwright/fake-agents.ts`、`e2e/lib/vitest/mock-openai.ts` | 测试策略核心：fake-agent node 脚本 |

### 决策 4：消费者双入口模型（对标 open-design 的多入口同管线）

```
                    ┌── control-plane HTTP ──┐
                    │    POST /admin/code-agent/runs
CodeAgentRunnerPort │                         │──→ spawn → event stream
                    ├── harness AgentDecision ─┤
                    │    delegate_code_agent
                    └── 未来 Routines ────────┘
```

- A（control-plane API）：开发调试入口。**注意：control-plane 现状是零代码（仅 README）**，需用已有 `fastify` 依赖新建最小 HTTP server（仅注册 code-agent 路由 + API key 鉴权中间件），对标 open-design daemon 单一 server
- B（harness AgentDecision）：生产入口。orchestrator 是 llm 内部模块（in-process 调用），A 的 HTTP handler 只是它的薄封装——**阶段一即保证 in-process 接口是主接口**，HTTP 是附加层
- 两者共享同一套基建；MVP 只交付 A，验证通过后加 B，长期共存

### 决策 5：工具透传 → 中间人模式

```
code agent 产出 tool_use → llm 透传事件 → harness 接收 → harness 决策
  → harness 调用 ToolExecutor 执行 → port.injectToolResult() 注回子进程 stdin
```

llm 与 harness 之间是 in-process 调用（同进程模块），不需要跨服务通信协议。code agent 不直接执行任何工具。

### 决策 6：risk 门禁 = Hook 注入（不引入反向依赖）

`service-registry.ts` 已声明 risk `dependsOn: ['llm']`。risk 是 llm 的消费者，llm 不主动调 risk。

```typescript
interface CodeAgentGateHook {
  check(task: CodeAgentTask): string | null;  // null = 通过；string = 拒绝原因
}
```

注入方式：项目现有 DI 模式是手写 factory（参照 `qq-reply-agent.factory.ts`），无 IoC 容器。新建 `llm/application/code-agent.factory.ts` 作为组合根，risk 的 Hook 实现由 bootstrap 装配时传入 factory。`service-registry.ts` 只加依赖声明，不承担绑定。

### 决策 7：事件分发 = 直接 AsyncIterable，不走 EventBus

`EventBusPort` 文档标注"只用于系统级通用消息"。code agent 事件是点对点流（一个 session 一个消费者），走 `session.events()` 的 AsyncIterable。不广播、不进总线。未来若 control-plane 需要旁路监控，再评估。

## 组件设计

### 目录结构

```
packages/kitty-service/src/
├── contracts/
│   └── code-agent/
│       ├── code-agent-event.contract.ts     # 统一事件 union（11 种事件类型）
│       └── code-agent-task.contract.ts      # 任务提交契约
├── control-plane/
│   └── api/
│       ├── http-server.ts                   # 最小 fastify server + API key 鉴权（新建）
│       └── code-agent.controller.ts         # POST /admin/code-agent/runs（SSE）
└── services/llm/
    ├── ports/
    │   ├── llm-provider.port.ts             # 已有，不动
    │   ├── code-agent-runner.port.ts
    │   └── code-agent-registry.port.ts
    ├── domain/
    │   ├── code-agent-definition.ts         # CodeAgentDef（声明式配置对象）
    │   ├── code-agent-session.ts            # 会话状态机 + events() 迭代器
    │   ├── code-agent-event.ts              # 事件领域对象
    │   └── code-agent-failure.ts            # 失败分类枚举
    ├── application/
    │   ├── code-agent-orchestrator.service.ts  # 生命周期：spawn/超时/阶梯取消/ring buffer
    │   ├── code-agent-gate.service.ts          # Hook 链 + 门禁
    │   └── code-agent.factory.ts               # 组合根（手写 factory，同 qq-reply-agent.factory）
    └── infrastructure/
        ├── process/
        │   ├── json-line-stream.ts          # 共享传输层（抄 open-design core）
        │   ├── session-lifecycle.ts         # spawn/cancel/wait + 进程印章 + 孤儿清理
        │   ├── windows-command.ts           # cmd.exe 包裹 + % 转义（抄 platform/command.ts）
        │   └── process-env.ts               # per-agent env 白名单注入
        ├── adapters/
        │   ├── claude-code.adapter.ts       # streamFormat: claude-stream-json
        │   └── codex.adapter.ts             # streamFormat: json-event-stream
        ├── code-agent-registry.ts           # AGENT_DEFS 数组 + 探测
        ├── failure-classifier.ts            # 9 类失败分类
        └── code-agent-logger.ts             # LoggerPort 的第一个实现（全库目前无实现）
```

### Port 签名（完整版）

```typescript
// code-agent-runner.port.ts
interface CodeAgentRunnerPort {
  /** 提交任务。门禁拒绝时抛 CodeAgentGateRejectedError。session 创建即 queued */
  submit(task: CodeAgentTask): Promise<CodeAgentSession>;
  /** 查询 session（不存在返回 undefined）。用于监控/恢复场景 */
  getSession(sessionId: string): CodeAgentSession | undefined;
  /** 取消。幂等：不存在/已结束时静默返回；queued 时直接置 canceled 不 spawn */
  cancel(sessionId: string): Promise<void>;
  /** 中间人模式回写通道：harness 执行完工具后将结果注回子进程 stdin。
      会 reject：session 非 running 时抛 CodeAgentSessionClosedError；
      stdin 写入失败（EPIPE，子进程已死）时抛 CodeAgentPipeBrokenError（映射 pipe_broken 分类）。
      调用方（harness）必须处理这两类异常 */
  injectToolResult(sessionId: string, toolUseId: string, result: string, isError?: boolean): Promise<void>;
}

// code-agent-registry.port.ts
interface CodeAgentRegistryPort {
  listAgents(): CodeAgentCapability[];
  getAgent(id: string): CodeAgentCapability | undefined;
  refresh(): Promise<void>;  // 重新探测本地 CLI 可用性
}

// CodeAgentCapability = AgentDef 的只读能力投影（不含 buildArgs 等内部函数）
interface CodeAgentCapability {
  id: string;
  name: string;
  available: boolean;              // 探测结果
  version?: string;
  unavailableReason?: string;      // 探测失败诊断（含 fixActions 建议）
  supportsWorkdir: boolean;
  supportsImagePaths: boolean;
  resumeModes: string[];           // MVP 恒为 []
}
```

### CodeAgentSession（domain）

```typescript
interface CodeAgentSession {
  readonly id: string;             // llm 生成（uuid），与 agent 内部 sessionId（流中捕获）分离
  readonly agentDefId: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  /** 事件流。queued 状态即可订阅：先回放已有事件（可能为空），再阻塞续接实时事件，直到 session_end。
      支持多消费者：每次调用 events() 返回独立游标，各自回放 + 续接，互不瓜分事件。
      回放只保证 ring buffer 内最近 2000 条；溢出时回放流的第一个事件为
      { type: 'status', label: 'replay_truncated' }，全量事件以 JSONL 日志为准（审计用途）。
      消费者应在 submit 后立即订阅以避免截断。背压是消费者的责任，断连不阻塞子进程 */
  events(): AsyncIterable<CodeAgentEvent>;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly failure?: CodeAgentFailure;   // status=failed 时非空
}
```

分层说明：ring buffer 由 orchestrator（application 层）持有；`CodeAgentSession` 是 orchestrator 创建的句柄对象，构造时注入一个 `EventStreamReader` 接口（domain 层定义接口，application 层实现），session 不反向引用 orchestrator，无循环依赖。

### CodeAgentTask 契约

```typescript
interface CodeAgentTask {
  agentId: string;                 // 调用方显式指定，不自动路由
  prompt: string;                  // 经 stdin 传递（argv 只放 flag，规避 Windows 32KB）
  workdir: string;                 // 调用方负责创建和清理；llm 校验存在性
  model?: string;                  // 透传给 CLI 的 --model
  extraInstructions?: string;      // 附加约束（如"不要修改测试文件"），拼接进 prompt 尾部
  timeoutOverrides?: { sessionMs?: number; inactivityMs?: number };  // 覆盖 AgentDef 默认
  source: 'control-plane' | 'harness';   // 门禁 Hook 的准入判断依据
}
```

### 统一事件契约（11 种）

```typescript
type CodeAgentEvent =
  | { type: 'status'; sessionId: string; label: string; model?: string }
  | { type: 'text_delta'; sessionId: string; delta: string }
  | { type: 'thinking_start'; sessionId: string }
  | { type: 'thinking_delta'; sessionId: string; delta: string }
  | { type: 'tool_use'; sessionId: string; id: string; name: string; input: unknown }
  | { type: 'tool_input_delta'; sessionId: string; id: string; name: string; delta: string }
  | { type: 'tool_result'; sessionId: string; toolUseId: string; content: string; isError?: boolean }
  | { type: 'usage'; sessionId: string; inputTokens: number; outputTokens: number; costUsd?: number; durationMs: number }
  | { type: 'error'; sessionId: string; failure: CodeAgentFailure }
  | { type: 'raw'; sessionId: string; line: string }       // adapter JSON 解析成功但事件类型未识别时兜底，不丢弃
  | { type: 'session_end'; sessionId: string; status: 'succeeded' | 'failed' | 'canceled'; exitCode: number | null };
                                                            // 终端事件：消费者以此判断流结束
```

SSE 映射（control-plane）：`event: <type>`、`data: <JSON.stringify(event)>`，`session_end` 后服务端关闭连接。

### 失败分类（9 类，MVP 全覆盖）

| code | 含义 | retryable |
|---|---|---|
| `spawn_failure` | 二进制不存在/不可执行/版本探测失败 | ✗ |
| `auth_failure` | CLI 未登录/token 过期（stderr 正则，抄 `auth.ts:206` 的通用分类正则） | ✗ |
| `inactivity_timeout` | 空闲超时（无 stdout 输出超 `inactivityTimeoutMs`） | ✓ |
| `session_timeout` | 总时长超 `sessionTimeoutMs` | ✗ |
| `process_exit` | 非零退出码（exit code + 最后 20 行 stderr 入 failure.detail） | 视 stderr 分类 |
| `protocol_mismatch` | adapter 连续 N 行解析失败（CLI 升级导致 wire format 变化） | ✗ |
| `workspace_failure` | workdir 不存在/无权限/磁盘满 | ✗ |
| `pipe_broken` | stdin 写入失败（injectToolResult 时子进程已死） | ✗ |
| `queue_timeout` | queued 超 `CODE_AGENT_QUEUE_TIMEOUT_MS` 未获得执行槽 | ✓ |

`CodeAgentFailure = { code, message, retryable, detail?: string }`。重试不在 llm 层做，消费者依据 `retryable` 自行决定（对标 open-design `run-retry-policy.ts`，其指数退避策略留给阶段二 harness 消费方）。

子进程 exit 语义：`exitCode 0 + 已收到完整输出 → succeeded`；`非零 → failed(process_exit)`；`被 cancel 杀死 → canceled`（cancel 竞态：取消发起后到达的事件仍写入 buffer，但 session_end.status 恒为 canceled）。

### AgentDef 声明结构

```typescript
interface CodeAgentDef {
  id: string;                           // "claude-code" | "codex"
  name: string;
  bin: string;                          // 可执行文件名（Windows 下自动尝试 .exe/.cmd/.ps1，经 windows-command.ts 包裹）
  fallbackBins?: string[];
  versionArgs: string[];
  buildArgs: (task: Omit<CodeAgentTask, 'prompt'>) => string[];
                                        // 类型层拿不到 prompt（强制 stdin 传递）；引擎 spawn 前
                                        // 另做 argv 预算检查（抄 prompt-budget.ts，Windows 32KB），
                                        // 超预算直接 spawn_failure 并指明 adapter bug（双保险）
  streamFormat: 'claude-stream-json' | 'json-event-stream' | 'acp-json-rpc' | 'plain';
  promptViaStdin: true;                 // 恒为 true（Windows argv 32KB 预算）
  promptViaFile?: boolean;              // 超长 prompt 回退（预留）
  inactivityTimeoutMs: number;          // 默认取 env CODE_AGENT_INACTIVITY_TIMEOUT_MS；AgentDef 覆盖 env，task.timeoutOverrides 覆盖 AgentDef
  sessionTimeoutMs: number;             // 同上优先级：task > AgentDef > env
  maxConcurrentSessions: number;        // 同一 agent 的并发上限（默认 1）
  supportsImagePaths?: boolean;
  supportsWorkdir?: boolean;
  resumesSession?: boolean;             // MVP 恒 false，预留
  capturesSessionIdFromStream?: boolean;// true 时 adapter 从流中捕获 agent 内部 sessionId 存入 handle（为 resume 预留）
  envAllowList?: string[];              // 允许透传的环境变量（默认空 = 不传任何敏感变量）
  capabilityFlags?: Record<string, string>;
}
```

### 会话状态机与生命周期

```
queued → running → succeeded / failed / canceled
   └──(queue timeout)──→ failed(queue_timeout)
   └──(cancel)─────────→ canceled（不 spawn）
```

并发与排队规则：
- 提交时依次检查：全局上限（`CODE_AGENT_MAX_CONCURRENT_SESSIONS`）→ per-agent 上限（`AgentDef.maxConcurrentSessions`），任一满则入队
- 全局单队列 FIFO；slot 释放时从队首扫描，**跳过因 per-agent 限制暂不能运行的任务**取下一个可运行者（防头阻塞）
- 被跳过任务不会饥饿死等：`CODE_AGENT_QUEUE_TIMEOUT_MS` 兜底置 `failed(queue_timeout)`（retryable）

生命周期钩子：
- 服务优雅关闭：bootstrap 关闭钩子（对齐 `scripts/start-platform-qq.ts` 的 `stopRuntime()` 模式）遍历注册表 cancel 所有 running session
- 孤儿清理：spawn 时在 env 附加进程印章标记；服务启动时枚举带印章的残留进程并 taskkill（抄 `platform/process.ts` stamp 模式）
- 阶梯取消（Windows）：`stdin.end() → 等 3s → taskkill /PID <pid> /T /F`

### 数据流分层职责

```
子进程 stdout（raw bytes）
  → json-line-stream（chunk 分行、跨 chunk JSON 还原）        [传输层：无状态]
  → adapter（原始事件 → 统一事件映射；捕获 agent 内部 sessionId）[协议层：仅映射，不管理状态]
  → orchestrator（状态机更新、超时看门狗、ring buffer、门禁）    [编排层：唯一状态持有者]
  → consumer（control-plane SSE / harness）                    [消费层：背压与重试的责任方]
```

## 对照 open-design 的遗漏点处理（三轮审查合并）

### 实施阶段一（本分支 MVP）：基建 + control-plane API

| # | 项 | 处理 |
|---|---|---|
| A1 | 子进程生命周期基建 | session 注册表 + 状态机 + 优雅关闭钩子 + 孤儿清理（stamp） |
| A2 | streamFormat 分发 + json-line-stream | 抄 `core/json-line-stream.ts`；Claude Code + Codex 两个 adapter |
| A3 | 超时结构 | inactivity + session 两层，优先级 task > AgentDef > env |
| A4 | Per-agent env 白名单 | `envAllowList` 默认空，抄 `runtimes/env.ts` 模式 |
| A5 | Agent 探测 | 抄 `detection.ts`（version + capability + auth 并发探测，fault isolation） |
| A6 | 启动失败诊断 | 抄 `diagnostics.ts` fixActions 模式，入 `CodeAgentCapability.unavailableReason` |
| A7 | 失败分类 | 9 类（上表），exit code 语义明确 |
| A8 | stderr 过滤 | per-adapter 噪音行过滤（抄 `amr-stderr-filter.ts` 模式） |
| A9 | 结构化日志 | **注意：`LoggerPort` 全库无实现**。本模块做第一个实现（`code-agent-logger.ts`），并扩展 `LogContext` 增加 `sessionId`/`traceId` 字段 |
| A10 | Windows 命令包裹 | 抄 `platform/command.ts`（cmd.exe /d /s /c + % 转义） |
| A11 | control-plane HTTP server | **零基础新建**：最小 fastify server + API key 鉴权 + SSE 管线（非"加一条路由"） |
| A12 | 背压 | ring buffer 2000 条，消费者断连不阻塞子进程 |
| A13 | 测试替身 | fake-agent node 脚本（按 streamFormat 输出固定协议流），覆盖崩溃/挂起/乱码场景 |

### 实施阶段二（harness 接入）

| # | 项 | 处理 |
|---|---|---|
| B1 | 工具中间人协议 | `injectToolResult()` 回写通道 + harness ToolExecutor 接管 |
| B2 | risk 门禁 Hook | `CodeAgentGateHook` + risk 实现 + factory 组合根装配 |
| B3 | AgentDecision 扩展 | **5 个硬编码点必须同步改**：`toAgentDecision()`、`isFinalAgentDecision()`（否则 delegate 被误判为 final）、`toRunResult()`（否则静默降级 human_review）、`getDecisionTarget()`、harness 主循环分支；外加 `AgentRuntimeRunResult` union 扩展 |
| B4 | 工作区模板 | temp / git-clone / persistent 三种 + 清理策略 |
| B5 | 工具循环检测 | 抄 `tool-loop-guard.ts` |
| B6 | conversation 事件回放 | 抄 open-design `chat-run-messages.ts` 的 `events_json` 模式，需扩展 `ConversationMessage` 模型（现只有 `text`，无法承载结构化事件） |
| B7 | 消费方重试策略 | 依据 `retryable` + 指数退避（抄 `run-retry-policy.ts` 按类别 base delay） |

### 实施阶段三（安全加固 + 生产化）

| # | 项 | 处理 |
|---|---|---|
| C1 | 角色标记幻觉检测 | 抄 `role-marker-guard.ts` |
| C2 | 资源限制 | `maxMemoryMb` / `maxDiskMb` / `networkPolicy` |
| C3 | 秘密扫描 | 工具结果正则脱敏（`sk-...`、`AKIA...` 等模式） |
| C4 | 跨会话工作区隔离 | per-session temp dir + 符号链接逃逸检测 |
| C5 | 二进制完整性 | AgentDef 可选 `binaryIntegrity: { sha256 }` |
| C6 | 诊断导出 | 抄 `diagnostics/` zero-copy tail + 脱敏管线 |
| C7 | 生命周期打点 | 抄 `run-lifecycle-tracer.ts`（16 标记点） |
| C8 | Actor 模型兼容 | 评估 CodeAgentActor 或绕开 actor 框架（长任务不可 batch 封口/idle 淘汰） |

## 开发顺序

1. 创建 `feat/code-agent-gateway` 分支（从 `dev`）。
2. 定义 contracts：`code-agent-event.contract.ts`（11 事件）+ `code-agent-task.contract.ts`。
3. 实现 domain：`CodeAgentDef`、`CodeAgentSession`（含 events() 迭代器语义）、`CodeAgentFailure`。
4. 实现 infrastructure：
   - `json-line-stream.ts`（抄 open-design）
   - `windows-command.ts`（cmd.exe 包裹）
   - `session-lifecycle.ts`（spawn/cancel/wait + stamp 孤儿清理）
   - `process-env.ts`（envAllowList）
   - `claude-code.adapter.ts` + `codex.adapter.ts`
   - `code-agent-registry.ts`（AGENT_DEFS + 探测 + 诊断）
   - `failure-classifier.ts`（9 类）
   - `code-agent-logger.ts`（LoggerPort 首个实现 + LogContext 扩展）
5. 实现 application：`code-agent-orchestrator.service.ts`（ring buffer + 看门狗）+ `code-agent-gate.service.ts` + `code-agent.factory.ts`（组合根）。
6. 实现 ports：`code-agent-runner.port.ts`（submit/getSession/cancel/injectToolResult）+ `code-agent-registry.port.ts`。
7. 新建 control-plane HTTP server（fastify + API key 鉴权）+ `POST /admin/code-agent/runs`（SSE）。
8. bootstrap 集成：启动装配（factory）+ 优雅关闭钩子 + 孤儿清理。
9. 编写测试：fake-agent 脚本替身 + 事件序列回放 + 取消/超时/崩溃/乱码/并发测试。
10. 验证：本地 Claude Code CLI 真实调用通过 → 合并。
11. 阶段二：harness AgentDecision 集成（独立 PR，含 B3 的 5 个硬编码点清单）。

## 配置需求

`.env.template` 新增：

```env
# Code Agent CLI 路径（可选，不设则从 PATH 探测）
# CODE_AGENT_CLAUDE_PATH=
# CODE_AGENT_CODEX_PATH=

# Code Agent 超时（毫秒）；优先级 task > AgentDef > env
CODE_AGENT_SESSION_TIMEOUT_MS=1800000    # 30 分钟硬上限
CODE_AGENT_INACTIVITY_TIMEOUT_MS=300000  # 5 分钟无输出终止

# 并发与排队
CODE_AGENT_MAX_CONCURRENT_SESSIONS=2     # 全局并发上限（超出的 submit 保持 queued）
CODE_AGENT_QUEUE_TIMEOUT_MS=60000        # queued 超时后置 failed

# 工作区
CODE_AGENT_WORKSPACE_ROOT=./data/code-agent-workspaces

# control-plane 鉴权
CODE_AGENT_API_KEY=                      # 空 = control-plane API 不启动
```

## 阻塞与风险

| 问题 | 影响 | 下一步 |
|---|---|---|
| Windows 无 SIGTERM，阶梯取消退化为两级 | 无法优雅通知 agent 收尾，可能留半写文件 | stdin.end() → 3s → taskkill /T /F；工作区隔离兜底 |
| control-plane 是零代码 | "暴露一条路由" 实为新建 HTTP 层 | 最小 fastify server，只服务 code-agent，API key 门禁 |
| `LoggerPort` 全库无实现 | A9 依赖的日志基建需从零建 | 本模块内做第一个实现，其他服务后续迁移 |
| `toAgentDecision()` 等 5 处硬编码 | 阶段二 delegate 分支若遗漏任一处会静默降级 human_review | B3 清单固化 5 个改动点，加针对性测试 |
| `ConversationMessage` 只有 text 字段 | code agent 事件无法入 conversation 回放 | 阶段二扩展模型（events_json 模式），MVP 不做回放 |
| agent-runtime 直连模型绕过 llm | llm 定位价值有限 | 本次不修，三 port 留迁移口，独立 PR |
| Actor 重构 batch 封口/idle 淘汰与长任务冲突 | actor 框架可能杀死 code agent session | 阶段三评估 CodeAgentActor 或绕开 |
| 子进程资源不受限 | 恶意/错误 agent 可 DoS 服务 | 阶段三资源限制；MVP 靠 workdir 隔离 + 超时 + 并发上限 |
| 外部消息可触发任意代码执行 | 最高安全风险 | risk Hook 三层门禁；MVP 仅 control-plane API（API key，不对外） |

## 验收总览

- **开发验收**：`POST /admin/code-agent/runs` 可启动 Claude Code CLI 子进程，SSE 流式返回 11 类事件，`session_end` 正确终止流，可中途取消
- **架构验收**：AgentDef 声明式注册（加新 agent 不改引擎），消费方只依赖事件 union，能力差异用声明字段表达
- **安全验收**：API key 鉴权；code agent 不直接执行工具；envAllowList 默认空；服务重启后无孤儿进程
- **非功能验收**：并发 N session 压力测试通过；cancel 后进程树确已终止（taskkill 验证）；长时间 event stream 无内存泄漏；fake-agent 崩溃/挂起/乱码场景全通过
- **设计验收**：本文档与 `design-docs/Task.md` 状态一致，代码实现、测试和进度同步回写

## 变更记录

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-07-16 | 初始设计 | 头脑风暴完成，确定架构决策、组件设计、开发顺序 |
| 2026-07-16 | 第二轮审查合入 | 修复 port 签名矛盾（submit/events）、新增 session_end 终端事件与 injectToolResult 回写通道、枚举 8 类失败、定义持久化与孤儿清理（stamp）、背压（ring buffer）、SSE 映射、优雅关闭；确认 control-plane 零代码现状、LoggerPort 无实现、阶段二 5 个硬编码改动点、ConversationMessage 模型限制；新增非目标章节、Windows 命令包裹、fake-agent 测试策略、并发/鉴权配置 |
| 2026-07-16 | 第三轮审查合入 + 第四轮收敛判定 | 修复 7 个实质问题：events() 回放截断语义（replay_truncated + JSONL 双轨）、双并发限值组合规则（全局 FIFO + 跳过防头阻塞）、queued→failed(queue_timeout) 迁移与第 9 类失败、queued 状态可订阅语义、injectToolResult 异常契约（SessionClosedError / PipeBrokenError）、ring buffer 归属（EventStreamReader 接口注入）、buildArgs 类型强制（Omit prompt + argv 预算双保险）。第四轮审查确认无实质性新发现，B3 五个硬编码点与代码行号一一对应，设计定稿 |
