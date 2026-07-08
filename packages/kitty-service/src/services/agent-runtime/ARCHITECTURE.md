## Agent 架构

### Harness 架构铁律

整个 Harness 的核心是在 Agent的循环过程中，万物均需要被结构化!!!

- 铁律1: **一切对Agent的Harness上下文约束，都应该有对应的结构体对象和Prompt**。整套程序对于 LLM 大模型 Harness Prompt治理都应该拥有一种从`结构体对象` -> `Prompt文本/JSON结构`的映射关系。例如 SKILL，程序应该拥有一个SKILL的定义对象和列表结构，并能够讲这种列表结构以`Markdown Prompt` 的形式告诉 LLM 支持的 SKILL 列表。

- 铁律2：**LLM的所有输出都应该是一种JSON结构，并能够将其转换为对应的对象**。输出结构 `JSON结构` -> `结构体对象`。对于每一个Prompt/返回/操作，都需要有一套映射将其和系统的结构映射起来。LLM只允许返回JSON结构对象，对于每一种JSON结构，都能对其进行响应的处理。

### Prompt 结构化治理

Harness的核心关键在于Prompt 对于 AI 的指导，告诉 AI 有哪些工具，应该输出什么样的结构来调用，如何将新的上下文追加到Prompt中去。为此Prompt 应该需要被分区，被结构化，让Prompt读取起来像一个有着一页一页的说明书一样。

- 铁律3: **所有注入到Prompt的内容都必须有对应的模板结构**。例如 Skill，应该包含哪些部分，如何将一个Skill 元信息列表用自然语言表达出来，其主要核心目的是能够快速定位，快速阅读。并且拥有对应的注意力。一个井井有条的顺序说明比一个随心所欲的描述有效的多！

- 铁律4: **System Prompt、Outside Context Prompt、Runtime Observation 必须分章治理**。第一章只放最高优先级系统协议；第二章放外界上下文，包括 Skill Prompt 与 Tool Prompt；第三章放运行观察，包括用户事件、工具结果和错误恢复信息。Skill 与 Tool 的具体目录不得混入第一章。

- 铁律5: **Skill Prompt 与 Tool Prompt 必须独立成文件再聚合**。Skill Prompt 负责把 Skill 元信息、结构化 Skill 文档和 reference 文档映射为 Prompt；Tool Prompt 负责把可见工具映射为 Prompt；`outside-context-prompt.ts` 只负责组装第二章，不直接拼具体目录细节。

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
