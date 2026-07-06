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
- `reason` 必填，用于内部审计，不会发送给 QQ。

## 允许动作

### send_text

发送额外文本消息。通常优先使用外层 `text`，只有确实需要拆成多条消息时才使用。

```json
{ "type": "send_text", "text": "补充一句喵~" }
```

### send_face

发送 QQ 商城表情。

```json
{ "type": "send_face", "faceId": "66" }
```

### send_custom_image

发送图片或自定义表情。`file` 只能是已知安全图片 URL、文件或 NapCat 可识别资源。

```json
{ "type": "send_custom_image", "file": "https://example.com/cat.png" }
```

### poke_sender

戳一戳当前消息发送者。不能指定其他用户。

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
  "text": "好呀，我知道了喵~",
  "actions": [{ "type": "send_face", "faceId": "66" }],
  "reason": "用户轻松互动，可以用表情补充语气"
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
  "actions": [{ "type": "poke_sender", "userExternalId": "456" }],
  "reason": "错误：poke_sender 不能指定任意用户"
}
```
