# PanPilot AI Driver 操作手册

> 本文档写给**未来的 AI Driver**（以及编写程序化 Driver 的人）。读完它，你就能
> 独立驱动 PanPilot 完成一轮「拉订阅 → 搜索 → 盘点 → 选集转存 → 入库回写」。
>
> 同步关系：本文是源头。仓库根 `AGENTS.md` 是它的精简版；站内接口
> `GET /api/driver/agent-guide` 返回的就是本文全文（由 `src/guide.ts` 在构建时
> 从本文生成，见 `scripts/gen-guide.mjs`）。三处内容不一致时，以本文为准，
> 并请同步修正另外两处。

---

## 0. 你是谁、在做什么

PanPilot 是一个影视订阅**控制面**（Cloudflare Workers + D1）。用户只在网页上
订阅电视剧/电影/综艺；**搜索与转存不在控制面执行，由你（Driver）在外部执行**：

```
拉到期订阅 → 认领 → 分析订阅(TMDB) → 取执行配置(Cookie/频道/目录设置)
→ 盘点用户夸克实际目录 → 搜索 TG 频道找夸克分享 → 候选评分、只挑缺集
→ 用 Cookie 调夸克接口选集转存到目标文件夹 → 按模板重命名 → 复核 → 回写进度
```

- 控制面地址（下称 `BASE`）：`https://panpilot.ttai.net`（自部署时换成你的实例域名）。
- 你与控制面之间只有 §2 的 Driver API。不要试图绕过 API 直接改数据。
- **夸克实际目录是进度的唯一真相**；控制面里的 episodes 记录只是缓存，
  与实际目录冲突时以实际目录为准，并通过 progress 回写修正。

## 1. 鉴权：先有 API Key，才有一切

- 每个请求带请求头：`Authorization: Bearer <你的 API Key>`。
- Key 形如 `ppk_` + 64 位 hex，由用户在 PanPilot 设置页为你创建（一个 Driver
  一把 Key，可被重置/吊销）；也有部署时设置的「系统引导 Key」（`DRIVER_TOKEN`
  Secret）。**没有有效 Key 时，所有 `/api/driver/*` 接口一律返回 401，
  订阅、Cookie、TMDB Key、频道清单都拿不到。**
- Key 只保存在你自己的运行配置里。**禁止**把 Key（以及下面取到的夸克
  Cookie、TMDB Key）写进日志、progress 的 note、candidates 的任何字段、
  聊天汇报、代码仓库或截图。汇报时只许说「已配置 / 长度 / hint」。
- 给自己选一个稳定的 `driver_id`（如 `claude-main`、`home-nas-01`），
  claim / heartbeat / logs 全程用同一个，便于用户排查。

## 2. 接口清单（Driver API）

| 方法 & 路径 | 用途 |
|---|---|
| `GET /api/driver/pending?limit=20` | 拉到期、未集齐、未被租约占用的订阅；每条附 `stored_episodes` / `missing_episodes` |
| `POST /api/driver/claim` | 认领订阅：`{subscription_id, driver_id, lease_seconds?}` → `{task_id, lease_expires_at, attempt}`；被占用返回 **409** |
| `POST /api/driver/candidates` | 回报候选源：`{task_id, candidates:[{share_url, share_code, channel, post_url, title_raw, episodes_covered, quality_label, total_size, score, anomaly_note}]}` |
| `POST /api/driver/progress` | 回写进度：`{task_id, episodes:[{season, episode, status, source_share_code?, source_channel?, quark_fid?, file_name?, file_size?}], subscription_status?, next_check_at?, note?}` |
| `POST /api/driver/heartbeat` | 续租 + 存活上报：`{task_id, driver_id, lease_seconds?, driver_status?}` → `{lease_expires_at}` |
| `POST /api/driver/logs` | 批量上报日志：`{task_id?, logs:[{level, event, detail?}]}`（detail 禁写任何密钥） |
| `GET /api/driver/config` | **一次取齐本轮执行配置**（见 §3），响应 `Cache-Control: no-store` |
| `POST /api/driver/quark-status` | 回报夸克 Cookie 有效性：`{status: "ok" \| "invalid", note?, driver_id?}` |
| `GET /api/driver/agent-guide` | 本手册全文（text/markdown，no-store） |

订阅对象关键字段：`id, title, original_title, year, tmdb_id, media_type
(tv|movie|variety), region, season, total_episodes, quality_pref, mode
(manual|auto), status, target_dir, next_check_at`。

## 3. 执行配置：`GET /api/driver/config` 一次取齐

```jsonc
{
  "quark_cookie": "…",          // 夸克 Cookie 明文；未配置时为 null
  "tmdb_api_key": "…",          // TMDB Key；未配置时为 null
  "tg_channels": ["…"],         // 本轮生效的 TG 频道清单（用户设置或默认 147）
  "tg_channels_priority_only": false,
  "tg_channels_priority_fallback": false,
  "check_interval_hours": 6,
  "directories": { … }          // 入库目录设置，见 §5
}
```

- 每轮**只调一次** config，把 Cookie / TMDB Key / 频道 / 目录设置都拿到手，
  不要在每个订阅上重复拉。
- `quark_cookie` 为 null：本轮跳过一切转存动作（仍可搜索并回报 candidates），
  并在汇报中提醒用户去设置页粘贴 Cookie。
- `tmdb_api_key` 为 null：用订阅自带字段（title/year/season/total_episodes）
  工作，不要因此中断整轮。
- Cookie 只许放在内存里用；不要落盘明文缓存。非要缓存，用你运行环境的
  密钥存储并限制权限。

## 4. 标准一轮（十步）

### 步骤 1 拉订阅

`GET /api/driver/pending?limit=20`。返回的是到期（`next_check_at` 已到）、
未集齐/未完结/未暂停、且没有被其他 Driver 租约占用的订阅。

### 步骤 2 认领（claim）

逐条 `POST /api/driver/claim {subscription_id, driver_id, lease_seconds: 1800}`。

- 返回 201：拿到 `task_id`，在租约内处理它。
- 返回 **409 claim_conflict**：别的 Driver 正在处理，**跳过，不要重试抢**。
- 处理时间可能较长时，用 heartbeat 续租（步骤 10）。

### 步骤 3 分析订阅（TMDB 视角）

从订阅字段读出：剧名 `title`、原名/别名 `original_title`、年份 `year`、
`tmdb_id`、目标季 `season`、总集数 `total_episodes`、已入库集号
`stored_episodes` 与缺集 `missing_episodes`（pending 已附带）。

- `total_episodes` 未知时，用 config 给的 TMDB Key 查 TMDB 详情
  （`GET https://api.themoviedb.org/3/tv/{tmdb_id}?api_key=…&language=zh-CN`）
  取该季 `episode_count`，并在 progress 里回填。
- 搜索关键词组：`title`、`title + 年份`、`original_title`，电影同理。

### 步骤 4 取配置

`GET /api/driver/config`（见 §3）。这是本轮唯一一次取 Cookie 的动作。

### 步骤 5 盘点夸克实际目录（铁律：先盘点，后搜索）

用 Cookie 列用户夸克目录，确认这部剧**已经存了哪些集**，不要只信
pending 给的 `missing_episodes`——用户可能在夸克 App 里手动增删过。

**定位已有剧名夹的顺序**（`directories` 决定结构，见 §5）：

1. 若订阅带 `target_dir`，先看那里。
2. 否则按类型定大层：tv/variety → `{base_dir}/{tv_dir}`；movie →
   `{base_dir}/{movie_dir}`。
3. 在该大层下**逐层找已有的 `{剧名} ({年份})` 夹**（用 title_template 渲染）：
   先看大层直放，再看每个地区/分类夹内（电视剧层：国产剧、欧美剧、日韩剧、
   国漫、纪录片、综艺等现有子夹；电影层：华语电影、外语电影、动画电影）。
   **找到就复用，绝不另建同名夹**——用户的真实库里两种放法并存。
4. 电视剧再进 `Season {season}` 夹（season_template 渲染），解析已有文件名
   的集号（`S01E05`、`第 5 集` 等写法都要认），得到**实际已存集号集**。
5. 实际已存集号集与 pending 的 `stored_episodes` 不一致时，以实际为准，
   并在本轮 progress 里把差异集数按实际状态回写修正（多出来的标 stored、
   消失的标 missing）。

**真实缺集 = 1..total_episodes − 实际已存集号集**。缺集为空 → progress 回写
`subscription_status: "completed"`（TMDB 已完结则 `"ended"`），结束本条，
不要再去搜索。

### 步骤 6 搜索频道找分享

只用 config 下发的 `tg_channels` 清单，不要自己另找野频道。两种搜法：

- **PanSou**（有可用实例时优先）：`GET <PanSou地址>/api/search?kw=<剧名>`
  等参数，限定网盘类型为 quark，合并多关键词结果。PanSou 实例地址是你
  运行环境的配置，不在 PanPilot 里。
- **逐频道直查**：`GET https://t.me/s/<频道>?q=<剧名>` 解析公开帖子里的
  `pan.quark.cn/s/<code>` 链接与帖子标题。串行、限速，不要并发轰炸。

收集候选：分享链接/码、来源频道、帖子链接、原始标题、标注的画质与大小。

### 步骤 7 候选评分与异常检查

对每个候选先打开分享（用 §6 的 share 接口列文件），再打分：

- **集号解析**：从文件名解析季/集（`S01E05`、`EP05`、`第5集`、`05.` 等），
  得到覆盖集号集。**只关心覆盖真实缺集的候选**；一集都不覆盖的直接淘汰。
- **大小异常**：单集大小与同分享内相邻集差一个数量级（如别人 800MB 它
  58MB），或小到不合常理 → 该集**跳过**并在候选的 `anomaly_note` 注明
  （如 `E05 仅 58MB`），不要把异常文件入库。
- **多版本整包**：一个分享里有多个画质子夹（如 4K / 4K DV / 4K HDR /
  4K SDR 各一份全集）时，**只选一个子夹**——优先与已入库文件规格
  （分辨率/编码/HDR 形式）一致的那版，其次按订阅 `quality_pref`。
  绝不整包转存（可能几百 GB）。
- **同集多源**：规格与已入库一致优先；其次总分（覆盖缺集数、大小合理性、
  画质、来源频道可信度）。
- 把候选（含评分与异常说明）`POST /api/driver/candidates` 回报。
- **manual 模式**：回报后订阅会转 `awaiting_confirm`，**停在这里等用户
  在网页确认，不要擅自转存**。auto 模式：选最高分候选继续步骤 8。

### 步骤 8 选集转存到目标 Season 夹

目标文件夹 fid 的确定：步骤 5 已定位/复用的剧名夹 → 其下 Season 夹；
不存在时按 §5 用夸克的建夹接口逐层新建（先地区/分类夹，再剧名夹，
再 Season 夹；电影没有 Season 层，文件直接进剧名夹）。

转存只勾选**真实缺集对应文件的 fid**（分享 detail 里每个文件有独立 fid），
不要整夹转。转存是夸克服务端内的操作，文件数据不经过你下载/上传中转。
接口顺序见 §6：`share/token` 拿 stoken → `share/detail` 列文件并挑 fid →
`share/save` 保存到目标 fid → 轮询 `task` 到完成。

### 步骤 9 重命名 + 复核 + 回写

1. 转存完成后，按 `directories.episode_name_template` 逐个重命名：
   `{title} - S{season:02}E{episode:02} - 第 {episode} 集` + **保留原扩展名**
   （如 `.mkv`）。电影按 title_template 命名文件或直接保留剧名夹内原名
   （以模板为准：电影文件名用剧名+年份即可）。
2. **再列一次目标文件夹复核**：新集确实在位、文件名规范、大小与源一致。
   复核不过不要标 stored，如实标 failed 并写 note。
3. `POST /api/driver/progress` 逐集回写：
   `{season, episode, status: "stored", source_share_code, source_channel,
   quark_fid, file_name, file_size}`。
4. 订阅状态：仍有缺集 → `subscription_status: "partial_stored"`（服务端会
   自动排下一轮 `next_check_at = +check_interval_hours`）；全部集齐 →
   `"completed"`，且 TMDB 状态为已完结（Ended/Canceled）时用 `"ended"`。
   带终态的 progress 会自动关闭本条 task。

### 步骤 10 心跳与收尾

- 单条处理超过几分钟时，周期性 `POST /api/driver/heartbeat` 续租，
  可顺带上报 `driver_status`。
- 整轮结束时用 `POST /api/driver/logs` 汇总关键事件（搜到几个候选、
  转了哪几集、跳过哪些异常），detail 里**只写事件与数字，不写任何密钥**。
- 向用户汇报本轮结果：每条订阅做了什么、转了哪几集、还缺什么、异常在哪。

## 5. 入库目录设置（directories）

`config.directories` 是用户在设置页维护的目录规范，**分类以它为准**，
不要再用你记忆里的硬编码映射。默认值与用户真实夸克结构一致：

```jsonc
{
  "base_dir": "电影电视剧",
  "tv_dir": "电视剧",
  "movie_dir": "电影",
  // TMDB origin_country -> 电视剧地区夹。注意 JP 与 KR 合并为「日韩剧」
  "tv_region_map":    { "CN": "国产剧", "HK": "国产剧", "TW": "国产剧", "JP": "日韩剧", "KR": "日韩剧", "*": "欧美剧" },
  // 电视剧下的特殊分类夹（都在 tv_dir 下，不是独立大层）
  "tv_special_map":   { "animation_cn": "国漫", "documentary": "纪录片", "variety": "综艺" },
  // 电影分类夹："animation" 是动画电影，其余键为 origin_country
  "movie_category_map": { "CN": "华语电影", "HK": "华语电影", "TW": "华语电影", "animation": "动画电影", "*": "外语电影" },
  "title_template":   "{title} ({year})",
  "season_template":  "Season {season}",
  "episode_name_template": "{title} - S{season:02}E{episode:02} - 第 {episode} 集"
}
```

新建文件夹时的分类判定（仅在步骤 5 没找到已有剧名夹时才用）：

- 电视剧：先看特殊类——国产动画（原产地 CN/HK/TW + 动画类型）→
  `animation_cn`；纪录片类型 → `documentary`；综艺（订阅 media_type 为
  variety，或真人秀/脱口秀类型）→ `variety`；其余按 `tv_region_map`
  查 origin_country，无键时用 `"*"`。
- 电影：动画类型 → `movie_category_map.animation`；其余按 origin_country
  查 `movie_category_map`，无键时用 `"*"`。
- 完整路径：电视剧 `{base_dir}/{tv_dir}/{分类}/{剧名 (年份)}/Season {N}/`；
  电影 `{base_dir}/{movie_dir}/{分类}/{剧名 (年份)}/`（无 Season 层）。
- 模板占位符：`{title}` `{year}` `{season}` `{episode}`，带 `:02` 的是
  两位零填充（如 `{episode:02}` → `05`）。

## 6. 夸克接口族（与 quark-auto-save 同款）

全部请求带请求头 `Cookie: <config 下发的 quark_cookie>`，并带常规
`User-Agent` 与 `Referer: https://pan.quark.cn/`。主机
`https://drive-pc.quark.cn`，多数接口带查询参数 `pr=ucpro&fr=pc`
（以实际抓包/开源实现为准，这里只给用途与顺序，不给完整代码）：

| 接口 | 用途 | 在流程中的位置 |
|---|---|---|
| `POST /1/clouddrive/share/sharepage/token` | 用分享码（pwd_id）+提取码换 `stoken` | 打开任何分享前 |
| `POST /1/clouddrive/share/sharepage/detail` | 列分享内文件（fid、文件名、大小、子目录），可按 pdir_fid 逐层下钻 | 步骤 5/7 盘点与挑版本、步骤 8 挑 fid |
| `GET /1/clouddrive/file/sort` | 列**自己网盘**某文件夹（pdir_fid）的文件 | 步骤 5 盘点、步骤 9 复核 |
| `POST /1/clouddrive/file` | 在自己网盘建文件夹（pdir_fid + file_name） | 目标分类/剧名/Season 夹不存在时逐层建 |
| `POST /1/clouddrive/share/sharepage/save` | 把分享内选定 fid 列表转存到自己网盘的目标 fid | 步骤 8；返回 task_id |
| `GET /1/clouddrive/task` | 轮询转存任务状态（task_id + retry_index） | save 后轮询到完成/失败 |
| `POST /1/clouddrive/file/rename` | 按 fid 重命名自己网盘的文件 | 步骤 9 按模板改名 |

根目录 fid 为 `0`。列目录要分页拉全（`_page`/`_size`），不要只看第一页。

## 7. 异常分支（照此处理，不要自由发挥）

- **Cookie 失效**：任何夸克接口返回未登录/鉴权类错误（如 401/403 或
  响应中明确的登录失效错误码）→ 立刻 `POST /api/driver/quark-status
  {status: "invalid", driver_id}` 回报一次，**停止本轮全部转存工作**
  （已认领的任务用 progress 回写 `subscription_status: "error"` +
  note 说明 cookie_expired），并在汇报中提醒用户去设置页重新粘贴 Cookie。
  **不要反复重试**——连续用失效 Cookie 打接口只会加重风控。
  反之，本轮第一次成功调用夸克接口后，回报一次 `{status: "ok"}`。
- **Cookie 未配置**（config 里为 null）：不是错误。跳过盘点与转存，
  只做搜索与 candidates 回报，并提醒用户粘贴 Cookie。
- **分享失效**（token/detail 返回分享已删除/取消）：把该候选记为 dead
  （`POST /api/driver/logs` 写 `candidate_dead` 事件），换下一个候选；
  同一分享不要重复尝试超过一次。全候选皆失效 → progress 回写
  `error` + note，订阅会按 next_check_at 下轮再来。
- **租约过期**：heartbeat 返回 404（任务不存在）或发现租约已过期 →
  本条订阅立即停手，回到步骤 1 重新 pending + claim；若重新 claim
  返回 409，说明别人接手了，**彻底放弃本条**，不要并行处理同一订阅。
- **找不到任何候选**：candidates 回报空数组（或不回报），progress 回写
  `partial_stored`（保持追更）或保持原状态 + note `no_source_yet`，
  等下一轮，不要编造链接。
- **TMDB 查不到/季集数对不上**：以 TMDB 当前数据为准并在 note 里写明
  差异；不要猜总集数。
- **空间不足/转存任务失败**：如实回写 failed + 夸克返回的错误摘要
  （不含 Cookie），停止本条，不要循环重试。

## 8. 安全红线（违反任何一条都是事故）

1. API Key、夸克 Cookie、TMDB Key：不进日志、不进 progress note、不进
   candidates 字段、不进汇报、不进 git、不进截图。只许在内存与你自己的
   受控配置里存在。
2. 只在 `directories.base_dir` 这棵库目录树内建夹与转存；**不删除、
   不移动用户已有的任何文件**。盘点发现重复集时跳过，不要替用户删。
3. manual 模式订阅：用户在网页确认前**绝不转存**。
4. 频率克制：订阅串行处理；搜索对同一频道限速；两轮之间至少间隔
   `check_interval_hours`（由控制面的 next_check_at 控制，你只处理
   pending 返回的，不要自己提前捞未到期的订阅）。
5. 只转存用户订阅里缺失的集；不整包转多版本合集；异常大小的文件不入库。
6. 本系统仅用于用户管理自己网盘内的内容；遵守夸克与 Telegram 的平台
   条款，遇到验证码/风控挑战立即停手并通知用户，不要尝试绕过。

## 9. 一轮的时序速览

```
GET  /api/driver/pending
POST /api/driver/claim            → task_id（409 则跳过本条）
GET  /api/driver/config           → cookie / tmdb key / 频道 / directories
[夸克] file/sort 逐层盘点          → 实际已存集号、目标夹 fid（没有则 file 建夹）
[搜索] PanSou 或 t.me/s 逐频道     → 候选分享
[夸克] share/token + share/detail → 候选覆盖集/大小/版本子夹
POST /api/driver/candidates       → 回报候选（manual 模式到此为止）
[夸克] share/save（只选缺集 fid）→ task 轮询完成
[夸克] file/rename 按模板改名
[夸克] file/sort 复核
POST /api/driver/progress         → 逐集 stored + 订阅状态（自动关 task）
POST /api/driver/quark-status     → ok（或在失效时第一时间 invalid 并停轮）
POST /api/driver/logs             → 本轮汇总
（全程长任务穿插 POST /api/driver/heartbeat 续租）
```
