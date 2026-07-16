# Code Agent 通用接入 — Phase 1 (MVP) 执行计划

> 基于 `code-agent-integration.md` 设计定稿 · 2026-07-16 · 四轮审查收敛 + 仓库规范审查 + 六维度复审修订（v3）
> 参考实现：`D:\GitHub\open-design-ref`（本地 clone，抄写时逐文件对照）
> 开发纪律：**TDD**（`packages/kitty-service/AGENTS.md` 测试规范）——本计划已前置提出全部测试用例；每 Task 内顺序为 用例核对 → 红灯测试 → 实现 → 绿灯。

## Git 策略

```
dev ← feat/code-agent-gateway
      ├── 新增：25 个源文件 + 8 个测试文件 + 1 个 fake-agent 测试替身
      └── 修改：9 个现有文件
```

提交纪律：每个 Task 一个 commit（Continuous Checkpoint），commit 前跑该 Task 定向测试 + `pnpm check`。

---

## 文件清单

```
packages/kitty-service/src/
├── contracts/code-agent/
│   ├── code-agent-event.contract.ts        ← [新增] 11 种事件 union（~60行）
│   └── code-agent-task.contract.ts         ← [新增] CodeAgentTask + source 枚举（~30行）
├── control-plane/api/
│   ├── http-server.ts                      ← [新增] 最小 fastify server + API key 鉴权（~80行）
│   ├── code-agent.controller.ts            ← [新增] /admin/code-agent/* 路由（SSE）（~90行）
│   └── README.md                           ← [修改] 追加 code-agent 路由组说明（+5行）
├── services/llm/
│   ├── ports/
│   │   ├── code-agent-runner.port.ts       ← [新增] submit/getSession/cancel/injectToolResult（~40行）
│   │   └── code-agent-registry.port.ts     ← [新增] listAgents/getAgent/refresh + Capability（~35行）
│   ├── domain/
│   │   ├── code-agent-definition.ts        ← [新增] CodeAgentDef（~55行）
│   │   ├── code-agent-session.ts           ← [新增] Session 接口 + EventStreamReader 接口（~45行）
│   │   ├── code-agent-event.ts             ← [新增] 事件领域对象 + 类型守卫（~50行）
│   │   ├── code-agent-failure.ts           ← [新增] 9 类失败枚举 + CodeAgentFailure（~35行）
│   │   └── code-agent-errors.ts            ← [新增] GateRejected/SessionClosed/PipeBroken 错误类（~30行）
│   ├── application/
│   │   ├── code-agent-orchestrator.service.ts ← [新增] 状态机/排队/看门狗/ring buffer（~280行）
│   │   ├── code-agent-gate.service.ts      ← [新增] Hook 链 + workdir 内置校验（~40行）
│   │   └── code-agent.factory.ts           ← [新增] 组合根（先例：qq-reply-agent.factory.ts）（~60行）
│   ├── infrastructure/
│   │   ├── process/
│   │   │   ├── json-line-stream.ts         ← [新增] 抄 open-design core（~150行）
│   │   │   ├── session-lifecycle.ts        ← [新增] spawn/cancel/印章/孤儿清理（~160行）
│   │   │   ├── windows-command.ts          ← [新增] cmd.exe 包裹 + % 转义（~60行）
│   │   │   ├── process-env.ts              ← [新增] envAllowList 白名单（~40行）
│   │   │   └── argv-budget.ts              ← [新增] Windows 30KB argv 预算检查（~30行）
│   │   ├── adapters/
│   │   │   ├── claude-code.adapter.ts      ← [新增] AgentDef + claude-stream-json mapper（~140行）
│   │   │   └── codex.adapter.ts            ← [新增] AgentDef + json-event-stream mapper（~130行）
│   │   ├── code-agent-registry.ts          ← [新增] AGENT_DEFS + 三并发探测 + 诊断（~120行）
│   │   ├── failure-classifier.ts           ← [新增] 9 类分类 + stderr 正则（~90行）
│   │   └── code-agent-logger.ts            ← [新增] LoggerPort 首个实现（~50行）
│   └── __test__/
│       ├── fixtures/
│       │   └── fake-agent.mjs              ← [新增] 测试替身 CLI，7 场景（~140行）
│       ├── json-line-stream.test.ts        ← [新增] 用例 T3-1~T3-8（~90行）
│       ├── windows-command.test.ts         ← [新增] 用例 T3-9~T3-10（~50行）
│       ├── claude-code-adapter.test.ts     ← [新增] 用例 T4-1~T4-6、T4-22（~90行）
│       ├── codex-adapter.test.ts           ← [新增] 用例 T4-7~T4-12、T4-23（~90行）
│       ├── failure-classifier.test.ts      ← [新增] 用例 T4-13~T4-21（~70行）
│       ├── code-agent-registry.test.ts     ← [新增] 用例 T5-1~T5-6（~70行）
│       ├── code-agent-orchestrator.test.ts ← [新增] 用例 T6-1~T6-23（~280行）
│       └── code-agent-http.test.ts         ← [新增] 用例 T7-1~T7-8（~110行）
├── shared/types/logger.ts                  ← [修改] LogContext +sessionId +traceId（+2行）
├── bootstrap/
│   └── code-agent-bootstrap.ts             ← [新增] 装配 + 优雅关闭钩子 + 孤儿清理（~70行）
├── ARCHITECTURE.md                         ← [修改] llm 服务边界扩写 + code agent 约束小节（+15行）
└── index.ts                                ← [修改] +2 导出（contracts/code-agent）

packages/kitty-service/
├── package.json                            ← [修改] +test:coverage:code-agent 脚本（+1行）
└── scripts/start.ts                        ← [修改] CODE_AGENT_API_KEY 存在时并行启动 code-agent runtime；现有控制流为平台二选一分支，改并行需小幅重构（±25行）

.env.template                               ← [修改] +8 个 CODE_AGENT_* 变量
design-docs/Task.md                         ← [修改] 进度回写
design-docs/code-agent-integration.md       ← [修改] 状态回写
```

**改动量**：新增 ~2950 行（源 ~1970 + 测试/夹具 ~990）| 修改 ~50 行

---

## 测试用例总表（计划阶段前置提出，实现不得迎合修改）

> 约定：每个用例先写红灯，实现后转绿。共 70 例（T3×10 + T4×23 + T5×6 + T6×23 + T7×8）。覆盖率门槛：新文件 perFile lines/functions/branches/statements ≥ 80%（对齐 `test:coverage:qq-harness` 模式）。

### T3 process 基建（10 例：json-line-stream 8 + windows-command 2）

| # | 用例 | 类型 |
|---|---|---|
| T3-1 | 单 chunk 单行完整 JSON → onMessage 一次 | 正常 |
| T3-2 | 单 chunk 多行 JSON → onMessage 多次、顺序保持 | 正常 |
| T3-3 | 一条 JSON 跨两个 chunk 切断 → 还原后 onMessage 一次 | 边界 |
| T3-4 | pretty-printed 多行 JSON（对象跨行）→ 正确聚合 | 边界 |
| T3-5 | 非 JSON 行（纯文本）→ onRawLine 回调、不抛错 | 异常 |
| T3-6 | 半截 JSON 后进程结束（流 end）→ 残留内容走 onRawLine | 异常 |
| T3-7 | 超长行（>128KB）→ 按上限截断走 onRawLine、不 OOM | 边界 |
| T3-8 | 空 chunk / 仅换行符 chunk → 无回调、无异常 | 边界 |
| T3-9 | windows-command: bin 路径含空格 → 包裹后引号正确、可解析 | 边界 |
| T3-10 | windows-command: bin/workdir 路径含中文 + `%` 字符 → 转义正确、无环境变量展开 | 边界 |

### T4 adapters + failure-classifier（23 例）

| # | 用例 | 类型 |
|---|---|---|
| T4-1 | claude: `text_delta` 流事件 → 统一 `text_delta` | 正常 |
| T4-2 | claude: `content_block_start(tool_use)` + `input_json_delta` → `tool_use` + `tool_input_delta` | 正常 |
| T4-3 | claude: `message_stop` + usage 字段 → `usage` 事件 | 正常 |
| T4-4 | claude: 流中 `session_id` 字段 → 捕获入 handle | 正常 |
| T4-5 | claude: 未识别事件类型 → `raw` 兜底 | 异常 |
| T4-6 | claude: buildArgs 不含 prompt 内容（类型 + 运行时断言） | 安全 |
| T4-7 | codex: `thread.started` → `status` + 捕获 thread_id | 正常 |
| T4-8 | codex: `item.started(command_execution)` → `tool_use(name:'Bash')` | 正常 |
| T4-9 | codex: `item.completed(agent_message)` → `text_delta` | 正常 |
| T4-10 | codex: `turn.completed` → `usage` | 正常 |
| T4-11 | codex: `error` 事件 → 统一 `error` | 异常 |
| T4-12 | codex: 未识别事件 → `raw` 兜底 | 异常 |
| T4-13 | classifier: 二进制不存在（ENOENT）→ `spawn_failure` / retryable=false | 异常 |
| T4-14 | classifier: stderr 含 auth 正则命中 → `auth_failure` | 异常 |
| T4-15 | classifier: inactivity 定时器触发 → `inactivity_timeout` / retryable=true | 异常 |
| T4-16 | classifier: session 总时长触发 → `session_timeout` | 异常 |
| T4-17 | classifier: exit 非零 + 普通 stderr → `process_exit`（尾 20 行入 detail） | 异常 |
| T4-18 | classifier: 连续 N 行解析失败 → `protocol_mismatch` | 异常 |
| T4-19 | classifier: workdir 不存在 → `workspace_failure` | 异常 |
| T4-20 | classifier: stdin EPIPE → `pipe_broken` | 异常 |
| T4-21 | classifier: 队列超时 → `queue_timeout` / retryable=true | 异常 |
| T4-22 | claude: `thinking` 内容块事件 → `thinking_start` + `thinking_delta` | 正常 |
| T4-23 | codex: `item.completed(command_execution)` → `tool_result`（含 isError 分支） | 正常 |

### T4 说明

T4 共 23 例：claude 映射 7（T4-1~6、T4-22）、codex 映射 7（T4-7~12、T4-23）、classifier 9（T4-13~21）。

### T5 registry + lifecycle（6 例）

| # | 用例 | 类型 |
|---|---|---|
| T5-1 | 两个 def，一个探测成功一个 bin 不存在 → available 分别 true/false，互不影响（fault isolation） | 异常 |
| T5-2 | 探测函数抛异常 → 该 agent unavailable + 诊断文本，refresh 不 reject | 异常 |
| T5-3 | version 探测输出解析 → `CodeAgentCapability.version` 正确 | 正常 |
| T5-4 | argv 超预算 → spawn 前抛错（→ spawn_failure） | 安全 |
| T5-5 | envAllowList 生效：白名单外变量不透传、Windows 必需变量保留、印章注入 | 安全 |
| T5-6 | envAllowList 大小写不敏感（Windows `Path` vs `PATH` 同一变量）→ 系统必需变量任一大小写均保留、白名单匹配忽略大小写 | 边界 |

### T6 orchestrator（23 例）

| # | 用例 | 类型 |
|---|---|---|
| T6-1 | happy path：submit → running → 事件流 → exit 0 → succeeded + session_end | 正常 |
| T6-2 | gate hook 返回拒绝原因 → submit 抛 GateRejectedError、不 spawn | 安全 |
| T6-3 | 全局并发满 → 第 N+1 个 submit 进 queued | 正常 |
| T6-4 | per-agent 满、全局未满 → 同 agent 第二个 queued，异 agent 可运行 | 正常 |
| T6-5 | 队首因 per-agent 受限被跳过 → 队列后位可运行者先执行（防头阻塞） | 边界 |
| T6-6 | queued 超时 → failed(queue_timeout) + session_end | 异常 |
| T6-7 | queued 状态 cancel → canceled、不 spawn | 边界 |
| T6-8 | running 中 cancel → 阶梯取消、session_end(canceled)；取消后到达事件仍入 buffer | 竞态 |
| T6-9 | cancel 不存在/已结束的 session → 静默幂等 | 边界 |
| T6-10 | inactivity 超时（fake-agent hang 场景）→ failed(inactivity_timeout) | 异常 |
| T6-11 | 子进程 crash（exit 1）→ failed(process_exit) + failure.detail 含 stderr | 异常 |
| T6-12 | events() 在 queued 时订阅 → 收到后续全部事件直到 session_end | 边界 |
| T6-13 | events() 迟订阅 → 回放 buffer + 续接；溢出 2000 时首发 replay_truncated | 边界 |
| T6-14 | injectToolResult 于 running → stdin 收到正确 JSON | 正常 |
| T6-15 | injectToolResult 于已结束 session → 抛 SessionClosedError；stdin 已断 → 抛 PipeBrokenError | 竞态 |
| T6-16 | shutdown() → 全部 running 被 cancel、注册表清空 | 正常 |
| T6-17 | session 总时长超限（fake-agent busy-loop 持续输出场景）→ failed(session_timeout)，证明双看门狗独立 | 异常 |
| T6-18 | 连续解析失败（fake-agent garbage 场景）→ failed(protocol_mismatch) + session_end 正常发出，消费者不 hang | 异常 |
| T6-19 | cancel 一个 running → slot 释放 → queued 任务被推进执行 | 竞态 |
| T6-20 | queue timeout 与 slot 释放同 tick 到达 → 状态不翻转（failed 后不得再变 running，反之亦然） | 竞态 |
| T6-21 | events() 两个消费者同时订阅 → 各自独立游标，事件不被瓜分、两边序列完整 | 边界 |
| T6-22 | stdout 有效事件与 stderr 噪音交错 → 事件正常发出、classifier 不误判 | 边界 |
| T6-23 | ring buffer 达 2000 上限 → 旧事件被释放（buffer 长度恒 ≤2000）、迟订阅收到 replay_truncated | 边界 |

### T7 control-plane HTTP（8 例）

| # | 用例 | 类型 |
|---|---|---|
| T7-1 | 无 API key 配置 → server 不启动 | 安全 |
| T7-2 | 错误 Bearer → 401 | 安全 |
| T7-3 | POST /admin/code-agent/runs（fake-agent happy）→ SSE 全事件序列 + session_end 后连接关闭 | 正常 |
| T7-4 | body 缺 agentId/workdir → 400 | 异常 |
| T7-5 | GET /admin/code-agent/agents → capability 列表 | 正常 |
| T7-6 | DELETE /admin/code-agent/runs/:id → session canceled | 正常 |
| T7-7 | SSE 客户端断连 → session 不被取消、继续跑完 | 边界 |
| T7-8 | SSE 断连与 DELETE cancel 同时发生 → 无 handle-after-free、无重复关闭异常 | 竞态 |

---

## 依赖关系与执行顺序

```
Task 1 ─┬─ contracts/code-agent/ 2 个文件
        └─ src/index.ts（+2 导出）
             ↓
Task 2 ─┬─ domain/ 5 个文件
        ├─ shared/types/logger.ts（+sessionId/traceId）
        └─ 删除 llm/{domain,application,infrastructure}/.gitkeep
             ↓
Task 3 ─── infrastructure/process/ 4 文件（先红灯 T3-1~T3-10）
             ↓
Task 4 ─── adapters 2 + failure-classifier（先红灯 T4-1~T4-23）
             ↓
Task 5 ─── registry + logger + session-lifecycle（先红灯 T5-1~T5-6）
             ↓
Task 6 ─── ports 2 + orchestrator + gate + factory（先红灯 T6-1~T6-23，用 fake-agent fixture）
             ↓
Task 7 ─── control-plane http-server + controller + README（先红灯 T7-1~T7-8）
             ↓
Task 8 ─┬─ bootstrap/code-agent-bootstrap.ts + scripts/start.ts 集成
        ├─ .env.template + package.json coverage 脚本
        └─ src/ARCHITECTURE.md 更新
             ↓
Task 9 ─── 覆盖率补全（perFile 80% 四指标）+ pnpm check 全绿
             ↓
Task 10 ── 真实验证（本地 Claude Code CLI）+ design-docs 回写
```

fake-agent fixture（`__test__/fixtures/fake-agent.mjs`）在 Task 6 红灯前编写（它是 T6/T7 用例的前置工装，非被测对象，无覆盖率要求）。

---

## 逐 Task 详细规格

### Task 1：contracts + index 导出

#### `contracts/code-agent/code-agent-event.contract.ts` [新增]

设计文档"统一事件契约"的 11 种事件 union 原样落地。要点：
- `CodeAgentEventContract` discriminated union，判别字段 `type`
- `session_end`：`{ type: 'session_end'; sessionId; status: 'succeeded'|'failed'|'canceled'; exitCode: number | null }`
- `error` 携带 `failure: CodeAgentFailureContract`
- 全部 `readonly`，注释中文

#### `contracts/code-agent/code-agent-task.contract.ts` [新增]

```typescript
export type CodeAgentTaskSource = 'control-plane' | 'harness';

export interface CodeAgentTaskContract {
  readonly agentId: string;
  readonly prompt: string;              // 恒经 stdin 传递
  readonly workdir: string;             // 调用方创建和清理，llm 校验存在性
  readonly model?: string;
  readonly extraInstructions?: string;
  readonly timeoutOverrides?: { readonly sessionMs?: number; readonly inactivityMs?: number };
  readonly source: CodeAgentTaskSource; // 门禁准入依据
}
```

#### `src/index.ts` [修改]

追加 `export * from './contracts/code-agent/code-agent-event.contract'` 与 task contract 导出（对齐现有 contracts 导出模式）。

### Task 2：domain + logger 扩展

- `domain/code-agent-failure.ts`：9 类失败码枚举 + `CodeAgentFailure` 接口 + retryable 常量表
- `domain/code-agent-definition.ts`：AgentDef；`buildArgs: (task: Omit<CodeAgentTaskContract, 'prompt'>) => string[]`；`promptViaStdin: true` 字面量；`maxConcurrentSessions`（默认 1）
- `domain/code-agent-session.ts`：`CodeAgentSession` + `EventStreamReader` 接口（ring buffer 归 application，domain 只定义读取接口）
- `domain/code-agent-event.ts`：事件领域对象 + 类型守卫
- `domain/code-agent-errors.ts`：`CodeAgentGateRejectedError` / `CodeAgentSessionClosedError` / `CodeAgentPipeBrokenError`
- `shared/types/logger.ts`：`LogContext` +`sessionId?` +`traceId?`（不动现有字段）

纯类型/纯错误类无行为，不设测试（覆盖率由消费方测试覆盖）。

### Task 3：process 基建（红灯 T3-1~T3-10 → 实现）

- `json-line-stream.ts`：抄 `open-design-ref/apps/daemon/src/agent-protocol/core/json-line-stream.ts:23-320`（跨 chunk 还原、多行 JSON 上限 256 行/128KB）。**ye-kitty 增强（非照抄）**：open-design 原版对非 JSON 行静默丢弃，本实现增加 `onRawLine` 回调将其路由为 `raw` 事件（`onMessage`/`onRawLine` 双回调）
- `windows-command.ts`：抄 `packages/platform/src/command.ts`（`.cmd`/`.ps1` 经 `cmd.exe /d /s /c` 包裹、`%` 转义、空格引号）；导出 `resolveSpawnCommand(bin, args)`
- `process-env.ts`：`buildAgentEnv(def, stamp)` 白名单 + Windows 必需变量保留 + 印章 `KITTY_CODE_AGENT_SESSION=<id>`
- `argv-budget.ts`：`assertArgvBudget(args)`，Windows 上限 30KB，超限抛错 → spawn_failure

### Task 4：adapters + 失败分类（红灯 T4-1~T4-23 → 实现）

- `claude-code.adapter.ts`：对照 `defs/claude.ts` + `claude-stream.ts`。`bin: 'claude'`，`buildArgs` 含 `--print --input-format stream-json --output-format stream-json --verbose`（`--verbose` 为 open-design `defs/claude.ts` 实际参数，缺失会导致流中 usage 等字段不全）；**不加** `--permission-mode bypassPermissions`；MVP 禁工具参数：首选 `--tools ""`（禁用全部内置工具集），若本机版本不支持则回退 `--disallowedTools`——Task 4 红灯前以 `claude --help` 实测锁定；工具桥接留阶段二；`capturesSessionIdFromStream: true`
- `codex.adapter.ts`：对照 `defs/codex.ts` + `json-event-stream.ts:658-817`。`buildArgs` 含 `exec --json`
- `failure-classifier.ts`：`classifyFailure({ exitCode, signalOrKilled, stderrTail, phase, timedOutKind })`；auth 正则抄 `runtimes/auth.ts:206-267`

### Task 5：registry + logger + lifecycle（红灯 T5-1~T5-6 → 实现）

- `code-agent-registry.ts`：`AGENT_DEFS = [claudeCodeDef, codexDef]`；`refresh()` per-agent 三并发探测（version/capability/auth）+ `safeProbe` fault isolation（抄 `detection.ts:199-313`）；失败产出 `unavailableReason`
- `session-lifecycle.ts`：`spawnAgent(def, task, env)`（windows-command 包裹 + argv 预算 + prompt 写 stdin）；`cancelProcess(child)` 阶梯 `stdin.end() → 3s → taskkill /PID /T /F`（POSIX 分支 SIGTERM→3s→SIGKILL）；`cleanupOrphans()` 按印章枚举清理
- `code-agent-logger.ts`：`LoggerPort` 首个实现；结构化单行 JSON → console + 可选 JSONL（`logs/code-agent/<sessionId>.jsonl`）

### Task 6：ports + application（先写 fixtures/fake-agent.mjs → 红灯 T6-1~T6-23 → 实现）

#### `__test__/fixtures/fake-agent.mjs` [新增]

按 `FAKE_AGENT_SCENARIO` env 输出预设协议流：`happy-claude` / `happy-codex` / `crash` / `hang` / `garbage` / `slow-exit`（收到 stdin end 后 5s 才退出，测 taskkill 阶梯）/ `busy-loop`（持续输出 text_delta 不停止，测 session 总时长看门狗）。

#### `application/code-agent-orchestrator.service.ts` [新增] —— 核心

实现 `CodeAgentRunnerPort`，8 项职责（与设计文档逐条对应）：
1. `submit`：gate.check → 建 session(queued) → 并发检查（先全局后 per-agent）→ 可运行则 spawn，否则入全局 FIFO
2. 排队：slot 释放时队首扫描、跳过 per-agent 受限任务；queue timeout 置 `failed(queue_timeout)`
3. ring buffer：每 session 2000 条；`events()` 回放 + 续接；溢出首发 `replay_truncated`；全量落 JSONL
4. 看门狗：inactivity（任意 stdout 重置）+ session 总时长双定时器
5. `injectToolResult`：非 running 抛 SessionClosedError；EPIPE 抛 PipeBrokenError
6. `cancel`：幂等；queued 直接 canceled；running 走阶梯；取消后事件仍入 buffer，`session_end.status` 恒 canceled
7. close 处理：exit 0 → succeeded；非零 → classifier → failed；发 `session_end` 关闭流
8. `shutdown()`：遍历 cancel（bootstrap 关闭钩子调用）

#### 其余

- `ports/` 2 个 port 文件（签名见设计文档"Port 签名（完整版）"）
- `code-agent-gate.service.ts`：Hook 链；内置 workdir hook（存在性 + 规范化后必须位于 `CODE_AGENT_WORKSPACE_ROOT` 之下，防 `..` 逃逸）
- `code-agent.factory.ts`：`createCodeAgentRuntime(config, hooks): { runner, registry, shutdown }`

### Task 7：control-plane（红灯 T7-1~T7-8 → 实现）

- `http-server.ts`：fastify；`CODE_AGENT_API_KEY` 空则不启动；`onRequest` 校验 `Authorization: Bearer`；仅监听 `127.0.0.1`
- `code-agent.controller.ts`（**路由前缀 `/admin`，对齐 control-plane README 既有约定**）：
  - `POST /admin/code-agent/runs`：body 校验 → `runner.submit()` → SSE（`event: <type>` / `data: <json>`），`session_end` 后关闭；断连仅取消订阅、不 cancel session
  - `GET /admin/code-agent/agents`：`registry.listAgents()`
  - `DELETE /admin/code-agent/runs/:id`：`runner.cancel()`
- `api/README.md`：追加 code-agent 路由组三条 + "写路由需 Bearer 鉴权"说明

### Task 8：bootstrap + 配置 + 架构文档

- `bootstrap/code-agent-bootstrap.ts`：`startCodeAgentRuntime()`：读 env → `cleanupOrphans()` → factory 装配 → 启动 http-server → 返回 `{ stop }`（http close → orchestrator.shutdown()）
- `scripts/start.ts` [修改]：对齐"项目统一启动入口位于 scripts/start.ts"约束——`CODE_AGENT_API_KEY` 存在时并行启动 code-agent runtime，并接入现有优雅关闭链
- `.env.template`：追加设计文档"配置需求"8 个变量
- `package.json`：+`test:coverage:code-agent`（对齐 `test:coverage:qq-harness` 模式，perFile 四指标 80%）
- `src/ARCHITECTURE.md` [修改]：
  - "服务边界"章 llm 条目扩写：`llm：构造模型请求并返回结构化生成结果；同时作为智能供应端承载 code agent 子进程编排（进程编排 + 协议翻译，不做会话/Prompt/工具治理）`
  - 新增 "llm code agent 约束" 小节（三条禁忌、中间人模式、risk Hook、control-plane 入口、印章清理）
  - MVP 消息流补 `control-plane -> services/llm -> code agent 子进程` 入口

### Task 9：覆盖率补全

`pnpm test:coverage:code-agent` 全部新增实现文件 perFile 四指标 ≥ 80%；`pnpm check` 全绿。

### Task 10：真实验证 + 回写

1. 本地 `claude --version` 探测通过 → `POST /admin/code-agent/runs`（workdir 下写一个文件的简单任务）→ SSE 全程事件正确 → `session_end(succeeded)`
2. 中途 `DELETE` 取消 → `Get-Process` 验证进程树已终止
3. `design-docs/Task.md` 状态改"待验收" + 本文档与设计文档补验收结果
4. `pnpm check` 全绿 → 最终 commit

---

## 校验门（每 Task 通过后方可 commit）

| 门 | 命令 | 要求 |
|---|---|---|
| TDD 顺序 | 人工检查 | 该 Task 用例先红灯（commit 历史可见测试先行） |
| Lint + 格式 + 测试 | `pnpm check` | 全绿 |
| 定向测试 | `pnpm vitest run src/services/llm/__test__/<本Task>` | 全绿 |
| 覆盖率 | `pnpm test:coverage:code-agent`（Task 9 起） | perFile 四指标 ≥ 80% |
| 架构约束 | `pnpm validate:architecture` + 人工 | domain 不依赖 infrastructure；contracts 零依赖；llm 不 import risk/agent-runtime；依赖方向符合 ARCHITECTURE.md |
| 中文约束 | 人工检查 | 注释/日志/错误消息全中文 |

## 明确不在本计划内（阶段二/三，另立计划）

- harness `delegate_code_agent` 集成（含 5 个硬编码点改造）
- risk 服务的 `CodeAgentGateHook` 实现（MVP 只有 workdir 内置 hook）
- 工具中间人桥接的 harness 侧（`injectToolResult` port 本期实现但无调用方）
- conversation 事件回放、resume、工具循环检测、角色标记检测、资源限制

## 变更记录

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-07-16 | 初版执行计划 | 设计定稿转化为可执行任务 |
| 2026-07-16 | v2：仓库规范审查修订 | TDD 前置测试用例总表（57 例）并调整每 Task 顺序为红灯先行；路由改 `/admin/code-agent/*` 对齐 control-plane README；补 `src/ARCHITECTURE.md`、`src/index.ts`、`package.json` coverage 脚本、`scripts/start.ts` 统一入口集成、control-plane README 修改项；fake-agent 移至 `__test__/fixtures/` |
| 2026-07-16 | v3：六维度复审修订 | 测试用例 57→70（补 session_timeout/protocol_mismatch 编排器层、thinking/tool_result 映射、cancel→队列推进、queue_timeout×slot 竞态、events() 多消费者、stdout/stderr 交错、windows-command 空格/中文路径、env 大小写、buffer 上限内存、SSE 断连×cancel 竞态）；文件计数修正（25 源 + 8 测试 + 1 fixture / 修改 9）；claude buildArgs 补 `--verbose` 并明确禁工具参数候选（`--tools ""`，实测锁定）；注明 json-line-stream 的 onRawLine 为 ye-kitty 增强；fake-agent 增 busy-loop 场景（7 场景）；start.ts 估行修正 ±25 |
