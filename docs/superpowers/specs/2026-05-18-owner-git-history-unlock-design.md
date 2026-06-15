# Drop 第二阶段设计：Owner 解锁更多 Git 历史

## 背景

第一阶段已经让 Git 仓库目录分享页具备 `Files / Commits` 标签页：普通访问者默认只能看到最近 5 条 commit，并且只能打开这 5 条 commit 的 diff。这个限制是有意设计的安全边界，因为 Git 历史可能包含已删除文件、历史凭证、内部路径、作者身份和其他不应默认公开的信息。

第二阶段要解决的问题是：分享所有者在需要审阅更多历史时，可以临时解锁更大的 commit 窗口，例如最近 100 条，而不把这部分历史默认暴露给所有访客。

## 目标

- 让 owner 可以在目录分享页中查看更多 Git commit 历史。
- 解锁后可查看更大窗口内的 commit diff，例如最近 100 条。
- 普通访客仍保持第一阶段的默认安全边界：最近 5 条。
- 复用现有 owner 身份能力，避免引入新的长期密码体系。
- 解锁权限应有明确范围、明确过期时间，并且可被测试验证。

## 非目标

- 不把最近 100 条 commit 默认展示给所有访客。
- 不设计新的独立管理员密码系统。
- 不做永久解锁。
- 不把 Git 历史浏览做成完整 GitHub 替代品；仍然只服务于临时预览和审阅。
- 不在第二阶段默认暴露 author email 等更敏感元数据。
- 不处理任意深度历史、分支切换、tag 浏览、commit 搜索或 blame。

## 产品原则

1. **默认最小暴露**：未解锁时只展示最近 5 条。
2. **Owner 主动解锁**：更多历史必须由 owner 明确触发。
3. **短期授权**：解锁状态应该自动过期。
4. **范围清晰**：解锁能力应能绑定到明确的分享范围，避免意外扩大权限。
5. **不新增密钥负担**：优先复用已有 owner key / owner auth。
6. **可回退**：如果解锁失败，页面应继续保持最近 5 条可用，不影响基础分享。

## 建议体验

目录分享页的 `Commits` 标签继续默认显示最近 5 条 commit。列表附近增加一个轻量提示：

> 默认仅显示最近 5 条 commit。Owner 可临时解锁更多历史。

Owner 点击解锁入口后，在当前页面打开轻量 modal，输入现有 owner key。前端应通过同源 POST 请求提交 owner key，不把 owner key 放入 URL、query string、访问日志或可分享链接。验证成功后，当前页面切换到扩展历史视图，展示最近 100 条 commit，并允许打开这 100 条内的 diff。

普通访客看不到扩展历史，也不能通过直接请求 API 绕过限制。

## 权限模型草案

第二阶段倾向复用已有 owner key / owner auth 来验证身份，但不要直接把全局 `drop_owner` cookie 当作扩展历史权限。验证成功后应下发一个单独的、范围更窄的 signed cookie。该 cookie 表示“当前浏览器已获得当前分享的扩展 Git 历史读取权限”。

已确认的权限边界：

- 解锁只对当前分享链接生效，不扩展到同一浏览器里的其他 Drop 分享。
- 解锁有效期与当前分享生命周期一致；如果分享过期，扩展历史解锁也同时失效。
- 解锁 cookie 必须绑定当前分享标识、权限范围和过期时间。
- 如果后续 owner 通过既有机制延长了分享有效期，扩展历史解锁不应自动无限延长；需要重新解锁或重新签发与新分享过期时间一致的 cookie。
- 扩展历史权限应使用独立 cookie，例如 `drop_dir_git_history`，而不是复用 30 天全局 owner cookie。

已确认的第二阶段 MVP 隐私边界：

- 解锁后不扩展敏感 metadata，继续隐藏 author email。
- 解锁后仍只显示 commit hash / short hash、subject、author name、authored_at 和 file_count 等必要信息。
- 不显示 remote URL、branch 信息、本地路径或更完整身份字段。

## 数据与 API 行为

概念上，目录 Git API 有两个视图：

- 普通视图：最近 5 条 commit。
- Owner 扩展视图：最近 100 条 commit。

无论前端是否隐藏入口，后端都必须独立执行权限判断。也就是说：

- 未解锁请求 commit 列表时，只能返回最近 5 条。
- 未解锁请求第 6 条及更早 commit diff 时，应拒绝。
- 已解锁请求 commit 列表时，可返回当前分享允许的扩展窗口。
- 已解锁请求 diff 时，只能访问当前分享扩展窗口内的 commit。
- 超出扩展窗口的 commit 仍应拒绝。
- 分享过期后，即使浏览器还带有旧解锁 cookie，也必须拒绝访问。

## 安全与隐私

第二阶段的主要风险不是技术访问控制本身，而是 Git 历史内容的敏感性。因此设计上要保留第一阶段的保守默认值。

STRIDE 视角下的主要威胁：

- Spoofing：伪造 owner 身份或伪造扩展历史 cookie。
- Tampering：篡改 cookie 中的 token、权限范围、窗口大小或过期时间。
- Repudiation：owner 解锁失败或成功时缺少可诊断但不泄密的状态。
- Information Disclosure：owner key、内部 token、本地路径、git stderr 或历史敏感内容意外暴露。
- Denial of Service：对解锁接口或 git diff 接口高频请求导致本地服务压力过高。
- Elevation of Privilege：把某个分享的解锁权限提升为其他分享或全局 owner 权限。

需要重点防护：

- 伪造 cookie。
- 跨分享复用 cookie。
- 解锁过期后仍能访问扩展 diff。
- 通过 SHA 猜测访问窗口外 commit。
- 错误响应泄露本地路径、git stderr 或仓库内部细节。
- 访问日志记录完整路径、query、owner key 或敏感 token。
- owner key 通过 GET query 传输导致浏览器历史、代理日志或 Referer 泄露。
- 直接复用长期全局 owner cookie 导致扩展历史权限范围过大或时间过长。
- 跨站表单或脚本诱导 owner 浏览器发起解锁请求。
- 解锁 cookie 未设置 HttpOnly / SameSite / Secure，导致被脚本、跨站请求或明文链路滥用。
- 大 diff 或高频 diff 请求造成本机 CPU/内存压力；扩展窗口仍应保持有限大小。

## UI 原则

UI 不应把第二阶段做成复杂后台。它应该只是 Commits tab 中的一个小能力：

- 默认状态：显示最近 5 条和安全提示。
- 未解锁状态：显示 owner 解锁入口。
- 解锁入口：当前页面内 modal 输入 owner key，不跳转 owner dashboard；提交方式使用同源 POST，不使用 URL query。
- 解锁中：显示确认或加载状态。
- 已解锁状态：显示最近 100 条，并明确提示“已为当前分享解锁更多历史，直到分享过期”。
- 失败状态：展示友好错误，但保持最近 5 条可用。
- 第二阶段 MVP 不提供“锁回最近 5 条”按钮；如需退出解锁状态，可关闭浏览器或清理 cookie，后续再评估显式锁回。

## 实现约束

后续实现计划应遵守以下约束：

- 新增解锁 API 应只接受同源 POST 请求体中的 owner key，并拒绝 query string 中的 key。
- 解锁 API 应校验 `Origin` / `Sec-Fetch-Site` 等同源信号；缺失时可兼容 CLI/测试，但跨站请求必须拒绝。
- 解锁 API 成功后返回不含 owner key 的状态信息，并设置 HttpOnly、SameSite=Lax 的 signed cookie；公网 HTTPS 场景应设置 Secure，本地 HTTP 开发可降级。
- 解锁响应应设置 `Cache-Control: no-store`，避免 owner key 相关请求或响应被缓存。
- signed cookie payload 至少包含分享真实 token、权限范围、扩展窗口大小和过期时间。
- API 判断权限时应使用真实 token，不应只信任 slug 或前端传入的 public id。
- 后端每次读取扩展历史前都要重新确认分享仍有效，且 cookie 中绑定的 token 与当前分享一致。
- 如果同一个分享既可通过 token 访问也可通过 slug 访问，权限判断必须统一映射到真实 token；slug 改名、撤销或重建后不能复用旧 cookie 获取新分享权限。
- 前端提交 owner key 后应立即清空输入框和本地变量，不在 DOM、URL、localStorage、sessionStorage 或日志中保留。
- 错误响应保持通用，不把 owner key 校验细节、git stderr、本地路径或内部 token 暴露给访客。
- 解锁失败应走现有全局 rate limit，并可在实现计划中评估是否增加更严格的 per-share / per-IP 失败计数；不能在响应中区分“key 错误”“分享不存在”“权限范围错误”等细节。

## 测试策略

后续实现计划应至少覆盖：

- 普通访客只能看到最近 5 条。
- 普通访客不能打开第 6 条 commit diff。
- Owner 解锁后可看到扩展窗口。
- Owner 解锁后可打开扩展窗口内 diff。
- 超出扩展窗口的 SHA 仍不可访问。
- owner key 使用 POST 提交，接口不接受 query key 解锁。
- 跨站 Origin / Sec-Fetch-Site 请求不能设置解锁 cookie。
- 解锁响应包含 no-store，cookie 包含 HttpOnly、SameSite，并在 HTTPS 场景包含 Secure。
- cookie 伪造失败。
- cookie 过期后失效。
- 解锁 cookie 绑定当前分享，跨 token/slug 复用失败。
- slug 与 token 两种访问方式都映射到真实 token，撤销或重建分享后旧 cookie 不能访问新分享。
- 分享过期后，扩展历史解锁同步失效。
- 非 Git 目录不展示解锁入口。
- 错误响应不泄露本地路径或 git stderr。

## 待评审决策

已确认的第二阶段 MVP 组合：

1. 解锁入口：当前页面 modal 输入现有 owner key，不跳转 owner dashboard；owner key 通过同源 POST 提交，不进入 URL。
2. 解锁范围：仅当前分享。
3. 解锁时长：与当前分享生命周期一致；分享过期时解锁同步失效。
4. 扩展窗口：最近 100 条 commit。
5. metadata：不扩展，继续隐藏 author email。
6. 锁回按钮：第二阶段 MVP 不做。

后续非 MVP 可再评估：

- 是否增加显式“锁回最近 5 条”按钮。
- 是否增加更细粒度的 owner 会话管理。
- 是否允许 owner 查看更多 metadata。

## 安全审阅结论

第二阶段 MVP 可以进入实现计划，但实现时必须把“当前分享绑定、POST owner key、独立短期 cookie、服务端强制窗口限制”作为不可降级要求。最大风险不是普通 XSS，而是 owner key 进入 URL/日志、长期全局 owner cookie 被误当作扩展权限、以及某个分享的解锁 cookie 被复用到其他分享。

实现计划应优先从失败测试开始覆盖这些边界，再写后端解锁 API 和前端 modal。任何为了省事而复用 `/owner/auth?key=...` 或 30 天 `drop_owner` cookie 的方案都不符合本文档。

## 推荐下一步

下一步可以基于已确认的第二阶段 MVP 组合写详细实现计划，计划中拆分后端鉴权、API 扩展、前端 modal/状态、测试和文档更新。
