# drop

简体中文 | [English](README.md)

通过带过期时间的预览 URL 分享本地文件、目录、stdin 内容和 Git diff。

![drop 中文 hero 图](assets/readme/hero-zh-CN.png)

`drop` 是一个轻量 CLI 工具，用来把本机内容变成适合浏览器查看的临时预览链接。它会按需启动本地 Web 服务，把分享状态保存在 `~/.drop`，并为常见开发文件提供可读预览。

## 为什么用它？

- 不离开终端，就能分享代码、日志、配置、Markdown、CSV、媒体文件或生成产物。
- 给 AI 编码 agent 一个稳定方式，让它展示自己创建或修改的文件。
- 分享整个项目目录，并提供可搜索文件树和分栏预览 UI。
- 把 Git commit 渲染成包含元数据和高亮 diff 的可读页面。
- 默认通过 TTL 让访问自动过期。

## 一眼看懂

| 需求 | 命令 |
| --- | --- |
| 分享单个文件 | `drop README.md` |
| 分享可浏览目录 | `drop .` |
| 分享终端输出 | <code>command &#124; drop share --type text</code> |
| 从 stdin 分享 Markdown | <code>echo "# Hi" &#124; drop share --type markdown</code> |
| 分享当前 Git diff | <code>git diff &#124; drop share --type diff</code> |
| 分享一个 commit | `drop allow-git . HEAD` |
| 查看活跃分享 | `drop list` |
| 停止 daemon | `drop stop` |

## 目录

- [快速开始](#快速开始)
- [工作原理](#工作原理)
- [给 AI Agent 的指令块](#给-ai-agent-的指令块)
- [安装](#安装)
- [使用](#使用)
- [命令](#命令)
- [配置](#配置)
- [渲染能力](#渲染能力)
- [安全模型](#安全模型)
- [公网访问](#公网访问)
- [开发](#开发)

## 快速开始

安装最新发布版本：

```bash
curl -fsSL https://raw.githubusercontent.com/junping1/drop/master/install.sh | bash
```

分享文件：

```bash
drop README.md
```

分享目录：

```bash
drop .
```

分享管道输入：

```bash
git diff | drop share --type diff --title "current changes"
```

每个命令都会打印一个 URL。你可以自己在浏览器里打开，也可以发给需要预览内容的人。

## 工作原理

![drop 中文架构与使用说明图](assets/readme/architecture-zh-CN.png)

1. CLI 在本地 SQLite 数据库中记录授权。
2. daemon 从你的机器上提供私有 token URL。
3. 浏览器请求 `/f/:token`、`/d/:token` 或 `/git/:token`。
4. 服务端检查过期时间，读取本地内容，然后返回渲染预览或原始文件。

运行时状态保存在 `~/.drop/`：

| 路径 | 用途 |
| --- | --- |
| `~/.drop/drop.db` | SQLite 授权数据库 |
| `~/.drop/config.json` | 配置和 owner key |
| `~/.drop/drop.pid` | daemon PID |
| `~/.drop/drop.log` | daemon 日志 |
| `~/.drop/shares/` | stdin 分享生成的临时文件 |

## 给 AI Agent 的指令块

把下面这段复制进你的编码 agent 指令，让它稳定安装并使用 `drop`：

```text
安装并使用 `drop`，一个通过限时预览 URL 分享本地文件的 CLI 工具。

安装：
  curl -fsSL https://raw.githubusercontent.com/junping1/drop/master/install.sh | bash

暴露链接：
  drop serve
  # 如果使用外部隧道，设置公共 URL：
  drop config set base_url https://your-domain.example

使用：
  drop /path/to/file                           # 分享文件
  drop /path/to/dir                            # 分享可浏览目录
  drop /path/to/file --ttl 3600                # 自定义 TTL，单位秒
  drop /path/to/file --live                    # 文件变化时自动刷新
  echo "content" | drop share --type markdown  # 分享管道输入
  git diff | drop share --type diff            # 分享 diff
  drop list                                    # 列出活跃分享

行为要求：
  - 创建或编辑了用户需要检查的文件后，对该文件运行 `drop` 并发送 URL。
  - 当用户要求查看文件、预览内容或获取链接时，使用 `drop`。
  - 对目录使用 `drop /path/to/dir`，让用户获得可浏览 UI。
  - 不要分享密钥、`.env` 文件、API key、token 或凭证备份。
```

### AI 决策规则

| 用户意图 | Agent 应该做什么 |
| --- | --- |
| “让我看看这个文件” | 运行 `drop /path/to/file` 并返回 URL。 |
| “让我看看这个目录/项目” | 运行 `drop /path/to/dir` 并返回 URL。 |
| “看看你的改动” | 优先运行 <code>git diff &#124; drop share --type diff --title "changes"</code>。 |
| “分享生成的报告” | 对生成产物运行 `drop`。 |
| “公开访问这个链接” | 先确认 tunnel/base URL，再设置 `base_url`。 |
| 内容可能包含密钥 | 不要直接分享；先请求确认或排除敏感路径。 |

机器可读摘要：

```yaml
tool: drop
purpose: 通过临时预览 URL 分享本地内容
default_ttl_seconds: 86400
state_dir: ~/.drop
share_file: drop /path/to/file
share_directory: drop /path/to/dir
share_stdin: command | drop share --type text
share_diff: git diff | drop share --type diff
list_shares: drop list
stop_daemon: drop stop
never_share:
  - .env
  - API keys
  - OAuth credentials
  - tokens
  - password files
  - database backups
```

## 安装

Linux/macOS 一行安装：

```bash
curl -fsSL https://raw.githubusercontent.com/junping1/drop/master/install.sh | bash
```

从 fork 或其他 release 仓库安装：

```bash
curl -fsSL https://raw.githubusercontent.com/owner/drop/master/install.sh | DROP_REPO=owner/drop bash
```

从源码构建：

```bash
git clone https://github.com/junping1/drop.git
cd drop
bun install
bun run build
cp dist/drop-linux-x64 ~/.local/bin/drop
```

源码构建需要 Bun v1.0+。

## 使用

`allow` 子命令是隐式的：

```bash
drop ~/file.py
drop allow ~/file.py
```

这两个命令都会分享同一个文件。如果 daemon 尚未运行，它会自动启动。

### 如何选择命令

| 内容 | 推荐命令 |
| --- | --- |
| 已存在文件 | `drop /path/to/file` |
| 已存在目录 | `drop /path/to/dir` |
| 生成文本 | `drop share --content "..." --type text` |
| 命令输出 | <code>command &#124; drop share --type text</code> |
| Markdown 输出 | <code>command &#124; drop share --type markdown</code> |
| 代码片段 | `drop share --content "..." --type code` |
| Git diff | <code>git diff &#124; drop share --type diff</code> |
| Git commit | `drop allow-git . HEAD` |

### 文件

```bash
drop ~/file.py                     # 分享文件
drop ~/file.py --ttl 300           # 5 分钟后过期
drop ~/file.py --head 50           # 只显示前 50 行
drop ~/file.py --tail 50           # 只显示后 50 行
drop ~/file.py --live              # 文件变化时刷新预览
drop ~/file.py --qr                # 同时把终端二维码输出到 stderr
drop ~/file.py --force             # 扫描密钥；即使命中也继续分享
drop ~/file.py --no-secret-scan    # 跳过分享前密钥扫描
```

### 目录

```bash
drop ~/project/                    # 分享可浏览文件树
drop ~/project/ --ttl 7200         # 自定义 TTL
drop ~/project/ --exclude '*.log'  # 添加排除规则
drop ~/project/ --include-hidden   # 包含 dotfile 和隐藏目录
drop ~/project/ --live             # 目录变化时刷新
drop ~/project/ --qr               # 同时把终端二维码输出到 stderr
drop ~/project/ --force            # 扫描密钥；即使命中也继续分享
drop ~/project/ --no-secret-scan   # 跳过分享前密钥扫描
```

默认排除项：所有 dotfile 和隐藏目录，例如 `.env`、`.github/`、`.idea/`、`.nebula-secrets/`，以及 `__pycache__/`、`node_modules/`、`*.pyc`、`.venv/`。只有明确需要分享隐藏文件时才使用 `--include-hidden`；已配置的 `default_excludes` 和显式 `--exclude` 仍然生效。

### stdin

```bash
echo "# Hello" | drop share --type markdown
git diff | drop share --type diff --title "my changes"
drop share --content "print('hi')" --type python
echo "# Hello" | drop share --type markdown --qr
drop share --content "..." --force --json
drop share --content "..." --no-secret-scan --json
```

支持的类型：`markdown`、`python`、`javascript`、`json`、`yaml`、`html`、`css`、`shell`、`diff`、`code`、`text`。

### 密钥扫描

创建文件、目录、stdin/内联内容或 Git commit 授权前，`drop` 默认会扫描高置信密钥。命中阻断项时不会创建授权；对 stdin 分享，也不会写入临时文件或启动 daemon。

覆盖规则包括私钥、GitHub token、OpenAI/Anthropic API key、Slack token、Stripe live key、Google API key、AWS access key ID、Google service-account JSON，以及 `credentials.json`、`secrets.yaml`、`*.pem`、`*.key`、`.npmrc`、`.netrc` 等敏感文件名。

目录扫描使用与目录分享相同的默认排除项，并叠加 `--exclude`；不会跟随逃出分享目录的 symlink，也会避免 symlink cycle。对目录分享而言，`--include-hidden` 会同时移除文件树和分享前扫描中的内置 dotfile/隐藏目录排除项，因此隐藏文件里的密钥会被扫描并可能阻断分享，除非再用显式 `--exclude` 排除。

覆盖开关：

| 参数 | 行为 |
| --- | --- |
| `--force` | 仍然执行扫描，但即使命中也继续分享。JSON 成功输出包含 `secret_scan.forced`、`findings_count` 和脱敏后的 `findings`。 |
| `--no-secret-scan` | 跳过扫描。JSON 成功输出包含 `secret_scan.disabled`。 |

`--force` 与 `--no-secret-scan` 不能同时使用。密钥扫描输出只包含脱敏字段，例如 `path`、`line`、`rule_id`、`severity`、`fingerprint`，不会输出密钥原文或整行内容。

### Git Commit

```bash
drop allow-git /path/to/repo abc1234
drop allow-git . HEAD
drop allow-git . HEAD --qr
drop allow-git . HEAD --force
drop allow-git . HEAD --no-secret-scan
```

Git commit 分享会渲染 commit 元数据、变更文件列表和可展开的高亮 diff。

### 终端二维码

添加 `--qr` 可为生成的 URL 打印终端二维码。二维码输出到 stderr，因此 stdout 仍保持原始 URL 或可解析 JSON：

```bash
drop allow ~/file.py --qr
drop allow ~/project/ --qr
drop share --content "hello" --type text --qr
drop allow-git . HEAD --qr
drop owner-url --qr
drop allow ~/file.py --json --qr | jq .
```

如果二维码渲染失败，分享仍会成功，Drop 只会向 stderr 打印 warning。分享命令失败时不会输出二维码。

## 命令

| 命令 | 说明 |
| --- | --- |
| `drop <path>` | 分享文件或目录 |
| `drop allow <path>` | `drop <path>` 的显式形式 |
| `drop share` | 分享 stdin 或内联文本 |
| `drop allow-git <repo> <commit>` | 分享 Git commit diff |
| `drop allow <path> --qr` | 打印分享 URL，并在 stderr 输出终端二维码 |
| 分享类命令上的 `--force` | 扫描密钥，但命中后仍继续分享 |
| 分享类命令上的 `--no-secret-scan` | 跳过分享前密钥扫描 |
| `drop list` | 列出活跃和过期分享 |
| `drop list --json` | 以 JSON 输出分享列表 |
| `drop revoke <token>` | 撤销文件、目录或 Git 分享 token |
| `drop owner-url` | 打印 owner dashboard URL |
| `drop status` | 检查 daemon 状态 |
| `drop stop` | 停止 daemon |
| `drop serve` | 前台启动服务 |
| `drop config get <key>` | 读取配置 |
| `drop config set <key> <value>` | 写入配置 |

## 配置

```bash
drop config set base_url https://files.example.com
drop config get base_url
```

| Key | 默认值 | 说明 |
| --- | --- | --- |
| `base_url` | `http://localhost:17173` | 生成链接时使用的公共 URL 前缀 |
| `port` | `17173` | 服务监听端口 |
| `file_ttl` | `86400` | 文件分享默认 TTL，单位秒 |
| `dir_default_ttl` | `86400` | 目录分享默认 TTL，单位秒 |
| `auto_stop` | `false` | 所有分享过期后是否自动停止 daemon |

## 渲染能力

| 类型 | 渲染方式 |
| --- | --- |
| 代码（`.py`、`.js`、`.ts`、`.go`、`.rs` 等） | 使用 highlight.js 语法高亮 |
| Markdown（`.md`） | 渲染为带文档样式的 HTML |
| CSV/TSV | 渲染为样式化 HTML 表格 |
| PDF | 浏览器原生 PDF 查看器 |
| SVG | 通过 data URI 图片预览 |
| 音频/视频 | HTML5 播放器 |
| 图片 | 内联显示 |
| Git commits | 元数据和可展开的高亮 diff |
| 其他文件 | 按推断 content type 返回原始响应 |

## 安全模型

- 只有显式分享的内容可以访问。
- 分享会按 TTL 自动过期。
- 文件、目录和 Git token 至少为 32 个 hex 字符（128 bit），owner key 为 32 个 hex 字符。
- 目录访问包含路径穿越校验和 symlink 校验。
- 文件、目录、stdin/内联内容和 Git commit 分享默认启用分享前密钥扫描；阻断结果只输出脱敏元数据和指纹。
- 响应包含反爬 header，`robots.txt` 禁止索引。
- owner 访问使用 HMAC 签名 cookie 和 timing-safe key 比较。
- 当前限流实现为每个客户端身份每分钟 300 次请求。默认忽略可伪造的代理 header；只有在可信反向代理后面运行并设置 `DROP_TRUST_PROXY=1` 时才读取代理 header。

重要边界：

- 未过期 token URL 是 bearer link。任何拿到链接的人都能在过期或撤销前访问内容。
- Markdown 原始 HTML 会被转义，SVG 通过图片预览渲染，模板控制的文件元数据会进行 HTML 转义。仍应把分享内容视为 bearer-link 内容，避免分享不可信或敏感材料。
- 不要分享密钥、`.env`、API key、OAuth 凭证、数据库备份，或可能包含这些内容的目录。

## 公网访问

只在本机使用时，默认 URL 通常足够：

```bash
drop README.md
```

如果要公网分享，运行你偏好的隧道工具并设置 `base_url`：

```bash
cloudflared tunnel --url http://localhost:17173
ngrok http 17173
tailscale funnel 17173

drop config set base_url https://your-domain.example
```

CLI 暴露了 `drop serve --tunnel` 选项，但在生产工作流中依赖内置隧道前，请先确认当前实现是否完整。

## 开发

```bash
bun install
bun run dev:serve          # 前台启动服务
bun run build:web          # 构建 Svelte 目录浏览器
bun run dev:web            # 运行 Svelte 开发服务
bun run build              # 编译单文件二进制
bun run verify             # 运行项目验证入口
```

构建脚本默认生成 `linux-x64` 二进制，也可以传入 `--target` 指定目标：

```bash
bun run scripts/build.ts --target darwin-arm64
```

## 许可证

MIT
