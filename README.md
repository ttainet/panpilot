# PanPilot

> Status: v0.7 — **deployed 2026-11-25** via the Cloudflare API to https://panpilot.ttai.net
> (verified live: D1 store, password login, Driver auth); source is developed in the
> public repository below.
> 状态：v0.7 — **已于 2026-11-25 经 Cloudflare API 部署上线**并完成线上验证；源码在本仓库公开开发。设计见 [DESIGN.md](./DESIGN.md)。
> v0.7 新增：入库目录做成设置页可改的 `directories` 设置（默认值与用户夸克真实
> 结构一致：日韩合并、国漫/纪录片/综艺在电视剧下、电影分华语/外语/动画），Driver
> config 下发生效值、TMDB 分类与之对齐；新增写给 AI Driver 的操作手册
> （docs/AI_DRIVER_GUIDE.md、根目录 AGENTS.md、站内 `GET /api/driver/agent-guide`）。
> v0.6 新增：Driver API Key 可在设置页按 Driver 命名创建/重置/吊销（服务端只存 SHA-256
> 哈希，明文只显示一次），`GET /api/driver/config` 一并下发 TMDB API Key —— Driver
> 需要的一切凭据都从 PanPilot 取，无有效 Key 时 Driver 接口一律 401、拿不到任何数据。
> v0.5 新增：设置页可加密保存夸克 Cookie 供 Driver 取用转存（AES-GCM，见下方安全说明），
> TG 频道列表可在设置页配置（默认预填 2026-11-23 验证的 147 个有效频道）。

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

**The control plane never stores any cloud-drive password.** A Quark cookie is
stored **only if you paste one on the settings page**, and then only as
AES-GCM ciphertext (key held in a Worker secret); web APIs never return it —
only your Driver can fetch it. See the security notes below.
**控制面不保存任何网盘密码。** 夸克 Cookie 仅在你于设置页主动粘贴时保存，且只存
AES-GCM 密文（密钥在 Worker Secret 中）；网页接口永不返回，仅你的 Driver 可取用。
详见下方安全须知。不填 Cookie 时，Driver 可继续用其所在设备上的登录态执行。

## 界面 | Web UI

v0.4 ships a dark, single-page web UI in the spirit of MoviePilot: a fixed
sidebar （仪表盘 / 我的订阅 / 发现 / 设置）, dashboard stat cards, a **poster-wall**
subscription grid (TMDB poster, season/episode progress bar, status badge,
pause/resume/delete), a TMDB discover page with a detail dialog for
per-season subscribing, and a card-style settings page. On narrow screens the
sidebar collapses into a top bar. The UI is served by the same single Worker —
no separate frontend build.

v0.4 的网页是深色单页界面：左侧固定导航（仪表盘 / 我的订阅 / 发现 / 设置）、
仪表盘统计卡、**海报墙**订阅卡片（TMDB 海报、季集进度条、状态徽章、暂停/恢复/删除）、
发现页 TMDB 海报网格 + 详情弹窗按季订阅、卡片式设置页；手机上侧边栏收起为顶部
横向导航。界面仍由同一个 Worker 内嵌提供，无需单独打包前端。

> **Acknowledgement / 致谢**: the web UI's layout and interaction ideas are
> inspired by [MoviePilot](https://github.com/jxxghp/MoviePilot). PanPilot's
> UI is an **independent implementation** written from scratch for this
> project — no MoviePilot code or assets are used.
> 本项目界面的布局与交互灵感来自 MoviePilot，但代码为**独立实现**，未使用
> MoviePilot 的任何代码或素材。

## 架构 | Architecture

```
Browser ──(username/password login)──► Workers (PanPilot) ──► D1
                                                  ▲
                              Driver API (Bearer) │
                                        Driver (Muse / your program)
                                                  ├─► PanSou / TG search
                                                  └─► Quark: list / transfer selected episodes / rename
```

Library layout enforced by the Driver / Driver 入库目录规范（`directories`
设置，设置页可改，默认值与用户夸克真实结构一致）：

```
电影电视剧 / 电视剧 / 地区分类（国产剧|欧美剧|日韩剧）或特殊分类（国漫|纪录片|综艺） / 剧名 (年份) / Season N
电影电视剧 / 电影 / 分类（华语电影|外语电影|动画电影） / 剧名 (年份)
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
- **Driver API** is authenticated by an API key (`Authorization: Bearer <key>`),
  unaffected by web login. Without a valid key every Driver endpoint returns
  401 and exposes nothing — subscriptions, the Quark cookie, the TMDB key and
  the channel list are all behind it.
  Driver API 用独立的 API Key 鉴权，与网页登录互不影响；无有效 Key 时全部
  Driver 接口返回 401，订阅、Cookie、TMDB Key、频道清单都拿不到。
- **Driver API Keys （Driver 凭据管理）**: the settings page manages named keys,
  one per Driver. A key looks like `ppk_` + 64 hex chars; the server stores
  **only its SHA-256 hash** plus a display hint, and the plaintext is shown
  **exactly once** when the key is created or reset. Reset revokes the old key
  and issues a new one under the same name; revoke kills a key immediately.
  The `DRIVER_TOKEN` Worker secret remains as a **bootstrap key**: always
  valid, not listed in the UI; disable it by changing/removing the secret.
  `GET /api/driver/config` provisions everything a Driver needs for a round —
  the decrypted Quark cookie, the **TMDB API key**, and the effective channel
  list — so a Driver holds no credentials of its own besides its PanPilot key.
  设置页可按 Driver 命名创建/重置/吊销 API Key：服务端只存哈希与提示，
  明文只在创建/重置时显示一次；`DRIVER_TOKEN` Secret 是始终有效的「系统引导
  Key」（不在列表中，停用需改 Secret）。Driver 每轮经 config 接口取齐 Cookie、
  TMDB Key 与频道清单，自身只需保管 PanPilot 的 Key。
- **Settings page （设置页 `/settings`)**: save/update/clear your **TMDB API Key**.
  It is stored in the D1 `settings` table and only ever shown masked (last 4 chars).
  可在设置页配置 TMDB API Key（存 settings 表，页面只显示末 4 位掩码，可更新/清除）。
- **Quark Cookie （夸克 Cookie)**: the settings page can store your Quark cookie so
  the Driver can call the Quark API directly. It is encrypted with **AES-GCM**
  (key = Worker secret `COOKIE_ENC_SECRET`; the feature is disabled when that
  secret is unset — there is no plaintext fallback). The settings API only ever
  reports whether one is configured, when, its length, and the validity the
  Driver last reported via `POST /api/driver/quark-status`. The Driver fetches
  the decrypted cookie (plus the effective channel list) from
  `GET /api/driver/config` (Bearer token, `Cache-Control: no-store`).
  设置页可保存夸克 Cookie 供 Driver 直接调夸克接口转存：AES-GCM 加密存储（未配置
  加密密钥时功能禁用、无明文兜底），页面只显示配置状态/长度/Driver 回报的有效性；
  Driver 经 `GET /api/driver/config` 取回明文与生效频道清单。
- **TG channels （TG 频道列表）**: the settings page edits the channel list the
  Driver searches (one per line, deduped/validated on save, one-click reset).
  Defaults are the 147 channels verified on 2026-11-23 (seed data in
  `src/channels.ts`); a "priority only" switch narrows to the 76 channels
  confirmed to post Quark links (for a custom list it intersects with those 76,
  falling back to the full custom list if the intersection is empty).
  设置页可编辑 Driver 搜索用的 TG 频道清单：默认预填 2026-11-23 逐个验证的 147 个
  有效频道，可自定义/恢复默认；「只用夸克优先」开关对应其中 76 个确认有夸克链接的频道。
- **Subscribe flow （选剧）**: on the home page, search TMDB (zh-CN) by title, pick a
  result, and the form is auto-filled with TMDB id, year, type, region category
  plus per-season episode counts — MoviePilot-style, subscriptions bind to a TMDB id.
  The region category is resolved through the `directories` settings maps
  (defaults: CN/HK/TW→国产剧， JP/KR→日韩剧， else→欧美剧； Chinese animation→国漫，
  documentary→纪录片， reality/talk→综艺； movies: 华语电影/动画电影/外语电影）.
  If no TMDB key is configured, the search explains that and manual entry still works.
  订阅页可按剧名搜 TMDB 选剧并自动回填，地区分类经 directories 映射解析
  （分类以该设置为准）；未配置 Key 时有明确提示，手动填写仍可用。
- **Library directories （入库目录）**: the settings page edits the folder layout
  the Driver files into — base/TV/movie folder names, the three category maps
  (TV regions, TV specials, movie categories) and the naming templates.
  Defaults mirror the owner's real Quark structure (see above); the effective
  object is returned by `GET /api/settings` and shipped to Drivers in
  `GET /api/driver/config`. Invalid values are rejected with 400.
  设置页可编辑入库目录的路径、三组分类映射与命名模板；生效值经设置接口与
  Driver config 下发，非法值会被 400 拒绝，可一键恢复默认。

## 给 AI Driver 的文档 | For AI Drivers

If you are an AI agent (or a program) acting as a PanPilot **Driver**, start here:

- **[AGENTS.md](./AGENTS.md)** — the concise brief: your role, auth, the
  ten-step round, exception handling and the API list.
- **[docs/AI_DRIVER_GUIDE.md](./docs/AI_DRIVER_GUIDE.md)** — the full
  operating manual (source of truth): claim leases, inventory-before-search,
  candidate scoring, the Quark API family, rename/verify/write-back,
  cookie-invalid and other exception branches, and the security red lines.
- **Online**: `GET /api/driver/agent-guide` on a deployed instance returns
  the same full guide as Markdown (Driver API key required) — fetch it at
  the start of a round if you have not read it.

如果你是担任 Driver 的 AI 代理：先读 AGENTS.md 速览，再按
docs/AI_DRIVER_GUIDE.md 详细手册执行；线上实例也可经
`GET /api/driver/agent-guide`（需 Driver Key）取回手册全文。三处内容保持
同步，手册为源头。

## 本地运行 | Run locally

```bash
npm install
# create .dev.vars (git-ignored) with local fake secrets:
#   APP_USERNAME=admin
#   APP_PASSWORD=your-local-password
#   DRIVER_TOKEN=your-local-driver-token
#   SESSION_SECRET=your-local-session-secret   (optional)
#   COOKIE_ENC_SECRET=<64 hex chars>           (optional; enables encrypted Quark cookie storage)
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

1. Creates (or reuses) the D1 database `panpilot` and applies every
   `migrations/*.sql` file statement-by-statement via the D1 query API,
   then verifies all six tables exist. For schema-only updates on an existing
   deployment, run `python3 scripts/deploy.py --step migrate` (idempotent;
   does not touch secrets). 创建 D1 并逐条执行全部迁移、核对六表；已有部署只
   升级表结构时用 `--step migrate`（幂等，不动任何 Secret）。
2. Bundles `src/index.ts` with esbuild and uploads it as a Worker module with
   bindings: D1 `DB`, plain-text `CHECK_INTERVAL_HOURS=6`. 打包并上传 Worker。
3. Sets the secrets `APP_USERNAME` / `APP_PASSWORD` (initial values chosen by
   the owner — change them afterwards on the settings page), plus randomly
   generated `SESSION_SECRET` and `DRIVER_TOKEN`. The driver token is also
   written to `.driver-token` locally (mode 600, git-ignored) for Driver use.
   设置四个 Secret；随机生成的 Driver Token 另存本机 `.driver-token`。
   For feature deploys that must keep live secrets, run the steps individually
   (`--step migrate|bundle|upload`) plus `--step enc-secret`, which only
   ensures `COOKIE_ENC_SECRET` exists (generating it solely when missing) and
   never rotates the other secrets. 已有部署的功能升级用分步执行 + `--step enc-secret`
   （仅补设缺失的 Cookie 加密密钥，绝不轮换已有 Secret）。
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
- The Quark cookie (if you choose to save one) is stored in D1 **only as
  AES-GCM ciphertext**; the decryption key is a separate Worker secret
  (`COOKIE_ENC_SECRET`). If both the database and that secret leak, the cookie
  must be considered leaked — treat a cookie like a login credential: never
  paste it into chat, git, issues, or logs, and revoke it (log out / change
  password on the Quark side) if you suspect exposure. Cookie saves, clears,
  and Driver fetches are audit-logged as events only (never the value).
  夸克 Cookie 只以 AES-GCM 密文存 D1、密钥为独立 Worker Secret；两者同时泄露即
  等同 Cookie 泄露。Cookie 等同登录凭证，不要粘贴到聊天/git/日志中。

## License

[MIT](./LICENSE)
