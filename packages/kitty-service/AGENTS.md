## 叶猫猫服务层
社交服务设置统一的消息总线，并给予LLM处理完数据后，对社交进行响应处理。

## 规则

- 修改项目架构时，需要及时更新 `src/ARCHITECTURE.md` 文件。
- 共享结构体、接口和类型统一放在 `src/shared/types`。
- 共同抽象类统一放在 `src/shared/abstracts`。
- 共同模板和模板方法基类优先放在 `src/shared/abstracts` 或 `src/shared/application`。
- 策略模式相关的注册、选择和执行能力统一放在 `src/shared/strategies`。
- 具有固定处理流程的应用服务优先继承 `TemplateUseCase`，子类只实现必要钩子或核心步骤。
- 具有多种可替换算法或决策路径的模块优先实现 `Strategy` 接口，并通过 `StrategyRegistry` 选择执行。
