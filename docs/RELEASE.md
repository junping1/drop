# 发布清单

本文档记录 `drop` 发版前需要完成的检查和发布资产约定。源码仓库不提交编译后的二进制；二进制应作为 GitHub Release assets 上传。

## 发布前检查

1. 确认工作区干净，并在目标发布分支上：

   ```bash
   git status --short
   git branch --show-current
   ```

2. 更新版本号、`CHANGELOG.md`、README 或其他需要同步的文档。
3. 运行项目验证入口：

   ```bash
   scripts/verify.sh
   ```

4. 验证失败时不要发布；先修复失败原因并重新运行完整验证。

## 构建目标

构建脚本支持这些目标：

| 目标 | 用途 | 构建命令 | Release asset 名称 |
| --- | --- | --- | --- |
| `linux-x64` | Linux x86_64 / amd64 | `bun run scripts/build.ts --target linux-x64` | `drop-linux-x64` |
| `linux-arm64` | Linux arm64 / aarch64 | `bun run scripts/build.ts --target linux-arm64` | `drop-linux-arm64` |
| `darwin-x64` | macOS Intel | `bun run scripts/build.ts --target darwin-x64` | `drop-darwin-x64` |
| `darwin-arm64` | macOS Apple Silicon | `bun run scripts/build.ts --target darwin-arm64` | `drop-darwin-arm64` |

注意：当前 `scripts/build.ts` 对 Darwin 目标的本地输出文件名是 `dist/drop`。发布到 GitHub Release 前，需要把它重命名为对应的 asset 名称，例如：

```bash
bun run scripts/build.ts --target darwin-x64
cp dist/drop dist/drop-darwin-x64

bun run scripts/build.ts --target darwin-arm64
cp dist/drop dist/drop-darwin-arm64
```

Linux 目标默认已经输出为 `dist/drop-linux-x64` 或 `dist/drop-linux-arm64`。

## 构建全部发布资产

优先使用发布构建脚本，它会先构建一次前端资源，再按 `install.sh` 期望的文件名生成四个 release assets，并在 Darwin 目标构建后自动复制为 `drop-darwin-*` 文件名：

```bash
bun install
bun run build:release

ls -lh \
  dist/drop-linux-x64 \
  dist/drop-linux-arm64 \
  dist/drop-darwin-x64 \
  dist/drop-darwin-arm64
```

可以先 dry run 检查将执行的构建步骤：

```bash
bun run scripts/build-release.ts --dry-run
```

如果在单台机器上交叉编译失败，分别在对应 Linux/macOS 机器上运行目标构建命令，再收集四个 release assets。

## 发布后冒烟测试

1. 从 GitHub Release 页面确认四个 asset 都存在，且文件名与 `install.sh` 中的检测逻辑一致。
2. 在至少一台 macOS 和一台 Linux 机器上运行安装脚本：

   ```bash
   curl -fsSL https://raw.githubusercontent.com/junping1/drop/master/install.sh | bash
   drop --version
   ```

3. 做基础功能冒烟测试：

   ```bash
   drop status
   drop allow README.md --ttl 60
   drop list
   drop stop
   ```

4. 如需公网访问，手动运行 tunnel 并设置 `base_url`；`drop serve --tunnel` 目前只是预留选项，不会启动 tunnel。
