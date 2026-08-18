# dsh-auth-gate

English | [中文](#中文)

Authentication and security hardening plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

## Security Risks in Public Network / Docker Deployment

DeepSeek Harness is designed as a **local development tool**. Its default security model relies on loopback binding (`127.0.0.1`) and request header validation (Host / Origin / Sec-Fetch-Site). This model breaks down in several common deployment scenarios:

### Scenario 1: Docker container deployment

```dockerfile
# Common Dockerfile pattern
EXPOSE 3080
CMD ["npx", "@deepseek-ai/dsh", "web"]
```

**Important correction**: `EXPOSE` alone exposes nothing, and Docker port publishing cannot normally reach a process bound only to the container's loopback interface. The risk appears only when DSH is configured/patched to bind `0.0.0.0`, or when another process inside the container proxies a container-facing port to DSH. Publishing that port without host-IP restriction (for example `-p 3080:3080`) then exposes the full Agent control plane to reachable networks.

**Root cause**: No authentication layer. The trust fence only validates request headers, not caller identity.

### Scenario 2: Reverse proxy (Nginx / Caddy)

```nginx
server {
    listen 80;
    server_name dsh.example.com;
    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
    }
}
```

**Risk**: The reverse proxy forwards `Host` and `Origin` headers from the client. The trust fence sees matching headers and allows the request. Anyone who can reach the reverse proxy has full access.

**Root cause**: Trust fence validates headers, not network origin. A proxy that passes through Host/Origin defeats the fence.

### Scenario 3: Cloud VM / CI runner

```sh
# Running on a cloud VM with public IP
dsh --profile headless "deploy the app"
```

**Risk**: If the VM's firewall is misconfigured or the service binds to `0.0.0.0` (future feature), the agent is remotely accessible. A compromised agent can execute arbitrary code on the VM.

**Root cause**: No authentication, no network-level access control beyond binding.

### Scenario 4: Team shared instance

```sh
# Running on an office server for the team
DSH_AUTH_TOKEN="" dsh web --host 0.0.0.0  # future: when 0.0.0.0 is supported
```

**Risk**: All team members share the same Agent instance. One user's malicious prompt can affect another user's session. No audit trail of who did what.

**Root cause**: No user identity, no session isolation, no audit logging.

### What the trust fence actually protects

| Check | What it does | What it does NOT do |
|-------|-------------|-------------------|
| Host header | Blocks DNS rebinding attacks | Does not verify the caller is local |
| Sec-Fetch-Site | Blocks cross-site requests from browsers | Does not block curl, scripts, or non-browser clients |
| Origin header | Blocks cross-origin browser requests | Does not block requests without Origin header |

The trust fence is a **browser CSRF defense**, not an authentication layer. It stops malicious websites from making requests to your local DSH instance. It does not stop anyone who can directly HTTP-connect to the port.

### This plugin's mitigations

| Risk | Mitigation | Coverage |
|------|-----------|----------|
| Unauthorized API access | Bearer token + session login | HTTP + WebSocket routes |
| Excess approval prompts | Prepended per-session waterfall limiter | Approvals that reach this listener |
| Exposed 0.0.0.0 | Fail-closed authentication gateway | HTTP + WebSocket |
| Windows partial sandbox | Documented, not fixable at plugin level | — |

### What this plugin does NOT fix

1. **ACP / SDK channels**: These run over stdio (stdin/stdout), not HTTP. Not reachable over the network, but also not protected if the process is shared.

2. **No user isolation**: All authenticated users share the same Agent instance and session pool. There is no per-user sandboxing.

3. **No audit logging**: This plugin does not log who authenticated or what they did. The DSH session log records agent actions but not the human identity behind them.

4. **Approval listener ordering**: The limiter is prepended, but Cordis permits a later plugin to prepend another short-circuiting answerer ahead of it. Treat the limiter as defense in depth, not an unbypassable policy boundary.

5. **Reverse-proxy login buckets**: Login attempts are keyed by the TCP peer address. Behind a reverse proxy, users share the proxy's bucket; configure edge rate limiting as well. The plugin intentionally does not trust spoofable forwarding headers.

The plugin wraps both existing and future DSH HTTP/upgrade routes. Because current DSH exposes registries rather than middleware, startup fails closed if that internal contract changes.

## Install and choose protection

Install once and select a preset. Credentials stay in environment variables and are never written to a patch file.

```powershell
$env:DSH_AUTH_USERNAME = 'admin'
$env:DSH_AUTH_PASSWORD = Read-Host 'Enter a private password (12+ characters)'
# Required when the public URL uses HTTPS:
$env:DSH_AUTH_SECURE_COOKIE = 'true'

.\install.ps1 -Protection Full
.\install.ps1 -Protection NetworkAuth
.\install.ps1 -Protection ApprovalLimit
```

If `dsh` is not on `PATH`, the script automatically uses a sibling `deepseek-harness` source checkout. For another location, pass `-HarnessPath C:\path\to\deepseek-harness`.

`Full` is the default. Add `-Start` to launch immediately. Otherwise the script prints the exact reusable launch command. Keep using its `--patch` argument on later launches:

```powershell
dsh --profile web --patch C:\path\to\dsh-auth-gate\presets\full.yml
```

| Preset | HTTP + WebSocket auth | Approval limiter | Important consequence |
|---|---:|---:|---|
| `Full` | Yes | Yes | Recommended |
| `NetworkAuth` | Yes | No | Approval prompts are not rate-limited |
| `ApprovalLimit` | No | Yes | Network control surfaces remain unauthenticated |

HTTP and WebSocket authentication cannot be split. This prevents an authenticated UI with an exposed RPC upgrade channel. Existing top-level configuration remains compatible and means full protection when `protections` is absent.

## Initial password and collaborators

### Terminal users

Set credentials in the same process environment that starts Harness. Do not put a real password in YAML or command-line arguments.

```powershell
cd C:\path\to\deepseek-harness
$env:DSH_AUTH_USERNAME = 'admin'
$env:DSH_AUTH_PASSWORD = Read-Host 'Enter a private password (12+ characters)'
$env:DSH_AUTH_SECURE_COOKIE = 'false' # local HTTP only; use true with HTTPS
pnpm dsh web
```

Environment changes do not affect an already-running process. Restart Harness after changing a password. Because session signing keys are generated per startup, every restart signs all browser sessions out.

### WebUI-only users on Windows

The first password cannot safely be created inside the protected WebUI: authentication must exist before the page can open. Use **Start → Edit environment variables for your account**, create `DSH_AUTH_USERNAME`, `DSH_AUTH_PASSWORD`, and `DSH_AUTH_SECURE_COOKIE`, then fully quit and reopen the Harness WebUI launcher. User environment variables are stored by Windows and may be readable by other processes running as the same OS user; use this only for a trusted local account.

### Collaborator accounts

Version 1.1 supports **one shared login identity only**. It cannot create a second independently named collaborator account or attribute actions to different people. Sharing the primary password gives access but is not an independent account and is not recommended for untrusted teams.

For a temporary trusted collaborator, rotate the shared password, restart Harness, share it through a secure channel, then rotate and restart again when access should end. For durable collaborators, use separate Harness instances/OS identities or an authenticating reverse proxy with one identity per person. Do not claim per-user isolation: authenticated users still share the same Agent, sessions, workspace authority, and audit identity.

## Configuration

### Bearer Token mode

For scripts and non-browser clients. HTTP and WebSocket requests must include `Authorization: Bearer <token>`, and the token must be at least 32 bytes. Browser WebSocket APIs cannot set this header, so use `session` or `both` for the Web UI.

**Option A: Environment variable**

```powershell
$env:DSH_AUTH_TOKEN = [Convert]::ToHexString(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
).ToLowerInvariant()
dsh web
```

**Option B: Config (not recommended because config diagnostics may expose it)**

```yaml
config:
  mode: bearer
  # Deliberately empty: generate a private token; never copy a documented value.
  token: ''
```

**Usage:**

```sh
# Denied
curl http://127.0.0.1:3080/api
# → 401 Unauthorized

# Allowed
curl -H "Authorization: Bearer $env:DSH_AUTH_TOKEN" http://127.0.0.1:3080/api
# → 200 OK
```

### Session mode

Login page with username/password, session cookie.

```yaml
config:
  mode: session
  # Omit credentials here; set DSH_AUTH_USERNAME and DSH_AUTH_PASSWORD.
  sessionTtl: 3600
  loginPath: /auth/login
```

Visit `http://127.0.0.1:3080/auth/login` to sign in. The cookie is `HttpOnly; SameSite=Strict`. Set `secureCookie: true` for HTTPS/public deployments; leave it false only for direct local HTTP.

### Both modes

```yaml
config:
  mode: both
  # Omit credentials here; set DSH_AUTH_TOKEN, DSH_AUTH_USERNAME,
  # and DSH_AUTH_PASSWORD in the process environment.
```

Bearer token for API/script access, login page for browser access.

### Sandbox escalation rate limiting

```yaml
config:
  approvalRateLimit:
    maxPerMinute: 3
    maxPerSession: 10
```

Excess requests are denied with `'unavailable'` (fail-closed).

## Config reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `'bearer' \| 'session' \| 'both'` | `'bearer'` | Authentication mode |
| `protections.networkAuth` | `boolean` | `true` | Enable inseparable HTTP + WebSocket authentication |
| `protections.approvalRateLimit` | `boolean` | `true` | Enable approval waterfall rate limiting |
| `auth` | `object` | — | Optional nested form for all authentication fields below |
| `token` | `string` | env `DSH_AUTH_TOKEN` | Bearer token |
| `sessionSecret` | unsupported | random per startup | Persistent secrets are rejected so logged-out cookies cannot revive after restart |
| `sessionTtl` | `number` | `3600` | Session lifetime in seconds |
| `loginPath` | `string` | `'/auth/login'` | Login page URL path |
| `username` | `string` | — | Session login username |
| `password` | `string` | — | Session login password |
| `secureCookie` | `boolean` | `false` | Add `Secure` to the cookie; enable with HTTPS |
| `approvalRateLimit.maxPerMinute` | `number` | `3` | Max escalation requests per minute |
| `approvalRateLimit.maxPerSession` | `number` | `10` | Max escalation requests per session |

Bearer tokens must be at least 32 bytes. Login attempts are limited to five per source address per minute. Every startup generates a new session secret and invalidates old browser sessions; persistent secrets are rejected because logout revocations are intentionally process-local.

## Architecture

```
HTTP / WebSocket Request
  ↓
AuthGateway (exact, prefix, fallback, and upgrade routes)
  ├─ /auth/login → login page handler
  ├─ /auth/logout → logout handler
  └─ /* → auth check
       ├─ Authorization: Bearer <token> → validateBearer()
       ├─ Cookie: dsh_session=<token> → validateSession()
       └─ No valid auth → 401 / redirect to login

Approval Request (approval/request waterfall)
  ↓
RateLimiter
  ├─ Resolve session from req.agent.session.id
  ├─ Under limits → delegate to next answerer
  └─ Over limits → 'unavailable' (denied)
```

## Development

```sh
npm install
npm run typecheck
npm run build
npm test
```

## License

[MIT](LICENSE). Please report security issues according to [SECURITY.md](SECURITY.md).

---

---

# 中文

DeepSeek Harness 的 [认证与安全加固插件](https://github.com/deepseek-ai/deepseek-harness)。

## 公网部署 / Docker 部署的安全隐患

DeepSeek Harness 的定位是**本地开发工具**。它的默认安全模型依赖 loopback 绑定（`127.0.0.1`）和请求头校验（Host / Origin / Sec-Fetch-Site）。在以下常见部署场景中，这个模型会失效：

### 场景一：Docker 容器部署

```dockerfile
# 常见的 Dockerfile 写法
EXPOSE 3080
CMD ["npx", "@deepseek-ai/dsh", "web"]
```

**重要更正**：`EXPOSE` 本身不会暴露端口，Docker 端口发布通常也无法访问只绑定在容器 loopback 上的进程。只有当 DSH 被配置/修改为绑定 `0.0.0.0`，或容器内另有进程把对外端口代理到 DSH 时才出现风险。此时若使用未限制宿主 IP 的 `-p 3080:3080`，完整的 Agent 控制面会暴露给可达网络。

**根因**：没有认证层。信任围栏只校验请求头，不验证调用者身份。

### 场景二：反向代理（Nginx / Caddy）

```nginx
server {
    listen 80;
    server_name dsh.example.com;
    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
    }
}
```

**隐患**：反向代理会把客户端的 `Host` 和 `Origin` 头原样转发。信任围栏看到匹配的 header 就放行。任何能访问反向代理的人，都拥有完整权限。

**根因**：信任围栏校验的是 header，不是网络来源。透传 Host/Origin 的代理会让围栏失效。

### 场景三：云服务器 / CI 运行器

```sh
# 在有公网 IP 的云服务器上运行
dsh --profile headless "deploy the app"
```

**隐患**：如果服务器防火墙配置不当，或者未来 DSH 支持 `0.0.0.0` 绑定，Agent 会被远程访问。被攻破的 Agent 可以在服务器上执行任意代码。

**根因**：没有认证，绑定之外没有网络层访问控制。

### 场景四：团队共享实例

```sh
# 在办公室服务器上跑给团队用
DSH_AUTH_TOKEN="" dsh web --host 0.0.0.0  # 未来支持时
```

**隐患**：所有团队成员共享同一个 Agent 实例。一个用户的恶意 prompt 可以影响其他用户的 session。没有审计日志记录谁做了什么。

**根因**：没有用户身份，没有 session 隔离，没有审计日志。

### 信任围栏实际保护了什么

| 检查项 | 做了什么 | 没做什么 |
|--------|---------|---------|
| Host header | 阻止 DNS rebinding 攻击 | 不验证调用者是否在本地 |
| Sec-Fetch-Site | 阻止浏览器的跨站请求 | 不阻止 curl、脚本、非浏览器客户端 |
| Origin header | 阻止浏览器的跨域请求 | 不阻止没有 Origin header 的请求 |

信任围栏是一个**浏览器 CSRF 防御**，不是认证层。它能阻止恶意网站向你的本地 DSH 发请求，但无法阻止任何能直接 HTTP 连接到该端口的人。

### 本插件的缓解措施

| 风险 | 缓解措施 | 覆盖范围 |
|------|---------|---------|
| 未授权 API 访问 | Bearer token + 登录页 | HTTP + WebSocket 路由 |
| 过量审批提示 | 前置的按会话 waterfall 限流 | 能到达该监听器的审批请求 |
| 暴露 0.0.0.0 | fail-closed 认证网关 | HTTP + WebSocket |
| Windows 沙箱不完整 | 已文档化，插件层无法修复 | — |

### 本插件无法修复的问题

1. **ACP / SDK 通道**：走 stdio（stdin/stdout），不走 HTTP。网络上不可达，但如果进程被共享则无法保护。

2. **没有用户隔离**：所有认证用户共享同一个 Agent 实例和 session 池，没有 per-user 沙箱。

3. **没有审计日志**：本插件不记录谁认证了、做了什么。DSH session 日志记录 Agent 行为，但不记录背后的人类身份。

4. **审批监听器顺序**：限流器会 prepend，但 Cordis 允许后加载的插件再次 prepend 并在其前方短路。该限流器属于纵深防御，不是不可绕过的策略边界。

5. **反向代理登录桶**：登录尝试按 TCP 对端地址计数；反向代理后的用户会共享代理的桶，因此还应配置边缘限流。本插件刻意不信任可伪造的转发请求头。

插件会包装 DSH 已有和以后注册的 HTTP/upgrade 路由。由于当前 DSH 暴露的是注册表而非 middleware，一旦内部契约变化，插件会 fail closed 并拒绝启动。

## 安装并选择防护类型

插件只安装一次，通过预设选择防护模块。凭据只从环境变量读取，不会写入 patch 文件。

```powershell
$env:DSH_AUTH_USERNAME = 'admin'
$env:DSH_AUTH_PASSWORD = Read-Host '请输入私有密码（至少12个字符）'
# 公网 URL 使用 HTTPS 时必须设置：
$env:DSH_AUTH_SECURE_COOKIE = 'true'

.\install.ps1 -Protection Full
.\install.ps1 -Protection NetworkAuth
.\install.ps1 -Protection ApprovalLimit
```

如果 `dsh` 不在 `PATH`，脚本会自动使用同级的 `deepseek-harness` 源码仓库；位于其他目录时传入 `-HarnessPath C:\path\to\deepseek-harness`。

默认是 `Full`。添加 `-Start` 可立即启动；否则脚本会输出准确的启动命令，例如：

```powershell
dsh --profile web --patch C:\path\to\dsh-auth-gate\presets\full.yml
```

| 预设 | HTTP + WebSocket 认证 | 审批限流 | 重要后果 |
|---|---:|---:|---|
| `Full` | 是 | 是 | 推荐 |
| `NetworkAuth` | 是 | 否 | 审批提示不受本插件限流 |
| `ApprovalLimit` | 否 | 是 | 网络控制面仍无认证 |

HTTP 和 WebSocket 认证不可拆分，避免 UI 已认证但 RPC upgrade 裸露。旧版顶层配置继续兼容；没有 `protections` 时等同完整防护。

## 初始密码与协作者

### 终端用户

在启动 Harness 的同一个进程环境中设置凭据，不要把真实密码写进 YAML 或命令行参数。

```powershell
cd C:\path\to\deepseek-harness
$env:DSH_AUTH_USERNAME = 'admin'
$env:DSH_AUTH_PASSWORD = Read-Host '请输入私有密码（至少12个字符）'
$env:DSH_AUTH_SECURE_COOKIE = 'false' # 仅本机 HTTP；HTTPS 必须为 true
pnpm dsh web
```

环境变量修改不会影响已经运行的进程；修改密码后必须重启 Harness。每次启动都会生成新的 session 签名密钥，因此重启也会让全部浏览器会话退出。

### 只使用 WebUI 的 Windows 用户

首次密码不能安全地在受保护的 WebUI 内创建，因为页面开放前认证就必须存在。打开 **开始菜单 → 编辑账户的环境变量**，新增 `DSH_AUTH_USERNAME`、`DSH_AUTH_PASSWORD` 和 `DSH_AUTH_SECURE_COOKIE`，然后彻底退出并重新打开 Harness WebUI 启动器。Windows 会保存用户环境变量，同一操作系统用户运行的其他进程可能读取它们，因此只适用于可信的本机账户。

### 协作者账户

1.1 版本目前只支持**一个共享登录身份**，不能创建第二个独立命名的协作者账户，也不能把操作归因到不同人员。共享主密码虽然可以访问，但不属于独立账户，不建议用于互不信任的团队。

临时可信协作者可使用以下流程：轮换共享密码并重启 Harness，通过安全渠道发送密码；协作结束后再次轮换并重启。长期协作者应使用独立 Harness 实例/操作系统身份，或在前方部署支持每人独立身份的认证反向代理。即使认证通过，用户仍共享 Agent、session、workspace 权限和审计身份，不具备 per-user 隔离。

## 配置

### Bearer Token 模式

用于脚本及非浏览器客户端。HTTP 和 WebSocket 请求都必须带 `Authorization: Bearer <token>`，token 至少 32 字节。浏览器 WebSocket API 无法设置该请求头，因此 Web UI 请使用 `session` 或 `both`。

**方式一：环境变量**

```powershell
$env:DSH_AUTH_TOKEN = [Convert]::ToHexString(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
).ToLowerInvariant()
dsh web
```

**方式二：配置文件**

```yaml
config:
  mode: bearer
  # 故意留空：请生成私有随机 token，不要复制文档中的固定值。
  token: ''
```

**验证：**

```sh
# 无 token → 拒绝
curl http://127.0.0.1:3080/api
# → 401 Unauthorized

# 有 token → 放行
curl -H "Authorization: Bearer $env:DSH_AUTH_TOKEN" http://127.0.0.1:3080/api
# → 200 OK
```

### Session 模式

带登录页面，用户名密码验证后发 session cookie。

```yaml
config:
  mode: session
  # 此处不写凭据；请设置 DSH_AUTH_USERNAME 和 DSH_AUTH_PASSWORD。
  sessionTtl: 3600
  loginPath: /auth/login
```

访问 `http://127.0.0.1:3080/auth/login` 登录。Cookie 设置为 `HttpOnly; SameSite=Strict`。HTTPS/公网部署必须设置 `secureCookie: true`；仅本机直接 HTTP 调试时保持 false。

### 两者同时启用

```yaml
config:
  mode: both
  # 此处不写凭据；请在进程环境中设置 DSH_AUTH_TOKEN、
  # DSH_AUTH_USERNAME 和 DSH_AUTH_PASSWORD。
```

API/脚本用 token，浏览器用登录页。

### 沙箱升级速率限制

```yaml
config:
  approvalRateLimit:
    maxPerMinute: 3
    maxPerSession: 10
```

超限请求直接拒绝，返回 `'unavailable'`（fail-closed）。

## 配置参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | `'bearer' \| 'session' \| 'both'` | `'bearer'` | 认证模式 |
| `protections.networkAuth` | `boolean` | `true` | 启用不可拆分的 HTTP + WebSocket 认证 |
| `protections.approvalRateLimit` | `boolean` | `true` | 启用审批 waterfall 限流 |
| `auth` | `object` | — | 下列认证字段也可统一写在此对象中 |
| `token` | `string` | 环境变量 `DSH_AUTH_TOKEN` | Bearer token |
| `sessionSecret` | 不支持 | 每次启动随机生成 | 拒绝持久密钥，避免已注销 Cookie 在重启后复活 |
| `sessionTtl` | `number` | `3600` | Session 有效期（秒） |
| `loginPath` | `string` | `'/auth/login'` | 登录页路径 |
| `username` | `string` | — | 登录用户名 |
| `password` | `string` | — | 登录密码 |
| `secureCookie` | `boolean` | `false` | 为 Cookie 添加 `Secure`；HTTPS 必须启用 |
| `approvalRateLimit.maxPerMinute` | `number` | `3` | 每分钟最大升级请求数 |
| `approvalRateLimit.maxPerSession` | `number` | `10` | 每 session 最大升级请求数 |

Bearer token 必须至少 32 字节。登录尝试按来源地址限制为每分钟 5 次。每次启动都会生成新 session secret 并使旧浏览器会话失效；由于注销状态只在进程内保存，持久密钥会被拒绝。

## 架构

```
HTTP / WebSocket 请求
  ↓
认证网关（exact、prefix、fallback 和 upgrade 路由）
  ├─ /auth/login → 登录页处理
  ├─ /auth/logout → 登出处理
  └─ /* → 认证检查
       ├─ Authorization: Bearer <token> → validateBearer()
       ├─ Cookie: dsh_session=<token> → validateSession()
       └─ 无有效认证 → 401 / 重定向到登录页

审批请求（approval/request waterfall）
  ↓
速率限制器
  ├─ 从 req.agent.session.id 获取会话
  ├─ 未超限 → 交给下一个审批处理器
  └─ 超限 → 'unavailable'（拒绝）
```

## 开发

```sh
npm install
npm run typecheck
npm run build
npm test
```

## 许可证

[MIT](LICENSE)。安全漏洞请按照 [SECURITY.md](SECURITY.md) 私下报告。
