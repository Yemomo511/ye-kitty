# QQ动作JSON协议

## 总原则

QQ 动作只能出现在最终 `reply.actions` 中。动作只是意图声明，真正的会话、发送者和消息目标由 Agent Runtime 从当前 QQ 消息上下文补齐。

禁止输出 OneBot、NapCat、HTTP、curl、群管理、删消息、踢人、改资料、退群、登录态操作或任意原始平台 action。

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
- `text` 可选；有文字回复时优先放在这里。
- `actions` 可选；只放低风险 QQ 互动动作。
- 不要把同一句话同时放进外层 `text` 和 `send_text` 动作。
- `reason` 必填，用于内部审计，不会发送给 QQ。

## 允许动作

### send_text

发送额外文本消息。通常优先使用外层 `text`，只有确实需要拆成多条消息时才使用。
如果 `send_text.text` 和外层 `text` 一样，说明你输出了重复回复，应删除其中一个。

```json
{ "type": "send_text", "text": "补充一句喵~" }
```

### send_text_with_face

发送一条同时包含文字和 QQ 内置表情的消息。文字和表情必须放在同一个 `segments` 数组里。

```json
{
  "type": "send_text_with_face",
  "segments": [
    { "type": "text", "text": "好好好" },
    { "type": "face", "faceId": "66" }
  ]
}
```

### send_face

单独发送 QQ 内置表情。通常如果表情要跟文字放在一起，优先使用 `send_text_with_face`。

```json
{ "type": "send_face", "faceId": "66" }
```

### send_market_face

发送 NapCat `mface` 商城表情。必须已经知道完整商城表情元数据，不能编造。

```json
{
  "type": "send_market_face",
  "emojiPackageId": 123,
  "emojiId": "abc123",
  "key": "market-key",
  "summary": "摸摸头"
}
```

### send_custom_image

发送图片或自定义表情。`file` 只能是已知安全图片 URL、文件或 NapCat 可识别资源。

```json
{ "type": "send_custom_image", "file": "https://example.com/cat.png" }
```

### poke_sender

戳一戳当前消息发送者。不能指定其他用户。准备戳一戳时不要填写外层 `text`，也不要再追加 `send_text`、`send_face`、`send_text_with_face` 等发送动作。

```json
{ "type": "poke_sender" }
```

### react_to_message

给当前触发消息添加表情回应。不能指定其他消息。

```json
{ "type": "react_to_message", "emojiId": "128512" }
```

## 正例

```json
{
  "type": "reply",
  "actions": [
    {
      "type": "send_text_with_face",
      "segments": [
        { "type": "text", "text": "好呀，我知道了喵~" },
        { "type": "face", "faceId": "66" }
      ]
    }
  ],
  "reason": "用户轻松互动，可以用表情补充语气"
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
  "actions": [{ "type": "group_poke", "group_id": "123", "user_id": "456" }],
  "reason": "错误：直接输出了 OneBot action"
}
```

```json
{
  "type": "reply",
  "text": "戳你一下",
  "actions": [{ "type": "poke_sender" }],
  "reason": "错误：戳一戳时不应再发送文字"
}
```

```json
{
  "type": "reply",
  "text": "好好好",
  "actions": [{ "type": "send_text", "text": "好好好" }],
  "reason": "错误：同一句话同时出现在 text 和 send_text，会造成重复回复"
}
```

```json
{
  "type": "reply",
  "text": "好呀，我知道了喵~",
  "actions": [{ "type": "send_face", "faceId": "66" }],
  "reason": "错误：QQ内置表情应和文字放在同一条消息时，应使用 send_text_with_face"
}
```

```json
{
  "type": "reply",
  "actions": [{ "type": "poke_sender", "userExternalId": "456" }],
  "reason": "错误：poke_sender 不能指定任意用户"
}
```
