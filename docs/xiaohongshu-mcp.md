# 小红书 MCP 接入与登录

Ye-Kitty 通过 `xpzouying/xiaohongshu-mcp` 接入小红书浏览器自动化能力。项目负责启动容器、连接 MCP、检查账号和展示登录二维码；Cookie 只保存在项目管理的 Docker 数据卷中，Ye-Kitty 不读取或打印 Cookie。

## 前置条件

- 本机已经安装并启动 Docker Desktop。
- `18060` 端口没有被其他服务占用。
- 使用小红书移动 App 扫码。登录后不要让同一账号同时登录其他网页端，避免网页会话互相挤下线。

项目不会自动安装 Docker，也不会在后台修改系统环境。
MCP 默认只监听 `127.0.0.1`，不要在没有反向代理鉴权的情况下把它暴露到局域网或公网。

## 启动与登录

在项目根目录运行：

```bash
pnpm start
```

交互菜单提供三个选项：

1. QQ
2. 小红书
3. QQ + 小红书

也可以直接指定平台：

```bash
pnpm start -- xiaohongshu
pnpm start -- all
```

首次启动会使用 `deploy/xiaohongshu/compose.yml` 启动上游容器。服务健康检查通过后，Ye-Kitty 调用 `check_login_status`：

- 已登录：直接保持 MCP 连接。
- 未登录：调用 `get_login_qrcode`，把二维码保存为系统临时目录中的 `ye-kitty-xiaohongshu-login.png`，并尝试自动打开。
- 自动打开失败：按日志中的绝对路径手动打开图片。
- 扫码成功：日志显示“小红书账号登录状态确认成功”。
- 四分钟内没有完成：本次启动中断，重新运行命令获取新二维码。

单独管理容器：

```bash
pnpm xiaohongshu:up
pnpm xiaohongshu:logs
pnpm xiaohongshu:restart
pnpm xiaohongshu:down
```

`down` 只停止并删除容器，不删除 `deploy/xiaohongshu/data` 中的登录数据。

## 默认工具与风险

选择小红书后，项目自动补充名为 `xiaohongshu` 的 HTTP MCP Server，地址为 `http://127.0.0.1:18060/mcp`。默认允许上游的 13 个工具。

登录检查、二维码、Feed 列表、搜索、详情和用户资料属于 `low` 风险；删除 Cookie、发布图文或视频、评论、回复、点赞和收藏保持 `medium` 风险。写操作不会因为接入 MCP 就绕过 Harness 风险门禁自主执行。

当前接入只提供 MCP 工具，不监听小红书评论、通知或私信事件。

## 环境变量

通常不需要额外配置。需要调整时可在根目录 `.env` 中设置：

```dotenv
# MCP Server 名称和地址
YE_KITTY_XIAOHONGSHU_MCP_NAME=xiaohongshu
YE_KITTY_XIAOHONGSHU_MCP_URL=http://127.0.0.1:18060/mcp

# 默认镜像；Apple Silicon 如需原生ARM64镜像可改为 latest-arm64
YE_KITTY_XIAOHONGSHU_MCP_IMAGE=xpzouying/xiaohongshu-mcp

# MCP 调用、Docker 启动和扫码等待时间
YE_KITTY_XIAOHONGSHU_MCP_TIMEOUT_MS=60000
YE_KITTY_XIAOHONGSHU_DOCKER_TIMEOUT_MS=120000
YE_KITTY_XIAOHONGSHU_LOGIN_TIMEOUT_MS=240000
YE_KITTY_XIAOHONGSHU_LOGIN_POLL_INTERVAL_MS=3000
```

如需修改本地映射端口，Compose 还支持：

```dotenv
YE_KITTY_XIAOHONGSHU_MCP_PORT=18061
YE_KITTY_XIAOHONGSHU_MCP_URL=http://127.0.0.1:18061/mcp
```

两个值必须指向同一个端口。

如需让其他机器访问，可以显式设置 `YE_KITTY_XIAOHONGSHU_MCP_HOST`，但上游 MCP 没有提供 Ye-Kitty 侧鉴权，默认不建议修改：

```dotenv
YE_KITTY_XIAOHONGSHU_MCP_HOST=127.0.0.1
```

## 使用已有远端 MCP

如果小红书 MCP 已在其他位置运行，可关闭项目管理的 Docker，并指定远端地址：

```dotenv
YE_KITTY_XIAOHONGSHU_MCP_DOCKER=false
YE_KITTY_XIAOHONGSHU_MCP_URL=http://你的服务地址:18060/mcp
```

也可以复制 `.mcp.json.example` 为 `.mcp.json` 并修改同名 `xiaohongshu` Server。项目会保留用户的同名配置，不覆盖 URL、工具过滤或风险等级。

## 排障

### Docker 启动失败

确认 Docker Desktop 已启动，再执行：

```bash
docker version
pnpm xiaohongshu:logs
```

### 健康检查超时

检查 `18060` 端口占用和容器日志：

```bash
lsof -nP -iTCP:18060 -sTCP:LISTEN
pnpm xiaohongshu:logs
```

### 登录后再次要求扫码

检查是否用同一账号登录了其他网页端，并确认 `deploy/xiaohongshu/data` 目录仍存在。移动 App 可以继续使用。
