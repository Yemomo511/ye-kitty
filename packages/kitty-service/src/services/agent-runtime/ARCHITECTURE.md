## Agent 架构

### Harness 架构铁律

整个 Harness 的核心是在 Agent的循环过程中，万物均需要被结构化!!!

- 铁律1: **一切对Agent的Harness上下文约束，都应该有对应的结构体对象和Prompt**。整套程序对于 LLM 大模型 Harness Prompt治理都应该拥有一种从`结构体对象` -> `Prompt文本/JSON结构`的映射关系。例如 SKILL，程序应该拥有一个SKILL的定义对象和列表结构，并能够讲这种列表结构以`Markdown Prompt` 的形式告诉 LLM 支持的 SKILL 列表。

- 铁律2：**LLM的所有输出都应该是一种JSON结构，并能够将其转换为对应的对象**。输出结构 `JSON结构` -> `结构体对象`。对于每一个Prompt/返回/操作，都需要有一套映射将其和系统的结构映射起来。LLM只允许返回JSON结构对象，对于每一种JSON结构，都能对其进行响应的处理。
