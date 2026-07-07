# NapCat Docker 接入 QQ 服务

本文档用于把 NapCat-Docker 部署到本机 Docker，并让 NapCat 通过 OneBot v11 反向 WebSocket 连接 Ye-Kitty 的 QQ 服务。

## 当前链路

```text
QQ 账号
  -> NapCat Docker
  -> WebSocket 客户端 ws://host.docker.internal:3001/onebot/v11?access_token=...
  -> Ye-Kitty QQ 服务
  -> Agent Runtime
  -> OneBot 回复动作
  -> NapCat Docker
  -> QQ
```

Ye-Kitty 当前是 WebSocket 服务端，NapCat 是 WebSocket 客户端。不要把 NapCat 配成 WebSocket 服务端，否则方向会反。

## 端口约定

| 端口            | 所属进程      | 用途                                                                     |
| --------------- | ------------- | ------------------------------------------------------------------------ |
| `3001`          | Ye-Kitty      | OneBot v11 反向 WebSocket，供 NapCat 主动连接                            |
| `16099 -> 6099` | NapCat Docker | 宿主机 `16099` 映射到容器内 WebUI `6099`，用于登录 QQ 和配置 OneBot 网络 |

官方 NapCat-Docker 示例常见会映射 `3001:3001`。本项目不要这样做，因为 Ye-Kitty 默认已经使用宿主机 `3001`。NapCat WebUI 容器内仍是 `6099`，但本项目默认映射到宿主机 `16099`，避免和本机已有 QQ 工具冲突。

## 启动 Ye-Kitty QQ 服务

确认根目录 `.env` 至少包含：

```dotenv
YE_KITTY_ONEBOT_ACCESS_TOKEN=ye-kitty-local-secret
YE_KITTY_QQ_SELF_ID=你的机器人QQ号
YE_KITTY_QQ_GROUP_ALLOWLIST=[]
YE_KITTY_QQ_FRIEND_ALLOWLIST=[允许回复的好友QQ号]
YE_KITTY_ONEBOT_WS_HOST=0.0.0.0
YE_KITTY_ONEBOT_WS_PORT=3001
YE_KITTY_ONEBOT_WS_PATH=/onebot/v11
```

启动 QQ 服务：

```bash
pnpm --filter @ye-kitty/kitty-service start-platform:qq
```

看到 `WebSocket服务已监听 host=0.0.0.0 port=3001 path=/onebot/v11` 后，再启动 NapCat。

## 启动 NapCat Docker

```bash
pnpm napcat:up
```

查看 WebUI Token：

```bash
pnpm napcat:logs
```

打开：

```text
http://127.0.0.1:16099/webui
```

WebUI 第一次登录 QQ 后，按 NapCat 提示修改 WebUI 密码。

## 推荐配置方式：WebUI 新建 WebSocket 客户端

在 NapCat WebUI 中进入网络配置，新建 WebSocket 客户端：

| 配置项       | 值                                                                             |
| ------------ | ------------------------------------------------------------------------------ |
| 名称         | `YeKittyReverseWs`                                                             |
| 启用         | 是                                                                             |
| URL          | `ws://host.docker.internal:3001/onebot/v11?access_token=ye-kitty-local-secret` |
| 消息上报格式 | `array`                                                                        |
| 上报自身消息 | 否                                                                             |
| 重连间隔     | `5000`                                                                         |
| 心跳周期     | `30000`                                                                        |

如果你修改了 `.env` 中的 `YE_KITTY_ONEBOT_ACCESS_TOKEN`、`YE_KITTY_ONEBOT_WS_PORT` 或 `YE_KITTY_ONEBOT_WS_PATH`，这里的 URL 必须同步修改。

## 文件化配置方式

NapCat v4.5.3 后支持读取 `onebot11.json` 作为默认 OneBot 配置。可以把项目示例复制到 NapCat 的挂载配置目录：

```bash
mkdir -p deploy/napcat/data/config
cp deploy/napcat/onebot11.example.json deploy/napcat/data/config/onebot11.json
```

然后重启 NapCat：

```bash
pnpm napcat:restart
```

如果已经登录过 QQ，NapCat 也可能生成 `onebot11_你的QQ号.json`。此时以实际账号文件为准，确保其中存在启用状态的 `websocketClients` 配置。

## 验证连接

1. Ye-Kitty 日志出现 `NapCat连接已建立`。
2. NapCat 日志不再持续出现 WebSocket 重连失败。
3. 用白名单内 QQ 好友或群发送文本消息。
4. Ye-Kitty 日志出现 `开始生成QQ回复` 和 `已发送QQ回复`。

如果 Ye-Kitty 日志出现 `拒绝未授权连接`，优先检查 NapCat URL 中的 `access_token` 是否与 `.env` 的 `YE_KITTY_ONEBOT_ACCESS_TOKEN` 完全一致。

## 常见问题

### NapCat 容器无法连接 Ye-Kitty

先确认 Ye-Kitty 监听地址是 `0.0.0.0`，不是 `127.0.0.1`。容器访问宿主机时应使用 `host.docker.internal`：

```text
ws://host.docker.internal:3001/onebot/v11?access_token=ye-kitty-local-secret
```

### 启动 NapCat 时报 3001 端口占用

说明你用了官方示例里的 `3001:3001` 映射。Ye-Kitty 需要宿主机 `3001`，NapCat 做反向 WebSocket 客户端时不需要映射这个端口。请使用本项目的 `deploy/napcat/compose.yml`。

### QQ 消息到了但 Ye-Kitty 不回复

检查 `.env` 中的 `YE_KITTY_QQ_SELF_ID` 是否是 NapCat 当前登录的 QQ 号，并检查 `YE_KITTY_QQ_GROUP_ALLOWLIST` 或 `YE_KITTY_QQ_FRIEND_ALLOWLIST` 是否允许该会话。
