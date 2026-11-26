# PanPilot 设计稿 v1.1.0

> 状态：v1.1.0。本文档描述目标架构与接口契约；部署方式见 README 的部署章节
> （部署到你自己的 Cloudflare 账号与域名）。
>
> v1.1 变更：订阅页分组（已完成 = completed | ended，其余为订阅中，仪表盘
> 口径与之统一）；新增网页日志接口 `GET /api/logs`（级别/订阅筛选、时间
> 倒序分页）与「日志」页；Driver 日志提交端点校验级别
> （info | warn | error，缺省 info）；迁移 0005 为 logs 表补分页索引。
>
> v1.0 变更：画质偏好系统。全局档案存 settings 键 `quality`（src/quality.ts：
> preferred_resolution / allow_fallback / exclude_remux / exclude_cam /
> prefer_h265 / max_episode_gb / exclude_keywords），设置页新增「画质偏好」
> Tab；订阅级覆盖只到清晰度一维（迁移 0004 新增 `subscriptions.quality`，
> 空 = 跟随全局）；`GET /api/driver/config` 下发全局档案，`GET
> /api/driver/pending` 每条订阅附带合并后的 `quality_profile`；手册选源
> 改为两段式（硬过滤 → 打分），已入库规格优先于档案（同季不混版不变）。
>
> v0.9 变更：AI Driver 手册（docs/AI_DRIVER_GUIDE.md §5）把目录与命名规则重写为
> 明确无歧义的决策顺序 + 精确模板 + 正反例（先盘点复用已有剧名夹、季集解析规则、
> 字幕跟随、同季画质一致、不确定就停），AGENTS.md 同步精简版；`directories` 新增
> 电影与综艺两个命名模板键 `movie_name_template` / `variety_name_template`
> （设置页可改、Driver config 下发；旧设置缺键时读取自动补默认、不报错）。
>
> v0.8 变更：设置页按功能域拆成 Tab（账号 / 媒体信息 / 网盘 / 搜索源 / 入库目录 / Driver），
> 面板仅以 display:none 隐藏（未保存编辑切走不丢），激活 Tab 同步到 URL hash，
> 需关注状态（TMDB 未配置、Cookie 未配置/已失效）在页签上以红点提示。纯前端呈现
> 调整，不改任何接口、字段与行为。
>
> v0.7 变更（用户拍板）：(1) **入库目录成为一等设置**（settings 键 `directories`，
> 默认值参考一套实际在用的夸克影视库结构：根「电影电视剧」下只有电视剧/电影两夹；电视剧下
> 地区夹为国产剧/欧美剧/**日韩剧（日韩合并）**，国漫/纪录片/综艺同在电视剧下；
> 电影下为华语电影/外语电影/动画电影）。设置页可改路径、三个映射与命名模板，
> `GET /api/driver/config` 返回生效值；**分类一律以 directories 设置为准**——
> TMDB 回填映射改为经映射表解析（JP/KR→日韩剧），不再硬编码。(2) **AI Driver
> 操作文档三处落点**：`docs/AI_DRIVER_GUIDE.md`（详细版源头）、仓库根
> `AGENTS.md`（精简版）、站内接口 `GET /api/driver/agent-guide`（Driver 鉴权，
> 返回详细版全文；由 `scripts/gen-guide.mjs` 从 docs 生成 `src/guide.ts`）。
>
> v0.6 变更（用户拍板）：**Driver 需要的一切凭据都从 PanPilot 下发** ——
> `GET /api/driver/config` 在夸克 Cookie、频道清单之外新增下发 TMDB API Key；
> Driver 访问 PanPilot 必须凭 **API Key**，无有效 Key 时全部 Driver 接口 401、
> 拿不到任何数据。此前以 `DRIVER_TOKEN` Secret 实现的单一 Token 产品化为
> **后台可管理的命名 Key**（新表 `driver_keys`，见 §4.7）：每个 Driver 可有
> 自己的 Key，可在设置页创建/重置/吊销；DB 只存 SHA-256 哈希，明文仅在
> 创建/重置响应中出现一次。`DRIVER_TOKEN` 保留为「系统引导 Key」：始终有效、
> 不在 UI 列表中，停用需改 Worker Secret（详见 §7）。
>
> v0.5 变更（均为用户明确拍板）：(1) **推翻此前「控制面不存 Cookie」的设计** —— 设置页可
> 配置夸克 Cookie，但只以 **AES-GCM 加密**形式存 settings 表（密钥为 Worker Secret
> `COOKIE_ENC_SECRET`，未配置则功能禁用、无明文兜底），网页端接口永不返回明文或密文，
> 仅 Driver 经 `GET /api/driver/config` 可取回明文，并经 `POST /api/driver/quark-status`
> 回报有效性（详见 §4.6/§6/§9）；(2) **TG 频道列表可在设置页配置**：默认预填 2026-11-23
> 逐个验证的 147 个有效频道（种子数据在 `src/channels.ts`），可自定义、恢复默认，并可
> 开「只用夸克优先频道（76）」开关，Driver config 返回最终生效清单。
>
> v0.4 变更：前端按 MoviePilot 风格重做为深色单页应用（左侧导航 + 仪表盘统计卡 +
> 海报墙订阅卡片 + 发现页海报网格/详情弹窗 + 卡片式设置页；布局与交互为参考，
> 代码与 CSS 全部独立实现，未使用 MoviePilot 的 GPL 代码/素材）；subscriptions 表
> 新增 `poster_path` / `overview` / `rating` 三列（迁移 `0002_poster.sql`，TMDB 选剧时回填）；
> 新增只读聚合接口 `GET /api/stats`（订阅总数/追更中/已完结/已入库集数 + 每订阅已入库数）。

## 1. 定位

PanPilot 是一个**影视订阅控制面**，部署在 Cloudflare Workers 上，交互参考 MoviePilot 的订阅模式：

- 用户只在网页上订阅（选剧、选季、选画质、选模式）。
- 搜索与转存**不在** Workers 内执行，由外部 **Driver** 驱动：
  Driver 定期查询到期订阅 → 搜索 TG / PanSou 的夸克分享 → 盘点用户夸克实际目录做 diff →
  只转存缺失/指定集 → 按目录规范重命名入库 → 回写进度。
- Driver 可以是 Muse（v1，定时唤醒 + 浏览器登录态执行）、用户自写的程序（v2，如跑在家庭
  NAS / 国内 IP 设备上的小程序调用夸克接口），或任何实现了 §6 Driver API 的客户端。
  更换 Driver 不影响订阅数据与网页。

### 与 MoviePilot 的对应关系

| MoviePilot | PanPilot |
|---|---|
| PT 站点 | TG 频道 / PanSou 聚合搜索 |
| 种子 | 夸克分享链接（share code） |
| 下载器（qBittorrent 等） | 夸克转存（Driver 在执行端完成） |
| 本地媒体库 | 用户的夸克网盘目录 |
| 订阅规则/洗版 | 候选评分：标题/年份匹配、集号覆盖、文件大小合理性、画质一致性 |

## 2. 架构图（文字）

```
┌──────────────────────────── Cloudflare ────────────────────────────┐
│  用户浏览器 ──(账号密码登录，会话 Cookie)──► Workers (PanPilot)   │
│                                                    │  静态订阅页   │
│                                                    │  REST API     │
│                                                    ▼               │
│                                              D1 (SQLite)           │
│                                    subscriptions / episodes /      │
│                                    candidates / driver_tasks /     │
│                                    logs / settings                 │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ Driver API（API Key 鉴权, HTTPS）
              ┌────────────────┴─────────────────┐
              ▼                                  ▼
     Driver v1: Muse                    Driver v2: 自写程序
     （定时唤醒、浏览器登录态              （家庭设备、经 config 接口取
       或经 config 取 Cookie 执行）           Cookie 调夸克接口执行）
              │                                  │
              ├─► PanSou / t.me/s 频道搜索（147 有效频道，76 夸克优先）
              └─► 夸克网盘（列目录 / 选集转存 / 重命名 / 复核）
```

**凭据边界（v0.5 修订）：控制面不存任何网盘密码/登录态；夸克 Cookie 仅在用户主动
在设置页填写时保存，且必须是 AES-GCM 密文**（密钥 `COOKIE_ENC_SECRET` 只在 Worker
Secret 中，不进 D1/代码/日志）。网页端永远看不到 Cookie（明文与密文都不返回），只有
持 Driver Token 的 Driver 能经 API 取回明文。用户也可以不填 Cookie、继续让 Driver
用自己设备上的登录态执行。不填 Cookie 时本条与原「不存 Cookie」设计等价。

## 3. 用户目录规范（Driver 入库必须遵守）

规范由 settings 键 `directories` 定义（见 §4.6），**分类以该设置为准**；
默认值参考一套实际在用的夸克影视库结构：

```
电影电视剧（base_dir）
├─ 电视剧（tv_dir）
│   ├─ {地区分类：国产剧|欧美剧|日韩剧}   ← tv_region_map，JP/KR 合并为日韩剧
│   ├─ {特殊分类：国漫|纪录片|综艺}        ← tv_special_map，同在电视剧下
│   └─ {剧名} ({年份}) / Season {N} / {剧名} - S{xx}E{yy} - 第 {y} 集.mkv
│      （剧名夹也可直接放在电视剧层——盘点时各层都要找、找到就复用）
└─ 电影（movie_dir）
    └─ {分类：华语电影|外语电影|动画电影}   ← movie_category_map
       / {剧名} ({年份}) /（电影文件，无 Season 层；剧名夹也可直放电影层）
```

- 模板（title_template / season_template / episode_name_template /
  movie_name_template / variety_name_template）同在 `directories` 里，默认值
  分别为 `{title} ({year})`、`Season {season}`、
  `{title} - S{season:02}E{episode:02} - 第 {episode} 集`、`{title} ({year})`、
  `{title} - S{season:02}E{episode:02} - 第 {episode} 期`（后两者 v0.9 新增：
  电影文件名与综艺文件名；Driver 执行细节以手册 §5 为准）。
- 电影不建 `Season N` 层；综艺的集号语义（期/集）在订阅字段中单独标注。
- 转存前先盘点目标目录已有集数，只转 `源集号集 − 已有集号集`，不整包重复转存。
- 同一分享含多个画质子文件夹时，默认选与已有文件规格一致的一版，不混版本；
  同集多版本按订阅的画质优先级选一。
- 文件大小异常（如单集比相邻集小一个数量级）标记 `anomaly`，默认跳过并写日志，不自动入库。

## 4. D1 数据表结构

> 以下为目标 schema（见 `migrations/0001_init.sql` 草案，尚未执行）。时间统一存 Unix 秒（INTEGER）。

### 4.1 subscriptions — 订阅主表

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| title | TEXT NOT NULL | 剧名（展示名） |
| original_title | TEXT | 原名/别名，用于搜索关键词扩展 |
| year | INTEGER | 年份，与标题共同消歧 |
| tmdb_id | INTEGER | TMDB ID，可空；选剧时回填元数据 |
| media_type | TEXT NOT NULL | `tv` \| `movie` \| `variety` |
| region | TEXT | 地区分类，如 `国产剧`，决定入库二级目录 |
| season | INTEGER | 目标季，电影为 NULL |
| total_episodes | INTEGER | 该季总集数，可空（未知时由 Driver 回填） |
| quality_pref | TEXT | 画质偏好 JSON，如 `["4K HDR","4K","1080p"]`，或 `match_existing` |
| poster_path | TEXT | TMDB 海报路径（如 `/abc.jpg`），海报墙展示用；手动订阅可空（v0.4 新增） |
| overview | TEXT | TMDB 简介，选剧时回填（v0.4 新增） |
| rating | REAL | TMDB 评分（订阅时快照）（v0.4 新增） |
| mode | TEXT NOT NULL | `manual`（找到候选等网页确认）\| `auto`（Driver 直接转存） |
| status | TEXT NOT NULL | 状态机见 §5 |
| target_dir | TEXT | 入库目标目录（按 §3 生成后落库，可人工改） |
| next_check_at | INTEGER | 下次应被 Driver 查询的时间（调度到期判断） |
| check_interval_hours | REAL | 每订阅单独检查间隔（小时，v1.3 新增）；NULL = 跟随全局间隔 |
| last_checked_at | INTEGER | 上次 Driver 实际查询时间 |
| last_error | TEXT | 最近一次失败原因，可空 |
| created_at / updated_at | INTEGER NOT NULL | |

索引：`idx_subs_pending ON subscriptions(status, next_check_at)`。

### 4.2 episodes — 集进度（每订阅每集一行）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| subscription_id | TEXT FK | → subscriptions.id |
| season | INTEGER NOT NULL | |
| episode | INTEGER NOT NULL | |
| status | TEXT NOT NULL | `missing` \| `found` \| `transferring` \| `stored` \| `failed` \| `skipped` |
| source_share_code | TEXT | 实际入库所用分享码 |
| source_channel | TEXT | 来源 TG 频道名 |
| quark_fid | TEXT | 入库后在用户夸克中的文件 ID（Driver 复核后回填） |
| file_name | TEXT | 入库后的规范文件名 |
| file_size | INTEGER | 字节数，异常检测用 |
| updated_at | INTEGER NOT NULL | |

唯一约束：`UNIQUE(subscription_id, season, episode)`。

### 4.3 candidates — 候选源（搜索结果落库，供评分/人工确认/换源）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| subscription_id | TEXT FK | |
| share_url / share_code | TEXT NOT NULL | 夸克分享链接与码 |
| channel | TEXT | 来源频道 |
| post_url | TEXT | 来源帖子链接 |
| title_raw | TEXT | 帖子原始标题 |
| episodes_covered | TEXT | JSON 数组，如 `[1,2,3,5]`（解析出的集号集） |
| quality_label | TEXT | 如 `4K 10bit 60FPS` |
| total_size | INTEGER | 分享总大小（页面标注值） |
| score | REAL | Driver 评分（匹配度、覆盖缺集数、大小合理性、画质） |
| anomaly_note | TEXT | 异常说明，如 `E05 仅 58MB`，可空 |
| status | TEXT NOT NULL | `pending` \| `accepted` \| `rejected` \| `used` \| `dead` |
| found_at | INTEGER NOT NULL | |

### 4.4 driver_tasks / claims — 任务认领（带租约，防多 Driver 重复执行）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| subscription_id | TEXT FK | |
| driver_id | TEXT NOT NULL | 认领者标识，如 `claude-main`、`home-nas-01` |
| lease_expires_at | INTEGER NOT NULL | 租约到期时间；到期未续约/未完成，其他 Driver 可再认领 |
| heartbeat_at | INTEGER | 最近心跳 |
| status | TEXT NOT NULL | `claimed` \| `running` \| `done` \| `failed` \| `expired` |
| attempt | INTEGER NOT NULL | 第几次尝试（重试计数） |
| created_at / updated_at | INTEGER NOT NULL | |

认领必须原子化（已实现）：D1 用单条 `INSERT … SELECT … WHERE NOT EXISTS(未过期租约)`
完成认领，插入行数为 0 即表示已被占用，API 返回 `409 claim_conflict`，不存在 check-then-act 竞态。

### 4.5 logs — 执行与审计日志

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| subscription_id | TEXT FK, 可空 | 全局日志可空 |
| driver_id | TEXT | |
| level | TEXT NOT NULL | `info` \| `warn` \| `error` |
| event | TEXT NOT NULL | 如 `search_done`、`transfer_done`、`cookie_expired`、`diff_corrected` |
| detail | TEXT | JSON 或文本详情（**不得包含 Cookie/Token 明文**） |
| created_at | INTEGER NOT NULL | |

### 4.6 settings — 全局设置（KV 式单表）

| 列 | 类型 | 说明 |
|---|---|---|
| key | TEXT PK | 如 `tmdb_api_key`、`check_interval_hours`、`priority_channels`、`default_quality_pref`、`notify_webhook` |
| value | TEXT NOT NULL | JSON 字符串 |
| updated_at | INTEGER NOT NULL | |

频道清单（147 有效 / 76 夸克优先）作为代码内种子数据（`src/channels.ts`，来源为
2026-11-23 的逐个验证清单）：settings 无 `tg_channels` 时生效清单即默认 147；设置页可
保存自定义清单（`tg_channels`，JSON 数组）、恢复默认（删除该键）、开/关「只用夸克优先」
（`tg_channels_priority_only`）。优先开关的语义：默认清单时直接取 76 子集；自定义清单时
取其与 76 子集的交集，交集为空则退回自定义全量并在 Driver config 里以
`tg_channels_priority_fallback: true` 标注。
`directories`（v0.7）：入库目录设置 JSON（结构与校验见 `src/directories.ts`：
base_dir / tv_dir / movie_dir、三组映射 tv_region_map / tv_special_map /
movie_category_map、命名模板）。无此键时生效值为与用户真实夸克结构一致的
默认对象；设置页可保存（保存前服务端校验：路径不含首尾斜杠、映射值非空且为
单层文件夹名、模板含必要占位符，非法返回 400）与恢复默认（删除该键）。
v0.9 起命名模板为五个：新增 `movie_name_template`（默认 `{title} ({year})`）
与 `variety_name_template`（默认 `{title} - S{season:02}E{episode:02} - 第 {episode} 期`）；
旧设置对象缺这两个键时，读取与保存校验都会自动补默认值，不报错。
`GET /api/driver/config` 与 `GET /api/settings` 都返回生效值；TMDB 选剧回填的
地区分类也经同一组映射解析（regionForMedia），**分类以 directories 为准**。
`tmdb_api_key` 由设置页写入（见 §11 已定项 3），读取时只返回末 4 位掩码，完整 Key 不出服务端。
夸克 Cookie 相关键（v0.5）：`quark_cookie_enc`（AES-GCM 密文 JSON `{iv, ct}`，**绝无明文**）、
`quark_cookie_updated_at`、`quark_cookie_status` / `quark_cookie_checked_at`（Driver 回报的
有效性与时间）。加密密钥 `COOKIE_ENC_SECRET` 是 Worker Secret，不在 settings 表中。
`auth_username` / `auth_password` 为网页登录凭据的**后台覆盖值**（见 §7）：`auth_password`
存 PBKDF2-SHA256 哈希对象 `{salt, iterations, hash}`（随机盐，100k 次迭代），绝不存明文。

### 4.7 driver_keys — Driver API Key（v0.6，迁移 `0003_driver_keys.sql`）

| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | Driver 名称，如 `claude-main`、`home-nas-01`，一个 Driver 一个 Key |
| token_hash | TEXT NOT NULL UNIQUE | 完整 Token 的 **SHA-256 hex**；Token 本体为 `ppk_` + 32 字节随机数 hex |
| token_hint | TEXT NOT NULL | 展示提示，如 `ppk_…ab12`（首 4 + 末 4），仅供辨认，不是凭据 |
| created_at | INTEGER NOT NULL | |
| last_used_at | INTEGER | 最近一次鉴权成功时间；写入节流（>5 分钟才更新），避免高频写库 |
| revoked_at | INTEGER | NULL = 有效；非空 = 已吊销（重置旧行、手动吊销都写这里） |

明文 Token **只在创建/重置的响应里出现一次**，之后任何接口（包括列表）都只返回
name / hint / 时间 / 状态。创建、重置、吊销各写一条审计日志（detail 只含 id/name/hint，
不含明文）。鉴权时对请求 Token 做 SHA-256 后按 `token_hash` 查未吊销行；
未命中再回落 `DRIVER_TOKEN` Secret（引导 Key）的常量时间比较。

## 5. 订阅状态机

```
subscribed ─► pending_search ─► searching ─► candidates_ready ─┬─(manual)─► awaiting_confirm ─► transferring
      ▲              ▲                                            └─(auto)────────────────────► transferring
      │              │                                                                          │
      │              └──────────────────── next_check 到期 ◄── partial_stored ◄── verifying ──┤
      │                                                                                         ▼
      └──────────────（人工重新激活）────────────── suspended ◄── completed / ended（集齐或完结）
   任意状态 ─► error（附 last_error）─► 到期重试回 pending_search
   任意状态 ─► paused（人工暂停，Driver 跳过）
```

- `partial_stored`：已入库集数 < total_episodes，保持订阅、按 `next_check_at` 继续追更。
- `completed`：已集齐但剧未完结标记未知时与 `ended` 区分；`ended` 为 TMDB/人工确认完结且集齐。
- 集进度以 episodes 表为准，subscriptions.status 是其汇总视图。

## 6. Driver API 清单

Base：`https://<worker-domain>/api/driver/*`，鉴权见 §7。所有响应 JSON，错误格式
`{ "error": { "code": string, "message": string } }`。

| 方法 & 路径 | 用途 | 关键请求/响应 |
|---|---|---|
| `GET /api/driver/pending?limit=20` | 拉取到期且未集齐、未被有效租约占用的订阅 | → `{ subscriptions: Subscription[] }`，含每条的缺集列表 |
| `POST /api/driver/claim` | 认领订阅，创建带租约的 task | `{ subscription_id, driver_id, lease_seconds? }` → `{ task_id, lease_expires_at }`；已被占用返回 `409 claim_conflict` |
| `POST /api/driver/candidates` | 回报候选源（可多次追加） | `{ task_id, candidates: CandidateInput[] }` → `{ accepted: n }`；manual 模式下订阅转 `awaiting_confirm` |
| `POST /api/driver/progress` | 回写集进度与订阅状态 | `{ task_id, episodes: [{season, episode, status, source_share_code?, quark_fid?, file_name?, file_size?}], subscription_status?, next_check_at?, note? }` |
| `POST /api/driver/heartbeat` | 续约 + 存活上报 | `{ task_id, driver_id }` → `{ lease_expires_at }`；同时可上报 `driver_status`（如 `quark_login_ok: false`） |
| `POST /api/driver/logs`（可选） | 批量上报日志 | `{ task_id?, logs: [{level, event, detail?}] }` |
| `GET /api/driver/config` | 取本轮执行配置（v0.5；v0.6 新增 TMDB Key 下发；v0.7 新增 directories） | → `{ quark_cookie: string\|null, tmdb_api_key: string\|null, tg_channels: string[], tg_channels_priority_only, tg_channels_priority_fallback, check_interval_hours, directories: DirectorySettings }`；响应 `Cache-Control: no-store`；每次取用写一条审计日志（只记事件与存在性，不记内容） |
| `POST /api/driver/quark-status` | 回报夸克 Cookie 有效性（v0.5） | `{ status: "ok"\|"invalid", note?, driver_id? }` → 存 settings 并在设置页展示；`invalid` 时页面红色提示重新粘贴 |
| `GET /api/driver/agent-guide` | AI Driver 操作手册全文（v0.7） | → `text/markdown`（no-store）；内容与 `docs/AI_DRIVER_GUIDE.md` 一致（经 `src/guide.ts` 打包），仓库根 `AGENTS.md` 为其精简版 |

网页端 API（非 Driver）：

| 方法 & 路径 | 用途 |
|---|---|
| `GET /api/health` | 健康检查（不鉴权，只返回 `{ok, version, store}`，store 如实标注当前存储实现） |
| `GET /api/subscriptions` / `POST /api/subscriptions` | 订阅列表 / 新建 |
| `GET /api/subscriptions/:id` / `PATCH /api/subscriptions/:id` / `DELETE /api/subscriptions/:id` | 详情 / 改（状态、模式、画质、暂停等）/ 删除 |
| `POST /api/subscriptions/:id/confirm-candidate` | manual 模式下人工确认候选（后续阶段，骨架中为签名占位） |
| `GET /api/settings/driver-keys` | Driver API Key 列表（仅 name/hint/时间/状态，永不返回明文或哈希）（v0.6） |
| `POST /api/settings/driver-keys` | 新建命名 Key `{name}` → 201 `{ key: 明文（仅此一次）, driver_key }`（v0.6） |
| `POST /api/settings/driver-keys/:id/reset` | 吊销旧行并新建同名 Key → 201 返回新明文一次（v0.6） |
| `POST /api/settings/driver-keys/:id/revoke` | 吊销该 Key（幂等）（v0.6） |

## 7. 鉴权

- **网页端（已定，2026-11-25 用户拍板）**：简单的**账号密码登录**，不用 Cloudflare Access。
  初始用户名/密码由部署方指定（当前初始值 admin/admin），存为 Worker Secrets
  （`APP_USERNAME` / `APP_PASSWORD`）；登录成功后发 HMAC 签名的会话 Cookie
  （签名密钥为 `SESSION_SECRET`，未设置时由 `APP_PASSWORD` 派生）。
  未登录访问页面一律 302 到 `/login`、网页端 API 一律 401；凭据用常量时间比较；
  登录失败带简单的限速。已实现并本地验证。
- **后台修改登录账号（v0.3 已实现）**：设置页提供「修改登录账号」表单（`PUT /api/account`），
  必须先验证**当前密码**才能改用户名/新密码；新凭据写入 settings 表
  （`auth_username` + `auth_password` PBKDF2 哈希）后**覆盖** Secrets 的初始值，
  登录校验顺序为：settings 有完整覆盖对则用覆盖，否则回落 Secrets。
  会话 payload 内嵌凭据指纹（由当前有效凭据材料哈希得出），改密后指纹变化，
  **所有旧会话自动失效**；改密接口本身会为当前浏览器签发新会话，不把用户锁在门外。
  仅改用户名时，会把刚验证通过的当前密码一并哈希落库，保证覆盖对始终完整。
- **Driver（v0.6 修订）**：独立 **API Key**，与网页端凭据分离。请求头：
  `Authorization: Bearer <key>`。Key 只授予 §6 的 driver 路径，不能调用网页端接口。
  鉴权顺序：先查 UI 管理的命名 Key（`driver_keys` 表，对 Token 做 SHA-256 后按哈希查
  未吊销行；命中后节流更新 `last_used_at`），未命中再回落 **`DRIVER_TOKEN` Secret
  （系统引导 Key）** 的常量时间比较（基于 SHA-256 摘要，避免时序侧信道）。
  引导 Key 始终有效、不在设置页列表中，停用/轮换只能改 Worker Secret；
  UI Key 则可在设置页按 Driver 命名创建、重置（旧行吊销 + 新建同名）、吊销，
  DB 只存哈希，明文只在创建/重置时出现一次（见 §4.7）。
  **没有有效 Key 时，全部 Driver 接口一律 401**：订阅、候选、进度、夸克 Cookie、
  TMDB Key、频道清单都拿不到 —— Driver 需要的凭据全部经 PanPilot 下发，
  前提就是先持有 PanPilot 的 Key。
- 所有 Worker Secret 只通过 `wrangler secret put` 注入，**不进 git、不进 wrangler.toml**；
  UI Key 的哈希在 D1 中，明文不落库、不进日志。

## 8. Driver 执行流程（标准一轮）

1. `GET /pending` 拉到期订阅；逐条 `POST /claim` 认领（拿不到租约就跳过）。
2. **校正进度（铁律）**：先列用户夸克中该订阅 `target_dir` 的实际文件，解析集号集，
   与 progress 回报通道对账修正 episodes —— D1 进度只是缓存，**夸克实际目录才是真相**。
   人工在 App 里增删过文件，以实际目录为准。
3. 用 TMDB 元数据确认季/总集数/年份/地区（订阅里已有则复核即可），算出真实缺集。
4. 缺集为空 → 回写 `completed/ended`，结束；否则按关键词组（剧名/年份/别名）
   调 PanSou（限定 quark 类型、优先 76 频道）或直查 `t.me/s/<频道>?q=<剧名>`。
5. 对候选做解析与评分（§1 表），剔除大小异常与不覆盖缺集者，结果 `POST /candidates`。
6. manual 模式：停在 `awaiting_confirm`，通知用户在网页确认；auto 模式：选最高分候选继续。
7. 在分享页只勾选缺集文件 → 转存到 `target_dir/Season N` → 逐个按规范重命名。
   失败换下一个候选源重试（attempt+1），全失败回写 `error` + 原因。
8. 再次列目录复核：新集确实在位、文件名规范，才把 episodes 标 `stored` 并回写
   `POST /progress`（含新的 `next_check_at`，追更中默认 +6h，完结剧不再调度）。
9. 全程关键事件写 logs；遇夸克登录失效 → 回写订阅 `last_error=cookie_expired` 并通知用户
   重新登录 Driver 端，**不反复重试**。

## 9. 安全边界

- 控制面（Workers/D1）**不存**网盘账号密码、TG 账号信息；只存订阅、候选
  分享链接、进度、日志。分享链接本身按敏感数据对待，页面与 API 均需鉴权后才可见。
- 夸克 Cookie（v0.5，应用户要求）：只以 AES-GCM 密文存 D1，解密密钥 `COOKIE_ENC_SECRET`
  是独立的 Worker Secret（与 D1 分离保管）；网页端接口（含设置读取）永不返回明文或密文，
  只返回是否已配置、更新时间、长度与 Driver 回报的有效性；明文仅经 Driver Token 鉴权的
  `GET /api/driver/config` 出口。保存/清除/取用均写审计日志（只记事件与长度，不记内容）。
  **风险提示**：若 D1 数据与 `COOKIE_ENC_SECRET` 同时泄露，Cookie 即等同泄露；Cookie
  本身等同登录凭证，失效或怀疑泄露时应在夸克端退出登录/改密使其作废，并在设置页清除
  或更新。未配置 `COOKIE_ENC_SECRET` 时功能硬禁用，不存在明文保存路径。
- Driver Key 与网页端凭据分离存储、分离轮换；日志 detail 禁止写入任何 Key/Cookie/TMDB 明文。
- Driver API Key（v0.6）：D1 只存 SHA-256 哈希与展示 hint，即使 D1 泄露也无法反推 Key；
  一个 Driver 一个 Key，单个 Key 泄露时只需吊销它，不影响其他 Driver 与引导 Key；
  引导 Key（`DRIVER_TOKEN` Secret）与 D1 分离保管，是 UI Key 体系失效时的兜底通道。
  config 接口下发的 TMDB Key 与夸克 Cookie 只经通过鉴权的 Driver 通道出站（no-store），
  网页端设置接口对 TMDB Key 仍只给掩码、对 Cookie 仍只给状态元数据。
- 转存是夸克服务端内的操作，文件数据不经过 Workers，也不经过 Driver 的下载/上传中转。
- 执行频率克制：默认检查间隔 ≥ 6 小时、认领后串行处理，避免高频调用触发平台风控；
  频率是 settings 可调项，但有下限保护（TODO）。
- 本项目仅供个人学习与自用管理自己网盘内的内容；使用者自行遵守平台条款与当地法律。
  仓库不内置任何频道清单之外的资源内容，频道清单为公开项目的配置数据。

## 10. 非目标（v1 不做）

- 不在 Workers 内做搜索抓取或转存（Workers 无浏览器登录态、且出口 IP 不适合调夸克）。
- 不做多用户/公开注册；单用户自用，靠 Access/密码挡在门外。
- 不做 PT、下载器、本地媒体库（那是 MoviePilot 的领域）。

## 11. 待定问题与已定决定

已定（2026-11-25 用户拍板，均已实现并本地验证）：

1. ~~部署域名 + 网页端鉴权~~ **已定**：部署到自有域名（GitHub 仓库：
   `github.com/ttainet/panpilot`）；网页端用**简单的账号密码登录**
   （`APP_USERNAME` / `APP_PASSWORD` Secrets + HMAC 签名会话 Cookie），不用 Cloudflare Access。
2. ~~Driver v1 唤醒频率~~ **已定**：**每 6 小时一轮**（`CHECK_INTERVAL_HOURS=6`；
   订阅新建时立即到期，Driver 回写 `partial_stored` 时自动排定下一轮
   `next_check_at`，pending 只返回到期且未集齐、未被租约占用的订阅）。
   通知渠道仍待定。
   **v1.2 改为统一批次制**（用户拍板）：批次点为北京时间每天
   00:00 / 06:00 / 12:00 / 18:00，处理完成后的 `next_check_at` 对齐到
   不早于「处理时刻 + `CHECK_INTERVAL_HOURS`」的第一个批次点（实际间隔
   6–12 小时），全部排期统一走服务端 helper `nextBatchCheckAt()`；
   新建订阅仍立即到期、首次处理后进入批次节奏，已终结订阅不参与。
   **v1.3 每订阅可单独设置检查间隔**（用户拍板）：订阅字段
   `check_interval_hours`（NULL = 跟随全局），在订阅卡片/详情/新建时
   可选 1/2/3/6/12/24 小时；带单独间隔的订阅处理后按「处理时刻 +
   间隔」顺延、不对齐批次点，改间隔即时重排；卡片另有「立即刷新」
   按钮把 `next_check_at` 重置为现在，保证 Driver 下次唤醒必处理。
   **v1.4 全局最小间隔改为设置页可改**（用户拍板）：存 D1 settings
   键 `check_interval_hours`，设置页「订阅设置」页签内编辑（v1.4.1 起
   从 Driver 页签移入），
   优先于 Worker 环境变量 `CHECK_INTERVAL_HOURS`（退为默认值）；
   只影响之后的新排期，已排定的 `next_check_at` 不动。
   **v1.5 废除批次对齐**（用户拍板）：v1.2 的批次制让间隔名不副实
   （设 2h 实际等 6h+），且 Driver 唤醒已足够频繁、批次失去意义。
   全部订阅统一为精确间隔：`next_check_at` = 处理时刻 + 生效间隔
   （单独间隔优先，否则全局），服务端 helper 收敛为 `nextCheckAtFor()`。
3. ~~TMDB API Key 提供方式~~ **已定**：参考 MoviePilot 机制 —— TMDB API Key 在
   **PanPilot 设置页配置并保存**（存 settings 表，页面只显示末 4 位掩码，可更新/清除）；
   订阅流程为先 TMDB 搜索选剧、点选后回填元数据，**订阅绑定 TMDB ID 而非只存名字，后续按季订阅**；
   地区分类按 TMDB `origin_country` 映射（v0.7 起改经 `directories` 映射表
   解析，默认值见已定项 8；本项原记的「HK/TW→港台剧、JP→日剧、KR→韩剧」已被其取代）。
   Key 未配置时选剧功能给出明确提示，手动填写订阅仍可用。

已定（2026-11-25 用户追加拍板，v0.5 已实现并本地验证）：

4. ~~控制面不存 Cookie~~ **已推翻**：设置页可配置夸克 Cookie（AES-GCM 加密存储、
   仅 Driver 可取明文，设计与风险提示见 §9），Driver 拿到 Cookie 直接调夸克接口转存，
   不再强依赖浏览器登录态。同时 TG 频道列表可在设置页配置，默认预填已验证的
   147 个有效频道（其中 76 个夸克优先，见 §4.6）。

已定（2026-11-25 用户追加拍板，v0.6 已实现并本地验证）：

7. ~~Driver 凭据各自保管~~ **已定**：Driver 需要的一切凭据（夸克 Cookie、TMDB API Key、
   频道清单）都经 PanPilot 的 `GET /api/driver/config` 下发，Driver 自身只持有
   PanPilot 的 API Key。API Key 后台可管理：每个 Driver 可命名创建自己的 Key，
   可重置、可吊销，DB 只存 SHA-256 哈希、明文只出现一次；`DRIVER_TOKEN` Secret
   保留为系统引导 Key（见 §4.7、§7）。无有效 Key 时 Driver 接口一律 401。

已定（2026-11-25 用户追加拍板，v0.7 已实现并本地验证）：

8. **入库目录以设置为准 + AI Driver 文档**：目录规范做成 settings 键
   `directories`（默认值参考实际在用的夸克影视库结构：日韩合并、国漫/纪录片/综艺在
   电视剧下、电影三分类），设置页可改、Driver config 下发生效值、TMDB
   分类映射与之对齐；同时为「未来的 AI Driver」提供操作手册三处落点
   （`docs/AI_DRIVER_GUIDE.md` / 根 `AGENTS.md` / `GET /api/driver/agent-guide`），
   内容含标准十步流程、夸克接口族、异常分支与安全红线（见 §3、§4.6、§6）。

仍待定：

5. 一期是否只支持夸克一种网盘（建议是）。
6. Driver 通知渠道（TG Bot / 邮件 / 其他）。
