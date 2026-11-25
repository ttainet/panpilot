# PanPilot

> Status: v0.3 — **deployed 2026-11-25** via the Cloudflare API to https://panpilot.ttai.net
> (verified live: D1 store, password login, Driver auth). Source not yet pushed to GitHub.
> 状态：v0.3 — **已于 2026-11-25 经 Cloudflare API 部署上线**并完成线上验证；源码尚未推送 GitHub。设计见 [DESIGN.md](./DESIGN.md)。

**Repository / 仓库：** https://github.com/ttainet/panpilot
**Live / 正式域名：** https://panpilot.ttai.net

## 简介 | Introduction

PanPilot is a MoviePilot-style media subscription **control plane** running on
Cloudflare Workers. You subscribe to a TV show / movie / variety show on a web
page; everything else — searching Telegram channels via PanSou, diffing against
what is already in your Quark drive, transferring only the missing episodes,
renaming them into your library layout, and reporting progress back — is done
by an external **Driver** (an AI agent such as Muse, or any program you write)
through the Driver API defined in DESIGN.md.

PanPilot 是一个部署在 Cloudflare Workers 上的影视订阅**控制面**，订阅交互参考
MoviePilot：用户只在网页上订阅电视剧/电影/综艺；搜索 TG 频道（经 PanSou）、
与夸克网盘已有集数做 diff、只转存缺失集、按目录规范重命名入库、回写进度，
全部由外部 **Driver**（Muse 等 AI 代理，或用户自写的程序）通过 DESIGN.md
定义的 Driver API 执行。

**The control plane never stores any cloud-drive cookie or password.**
**控制面不保存任何网盘 Cookie 或密码**，登录态只存在于 Driver 所在设备。

## 架构 | Architecture

```
Browser ──(username/password login)──► Workers (PanPilot) ──► D1
                                                  ▲
                              Driver API (Bearer) │
                                        Driver (Muse / your program)
                                                  ├─► PanSou / TG search
                                                  └─► Quark: list / transfer selected episodes / rename
```

Library layout enforced by the Driver / Driver 入库目录规范：

```
电影电视剧 / 电视剧|电影|综艺 / 地区分类（如国产剧） / 剧名 (年份) / Season N
文件名：剧名 - SxxEyy - 第 y 集.mkv
```

Full design — D1 schema, Driver API, state machine, security boundaries:
see [DESIGN.md](./DESIGN.md). 完整设计（表结构、Driver API、状态机、安全边界）
见 DESIGN.md。

## 登录与设置 | Login & settings

- **Web login** is a simple username/password form. Credentials come from the
  Worker secrets `APP_USERNAME` / `APP_PASSWORD`; a successful login issues an
  HMAC-signed session cookie (`SESSION_SECRET`, falling back to `APP_PASSWORD`).
  Unauthenticated page visits redirect to `/login`; web APIs return 401.
  网页端为**账号密码登录**（Secrets：`APP_USERNAME` / `APP_PASSWORD`），登录后发
  HMAC 签名会话 Cookie；未登录访问页面跳 `/login`、API 返回 401。不用 Cloudflare Access。
- **Change credentials in the backend （后台改账号密码）**: the settings page has a
  「修改登录账号」form. Changing the username/password requires the current
  password; the new pair is stored in the `settings` table (password as a
  PBKDF2-SHA256 hash with a random salt — never plaintext) and then takes
  precedence over the secrets. All previously issued sessions are invalidated;
  the current browser is re-issued a fresh session.
  设置页可改登录用户名/密码：须验证当前密码，新密码以 PBKDF2 哈希存 settings 表
  并覆盖初始值；改完旧会话全部失效，本浏览器自动续上新会话。
- **Driver API** uses a separate Bearer token (`DRIVER_TOKEN`), unaffected by web login.
  Driver API 用独立的 Bearer Token，与网页登录互不影响。
- **Settings page （设置页 `/settings`)**: save/update/clear your **TMDB API Key**.
  It is stored in the D1 `settings` table and only ever shown masked (last 4 chars).
  可在设置页配置 TMDB API Key（存 settings 表，页面只显示末 4 位掩码，可更新/清除）。
- **Subscribe flow （选剧）**: on the home page, search TMDB (zh-CN) by title, pick a
  result, and the form is auto-filled with TMDB id, year, type, region category
  (mapped from `origin_country`: CN→国产剧， HK/TW→港台剧， JP→日剧， KR→韩剧， else→欧美剧）
  plus per-season episode counts — MoviePilot-style, subscriptions bind to a TMDB id.
  If no TMDB key is configured, the search explains that and manual entry still works.
  订阅页可按剧名搜 TMDB 选剧并自动回填；未配置 Key 时有明确提示，手动填写仍可用。

## 本地运行 | Run locally

```bash
npm install
# create .dev.vars (git-ignored) with local fake secrets:
#   APP_USERNAME=admin
#   APP_PASSWORD=your-local-password
#   DRIVER_TOKEN=your-local-driver-token
#   SESSION_SECRET=your-local-session-secret   (optional)
#   CHECK_INTERVAL_HOURS=6
npx wrangler d1 migrations apply panpilot --local   # local D1 schema
npm run dev        # wrangler dev on http://localhost:8787
npm run typecheck
```

With a D1 binding present the Worker uses D1 by default; without one it falls
back to an in-memory store. `GET /api/health` honestly reports which is active
(`store: "d1"` or `"memory"`); memory mode does not persist across restarts.
有 D1 binding 时默认走 D1，否则回退内存存储；`/api/health` 会如实标注当前存储。

## 部署 | Deployment

> **Deployed on 2026-11-25 via the Cloudflare API** (not `wrangler deploy`),
> using [`scripts/deploy.py`](./scripts/deploy.py) — the API credential is
> supplied by the registered connector at runtime and never touches the repo,
> env vars, or logs. 已于 2026-11-25 经 Cloudflare API 部署（脚本见 scripts/deploy.py）。

What the script does / 脚本做的事：

1. Creates (or reuses) the D1 database `panpilot` and applies
   `migrations/0001_init.sql` statement-by-statement via the D1 query API,
   then verifies all six tables exist. 创建 D1 并逐条执行迁移、核对六表。
2. Bundles `src/index.ts` with esbuild and uploads it as a Worker module with
   bindings: D1 `DB`, plain-text `CHECK_INTERVAL_HOURS=6`. 打包并上传 Worker。
3. Sets the secrets `APP_USERNAME` / `APP_PASSWORD` (initial values chosen by
   the owner — change them afterwards on the settings page), plus randomly
   generated `SESSION_SECRET` and `DRIVER_TOKEN`. The driver token is also
   written to `.driver-token` locally (mode 600, git-ignored) for Driver use.
   设置四个 Secret；随机生成的 Driver Token 另存本机 `.driver-token`。
4. Binds the hostname. Note: the Workers Custom Domains API rejected this
   account's API token (`10405 Method not allowed for this authentication
   scheme`), so the script falls back to the classic equivalent — a zone
   Worker route `panpilot.ttai.net/*` → `panpilot` plus a proxied placeholder
   DNS record. 自定义域 API 对本账号 Token 返回 10405，故用 Zone 路由 + 橙云
   DNS 记录的等价方式绑定，效果一致。
5. Backfills the real `database_id` into `wrangler.toml`. 回填 database_id。

For a fresh deployment with wrangler instead, the equivalent steps are:
`wrangler d1 create panpilot` → fill `database_id` → `wrangler d1 migrations
apply panpilot --remote` → `wrangler secret put` ×4 → `wrangler deploy` →
bind the custom domain in the dashboard.

## Git remote 说明 | Git remote

This project is developed for the public repository
https://github.com/ttainet/panpilot. To work with it locally:

本项目面向公开仓库 https://github.com/ttainet/panpilot 开发，本地关联方式：

```bash
git init
git remote add origin https://github.com/ttainet/panpilot.git
# pushing requires the repository owner's GitHub authentication
# (e.g. `gh auth login`); do not commit any secrets or cookies.
```

## 安全须知 | Security notes

- The web UI is protected by the username/password login described above;
  use a strong `APP_PASSWORD` and never expose the Worker with auth disabled
  (auth is only disabled when the secrets are unset, e.g. local dev).
- `DRIVER_TOKEN` is separate from web credentials and can be rotated on its own.
- The TMDB API Key saved on the settings page lives in your own D1 database and
  is only ever displayed masked; it is never committed to git.
- Never store Quark/TG cookies in Workers, D1, git, or logs.

## License

[MIT](./LICENSE)
