# QQ动作JSON协议

## 总原则

QQ 动作只能出现在最终 `reply.actions` 中。动作只是意图声明，真正的群号、好友号、消息类型和发送者由 Agent Runtime 从当前 QQ 消息上下文补齐。

普通消息发送统一使用 `send_msg`。不要输出 `send_group_msg`、`send_private_msg`、HTTP、curl、URL、token、群管理、删消息、踢人、改资料、退群、登录态操作或任意原始平台 action。

## 外层结构

```json
{
  "type": "reply",
  "text": "主要文字回复",
  "actions": [],
  "reason": "信息充分且风险可控，可以回复"
}
```

- `type` 必须是 `reply`。
- `text` 可选；只需要纯文本时可以直接使用。
- `actions` 可选；只放 Harness 允许执行的 QQ 动作。
- 不要把同一句话同时放进外层 `text` 和 `send_msg.message`。
- `reason` 必填，用于内部审计，不会发送给 QQ。

## 统一消息动作

### send_msg

`send_msg` 对应 NapCat 统一发送消息接口。Agent 只填写消息内容，不能填写会话目标。

```json
{
  "type": "send_msg",
  "message": [
    { "type": "at", "data": { "qq": "123456" } },
    { "type": "text", "data": { "text": " 好好好 " } },
    { "type": "face", "data": { "id": "66" } }
  ],
  "auto_escape": false
}
```

允许字段：

| 字段          | 类型                               | 说明                                                  |
| ------------- | ---------------------------------- | ----------------------------------------------------- |
| `type`        | `"send_msg"`                       | Harness 内部动作名。                                  |
| `message`     | `string` / 单个消息段 / 消息段数组 | OneBot 11 消息混合类型。优先使用消息段数组。          |
| `auto_escape` | `boolean` / `"true"` / `"false"`   | 只在 `message` 是字符串时生效，表示是否按纯文本发送。 |
| `source`      | `string`                           | 合并转发来源，只用于 `node` 合并转发。                |
| `news`        | `{ "text": string }[]`             | 合并转发新闻，只用于 `node` 合并转发。                |
| `summary`     | `string`                           | 合并转发摘要，只用于 `node` 合并转发。                |
| `prompt`      | `string`                           | 合并转发提示，只用于 `node` 合并转发。                |
| `timeout`     | `number`                           | 自定义发送超时，单位毫秒。                            |

禁止字段：

| 字段                     | 原因                                               |
| ------------------------ | -------------------------------------------------- |
| `message_type`           | 由当前 QQ 会话决定，Agent 不能指定。               |
| `group_id`               | 由当前 QQ 群聊上下文补齐，Agent 不能指定任意群。   |
| `user_id`                | 由当前 QQ 私聊上下文补齐，Agent 不能指定任意好友。 |
| `action`、`url`、`token` | 不能绕过 Harness 直接调用 NapCat。                 |

## 消息段

`send_msg.message` 可以包含 NapCat/OneBot 11 消息段。常用消息段如下：

```json
{ "type": "text", "data": { "text": "纯文本" } }
```

```json
{ "type": "at", "data": { "qq": "123456" } }
```

```json
{ "type": "face", "data": { "id": "66" } }
```

```json
{
  "type": "mface",
  "data": {
    "emoji_package_id": 123,
    "emoji_id": "abc",
    "key": "market-key",
    "summary": "摸摸头"
  }
}
```

```json
{ "type": "image", "data": { "file": "https://example.com/cat.png" } }
```

```json
{ "type": "reply", "data": { "id": "12345" } }
```

```json
{ "type": "dice", "data": { "result": 1 } }
```

```json
{ "type": "rps", "data": { "result": 1 } }
```

```json
{ "type": "json", "data": { "data": "{\"app\":\"com.tencent.structmsg\"}" } }
```

NapCat schema 还声明了 `record`、`video`、`file`、`music`、`markdown`、`node`、`forward`、`contact`、`location`、`xml`、`poke`、`miniapp`、`onlinefile`、`flashtransfer` 等段。生成这些段时必须保证字段完整且来自当前上下文或已知资料，不要编造文件、商城表情 key、转发 ID 或 JSON 卡片。

## 合并转发

合并转发使用 `node` 消息段。只要 `message` 中出现 `node`，整条 `message` 必须全部都是 `node`，不能混入 `text`、`at`、`image` 等普通消息段。

```json
{
  "type": "send_msg",
  "message": [
    {
      "type": "node",
      "data": {
        "user_id": "123456",
        "nickname": "叶猫猫",
        "content": [{ "type": "text", "data": { "text": "第一条" } }]
      }
    }
  ],
  "summary": "聊天记录"
}
```

## 其他动作

### poke_sender

戳一戳当前消息发送者。不能指定其他用户。准备戳一戳时不要填写外层 `text`，也不要再追加 `send_msg`。

```json
{ "type": "poke_sender" }
```

### react_to_message

给当前触发消息添加表情回应。不能指定其他消息。

```json
{ "type": "react_to_message", "emojiId": "128512" }
```

## Harness接入过程

1. 模型在 Harness 循环中输出 `reply.actions[].send_msg`。
2. `parseQqReplyAction` 只识别 `send_msg`、`poke_sender`、`react_to_message` 等 Harness 动作名，不识别原始 NapCat action。
3. 解析层保留 `send_msg.message` 的 OneBot 11 段结构，同时过滤空消息、非法控制字段和会话目标字段。
4. `QqReplyActionExecutor` 从当前 QQ 事件补齐 `message_type` 和当前会话 ID。
5. `QqBotClientPort` 只暴露统一 `sendMessage`，不再为文字、图片、表情维护多套发送入口。
6. `OneBotWsExternalActionApi` 根据当前会话调用 NapCat `send_msg`，群聊补 `message_type: "group"` 和当前 `group_id`，私聊补 `message_type: "private"` 和当前 `user_id`。
7. 运行记录保存模型原始动作、补齐后的 NapCat 参数摘要、发送结果和错误，便于排查。

## 正例

```json
{
  "type": "reply",
  "actions": [
    {
      "type": "send_msg",
      "message": [
        { "type": "text", "data": { "text": "好呀 " } },
        { "type": "face", "data": { "id": "66" } }
      ]
    }
  ],
  "reason": "用户轻松互动，可以用同一条消息混排文字和表情"
}
```

```json
{
  "type": "reply",
  "actions": [{ "type": "poke_sender" }],
  "reason": "用户在玩轻量互动，只需要戳一戳"
}
```

## 反例

```json
{
  "type": "reply",
  "actions": [
    {
      "type": "send_group_msg",
      "group_id": "123",
      "message": "好"
    }
  ],
  "reason": "错误：直接输出了原始 NapCat action"
}
```

```json
{
  "type": "reply",
  "text": "戳你一下",
  "actions": [{ "type": "poke_sender" }],
  "reason": "错误：戳一戳时不要填写外层 `text`"
}
```

```json
{
  "type": "reply",
  "actions": [
    {
      "type": "send_msg",
      "group_id": "123",
      "message": [{ "type": "text", "data": { "text": "好" } }]
    }
  ],
  "reason": "错误：Agent 不能指定任意群号"
}
```

```json
{
  "type": "reply",
  "actions": [
    {
      "type": "send_msg",
      "message": [
        { "type": "node", "data": { "id": "123" } },
        { "type": "text", "data": { "text": "混发" } }
      ]
    }
  ],
  "reason": "错误：node 合并转发不能和普通消息段混发"
}
```
