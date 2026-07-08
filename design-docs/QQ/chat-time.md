# QQ 群聊节奏回复设计

## 背景

群聊里的叶猫猫不能像客服一样每条都回，也不能永远只在被 @ 时出现。它需要像一个会忙、会潜水、也会在群聊突然热闹时接话的人：平时按随机空闲片段观察，回复后如果群聊继续爆发，就短时间积极跟进。

## 目标

- 所有白名单群聊消息先进入消息池，再决定是否触发 Agent。
- 未 @ 群聊只在随机回复片段命中，或回复后计时计数器达标时触发 Agent。
- 节奏门控触发的未 @ 群聊必须要求 Agent 读取最近 100 条群消息，并向群里回复一条自然消息。

## 整体策略

针对群聊分为没有被 @ 的无注意力阶段，以及被 @ 的有注意力阶段。

### 没有被 @ 的观察阶段

想象一个每天要工作的人，他只会在闲暇时间回复群聊消息，因此设计策略如下：

1. 每天 01:00 - 07:00 不对未 @ 群聊消息进行回复。
2. 07:00 到次日 01:00 采用随机时间段进行回复。
   - 07:00 - 12:00、14:00 - 18:00、19:00 - 21:00，每小时随机抽取 10 min 作为回复时刻，该 10 min 每小时可以切分成 1-10 个小片段。
   - 12:00 - 14:00、18:00 - 19:00、21:00 - 01:00，每小时随机抽取 20 min 作为回复时刻，该 20 min 每小时可以切分成 10-20 个小片段。
3. 命中随机回复片段时，当前消息进入强制群聊回复触发。
   - Harness 必须要求 Agent 先调用 `get_recent_messages`。
   - 群聊最近消息窗口固定为 100 条。
   - 读取最近消息后，Agent 必须输出 `reply`，不能返回 `ignore`。

### 回复后计时计数器

每次群聊成功回复后，进入计时 + 计数方式：

- 计时器首次为 10s，后续每次积极回复后 +10s，最多 1min。
- 计数器首次为 1 条新增群消息，后续每次积极回复后 +2 条，最多 10 条。
- 计时器到达时，如果新增群聊消息数满足计数个数，进入强制群聊回复触发。
- 计时器到达时，如果新增群聊消息数不满足计数个数，取消计时计数方式，回到随机回复片段观察。

## 被 @ 的情况

被 @ 的情况直接进入回复阶段，并在成功回复后进入上述回复后计时计数方式。被 @ 本身不强制要求读取最近 100 条群消息，但 Agent 仍可按 Harness 规则自行调用 `get_recent_messages`。

## 实现入口

- 消息入口：`packages/kitty-service/src/services/agent-runtime/application/qq-reply-event-subscriber.ts`
- 节奏控制器：`packages/kitty-service/src/services/agent-runtime/application/group-chat-cadence-controller.ts`
- 消息池：`packages/kitty-service/src/services/agent-runtime/application/in-memory-conversation-history.ts`
- 最近消息工具：`packages/kitty-service/src/services/agent-runtime/application/runtime-tools.ts`
- Harness 协议：`packages/kitty-service/src/services/agent-runtime/application/agent-runtime-harness.ts`

## 验收方式

- 未 @ 群聊不会默认丢弃，而是先写入消息池再进行节奏判断。
- 随机片段或计时计数器命中时，Agent 输入带有 `required_group_reply` 意图。
- 强制群聊回复下，模型未调用 `get_recent_messages` 或返回 `ignore` 会被 Harness 要求重新决策。
- `get_recent_messages` 在群聊中固定读取最近 100 条完整群消息。
