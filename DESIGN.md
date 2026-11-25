# PanPilot 设计稿 v0.4（已部署上线）

> 状态：v0.4 已于 **2026-11-25 经 Cloudflare API 部署到 https://panpilot.ttai.net** 并完成
> 线上验证（health 为 store=d1、登录与 Driver Token 鉴权正常）。本文档描述目标架构与接口契约。
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
                               │ Driver API（独立 Bearer Token, HTTPS）
              ┌────────────────┴─────────────────┐
              ▼                                  ▼
     Driver v1: Muse                    Driver v2: 自写程序
     （定时唤醒、浏览器登录态              （家庭设备、夸克接口、
       执行搜索与转存）                      Cookie 只存本机）
              │                                  │
              ├─► PanSou / t.me/s 频道搜索（147 有效频道，76 夸克优先）
              └─► 夸克网盘（列目录 / 选集转存 / 重命名 / 复核）
```

**铁律：控制面不存任何网盘 Cookie / 密码 / 登录态。** Cookie 只存在 Driver 所在设备上。

## 3. 用户目录规范（Driver 入库必须遵守）

```
电影电视剧 / {电视剧|电影|综艺} / {地区分类，如 国产剧|港台剧|日剧|韩剧|欧美剧}
  / {剧名} ({年份}) / Season {N}
  / {剧名} - S{xx}E{yy} - 第 {y} 集.mkv
```

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

频道清单（147 有效 / 76 夸克优先）作为 settings 的初始种子数据导入，不写死在代码里。
`tmdb_api_key` 由设置页写入（见 §11 已定项 3），读取时只返回末 4 位掩码，完整 Key 不出服务端。
`auth_username` / `auth_password` 为网页登录凭据的**后台覆盖值**（见 §7）：`auth_password`
存 PBKDF2-SHA256 哈希对象 `{salt, iterations, hash}`（随机盐，100k 次迭代），绝不存明文。

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

网页端 API（非 Driver）：

| 方法 & 路径 | 用途 |
|---|---|
| `GET /api/health` | 健康检查（不鉴权，只返回 `{ok, version, store}`，store 如实标注当前存储实现） |
| `GET /api/subscriptions` / `POST /api/subscriptions` | 订阅列表 / 新建 |
| `GET /api/subscriptions/:id` / `PATCH /api/subscriptions/:id` / `DELETE /api/subscriptions/:id` | 详情 / 改（状态、模式、画质、暂停等）/ 删除 |
| `POST /api/subscriptions/:id/confirm-candidate` | manual 模式下人工确认候选（后续阶段，骨架中为签名占位） |

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
- **Driver**：独立 **Bearer Token**（`DRIVER_TOKEN` 存为 Worker Secret），与网页端凭据分离、
  可单独轮换。请求头：`Authorization: Bearer <token>`。Token 只授予 §6 的 driver 路径，
  不能调用网页端写接口。比较时用常量时间比较（基于 SHA-256 摘要），避免时序侧信道。
- 所有密钥只通过 `wrangler secret put` 注入，**不进 git、不进 wrangler.toml**。

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

- 控制面（Workers/D1）**不存**夸克 Cookie、账号密码、TG 账号信息；只存订阅、候选
  分享链接、进度、日志。分享链接本身按敏感数据对待，页面与 API 均需鉴权后才可见。
- Driver Token 与网页端凭据分离存储、分离轮换；日志 detail 禁止写入 Token/Cookie。
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

1. ~~部署域名 + 网页端鉴权~~ **已定**：域名 `panpilot.ttai.net`（GitHub 仓库：
   `github.com/ttainet/panpilot`）；网页端用**简单的账号密码登录**
   （`APP_USERNAME` / `APP_PASSWORD` Secrets + HMAC 签名会话 Cookie），不用 Cloudflare Access。
2. ~~Driver v1 唤醒频率~~ **已定**：**每 6 小时一轮**（`CHECK_INTERVAL_HOURS=6`；
   订阅新建时立即到期，Driver 回写 `partial_stored` 时自动排定 `next_check_at = +6h`，
   pending 只返回到期且未集齐、未被租约占用的订阅）。通知渠道仍待定。
3. ~~TMDB API Key 提供方式~~ **已定**：参考 MoviePilot 机制 —— TMDB API Key 在
   **PanPilot 设置页配置并保存**（存 settings 表，页面只显示末 4 位掩码，可更新/清除）；
   订阅流程为先 TMDB 搜索选剧、点选后回填元数据，**订阅绑定 TMDB ID 而非只存名字，后续按季订阅**；
   地区分类按 TMDB `origin_country` 映射（CN→国产剧、HK/TW→港台剧、JP→日剧、KR→韩剧、其他→欧美剧，电影同理）。
   Key 未配置时选剧功能给出明确提示，手动填写订阅仍可用。

仍待定：

4. 一期是否只支持夸克一种网盘（建议是）。
5. Driver 通知渠道（TG Bot / 邮件 / 其他）。
