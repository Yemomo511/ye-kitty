## Agent 架构

### Harness 架构铁律

整个 Harness 的核心是在 Agent的循环过程中，万物均需要被结构化!!!

- 铁律1: **一切对Agent的Harness上下文约束，都应该有对应的结构体对象和Prompt**。整套程序对于 LLM 大模型 Harness Prompt治理都应该拥有一种从`结构体对象` -> `Prompt文本/JSON结构`的映射关系。例如 SKILL，程序应该拥有一个SKILL的定义对象和列表结构，并能够讲这种列表结构以`Markdown Prompt` 的形式告诉 LLM 支持的 SKILL 列表。

- 铁律2：**LLM的所有输出都应该是一种JSON结构，并能够将其转换为对应的对象**。输出结构 `JSON结构` -> `结构体对象`。对于每一个Prompt/返回/操作，都需要有一套映射将其和系统的结构映射起来。LLM只允许返回JSON结构对象，对于每一种JSON结构，都能对其进行响应的处理。

### Prompt 结构化治理

Harness的核心关键在于Prompt 对于 AI 的指导，告诉 AI 有哪些工具，应该输出什么样的结构来调用，如何将新的上下文追加到Prompt中去。为此Prompt 应该需要被分区，被结构化，让Prompt读取起来像一个有着一页一页的说明书一样。

- 铁律3: **所有注入到Prompt的内容都必须有对应的模板结构**。例如 Skill，应该包含哪些部分，如何将一个Skill 元信息列表用自然语言表达出来，其主要核心目的是能够快速定位，快速阅读。并且拥有对应的注意力。一个井井有条的顺序说明比一个随心所欲的描述有效的多！

- 铁律4: **System Prompt、Outside Context Prompt、Runtime Observation 必须分章治理**。第一章只放最高优先级系统协议；第二章放外界上下文，包括 Skill Prompt 与 Tool Prompt，并维护在 `instructions` 中；第三章放每轮运行观察，包括用户事件、工具结果和错误恢复信息，并维护在每次循环的 `input` 中。Skill 与 Tool 的具体目录不得混入第一章，也不得混入第三章运行观察。

- 铁律5: **Skill Prompt 与 Tool Prompt 必须独立成文件再聚合**。Skill Prompt 负责把 Skill 元信息、结构化 Skill 文档和 reference 文档映射为 Prompt；Tool Prompt 负责把可见工具映射为 Prompt；`outside-context-prompt.ts` 只负责组装第二章，不直接拼具体目录细节。

- 铁律6: **平台固定 Skill 必须由平台订阅边界预启用**。QQ 订阅器固定加载 `qq-chat` 并通过结构化 `skills` 输入传给 Harness；Harness 不根据平台名称写特例，只负责将预启用正文写入首轮 `enabledSkills` 上下文，最终首轮 phase 由后续前置观察决定。

- 铁律7: **每次 Harness 首轮决策前必须自动注入最近消息观察**。Harness 先记录当前事件，再通过 `ToolRegistry` 与 `ToolExecutor` 执行 `get_recent_messages`；该运行时准备动作不消耗模型工具预算、不写入模型决策历史，失败时必须注入可读错误观察并允许模型继续决策或主动重试。

### 小红书 MCP 登录边界

- 项目启动入口负责选择平台；选择小红书后，`bootstrap` 必须先完成 Docker 健康检查，再启动 MCP Runtime 和账号登录检查。
- 登录编排只允许调用 `check_login_status` 和 `get_login_qrcode`。二维码图片通过原始 MCP 调用端口交给本地展示器，不进入 Harness observation，也不写入日志。
- Cookie 由上游容器持久化，Agent Runtime 不读取、不复制、不打印 Cookie 内容。
- 小红书读取工具可以显式标记为 `low`；删除 Cookie、发布、评论、回复、点赞和收藏保持 `medium`，继续受 Harness 风险门禁约束。

### 小红书被提及订阅边界

- `list_mentions` 是 MCP `internalTools`，只允许平台信息源通过原始调用端口访问，不允许 Harness 或 Skill 发现和执行。
- `XiaohongshuMentionEventSubscriber` 是当前唯一的 Agent Runtime 入口；它只订阅稳定平台事件并记录脱敏跳过日志。
- 订阅器禁止持有 Agent、Harness、Skill、工具执行器和小红书动作端口；后续启用智能反应前必须单独设计不可信输入、决策和动作风险边界。

#### Prompt 如何书写

**请注意，本部分的所有示例都仅作参考，禁止直接复制作为Prompt使用**

- 使用章节和序号来分节，每个章节代表不同的 Prompt， 例如第一章系统治理，1.1 JSON 输出契约 等。序号的使用为 一 二 三 / 1.1 1.2 1.3 / 1.1.1 1.2.2 1.3.3。当需要说明部分细节时，从上到下依次为使用 (1) (1.1) (1.1.1) / [1] [1.1] [1.1.1]。 具体的可以参考论文的标题分布形式。

- 在设计引用结构时，请使用章节和序号来说明具体的位置。

```
Good
当你阅读第二章节 `2.1 Skill Prompt` 的 Skill 文档时，如果需要 `references[].path` 中的补充资料，请返回 `skill_reference_call`

Bad
当你阅读 Skill 详细部分时，如果对于特定的Skill的 Reference应用，请使用 `skill_reference` 工具获取其子内容
```
