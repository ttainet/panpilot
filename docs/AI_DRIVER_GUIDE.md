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

- 控制面地址（下称 `BASE`）：`https://your-panpilot.example.com`（占位示例，换成你被授权访问的实例域名）。
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

### 调用约定：User-Agent 与重试（所有 Driver API 请求都适用）

- **必须带浏览器 User-Agent**：实例部署在 Cloudflare 之后，脚本/库的
  默认 UA（如 `python-requests`、裸 `curl` 的 UA）会被 Cloudflare 边缘
  以 **1010** 错误直接拦截——这与 Key 是否有效**无关**，Key 再对也会被
  拦。所有 `/api/driver/*` 请求固定带一个常见浏览器 User-Agent
  （如当前主流 Chrome 的 UA 字符串），整轮不要换来换去。
  收到 1010 时先检查 UA，不要去怀疑 Key；401 才是鉴权问题。
- **瞬时断连要退避重试**：PanPilot API 偶发连接被中途断开
  （`RemoteDisconnected`、连接重置、超时等），属瞬时故障，实测一轮
  里出现数次并不罕见。任何 Driver API 请求失败时，**先退避重试
  2–3 次（间隔约 2 秒、5 秒递增）再判定失败**；不要一失败就放弃
  正在处理的订阅、更不要把瞬时断连误报成订阅错误或 Cookie 失效。
  重试时保持请求内容不变（claim 的重试注意：若上一次 claim 其实
  已在服务端成功、只是响应丢了，重试会返回 409 或同一任务，
  按返回结果处理，不要重复转存）。

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
(manual|auto), status, target_dir, next_check_at`。另外 pending 的每条
订阅还附带两个画质字段（v1.0）：`quality` 是该订阅的清晰度覆盖
（`2160p|1080p|720p`，为 null 表示跟随全局），`quality_profile` 是
**已合并好的生效画质档案**（全局档案 + 该订阅覆盖），步骤 7 选源时
直接用它，不要自己再合并。

## 3. 执行配置：`GET /api/driver/config` 一次取齐

```jsonc
{
  "quark_cookie": "…",          // 夸克 Cookie 明文；未配置时为 null
  "tmdb_api_key": "…",          // TMDB Key；未配置时为 null
  "tg_channels": ["…"],         // 本轮生效的 TG 频道清单（用户设置或默认 147）
  "tg_channels_priority_only": false,
  "tg_channels_priority_fallback": false,
  "check_interval_hours": 6,
  "directories": { … },         // 入库目录设置，见 §5
  "quality": { … }              // 全局画质偏好档案，见步骤 7（pending 每条订阅另附合并后的 quality_profile，以那个为准）
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
- **未播出的集不算本轮缺集**：TMDB 的 `total_episodes` 包含尚未播出的
  集。分析时查该季每集的 `air_date`，**播出日期在未来的集不属于本轮
  目标**——不去找源、不记找源失败、不写 error，只在本轮 progress 的
  note 里注明（如 `未播出 15 集（2026-11-28 起）`）。**本轮目标 =
  已播出 − 实际已存**；下轮到期时它们自然会进入目标。
- **当天播出的集记为「待源」**：集已播出、但播出时间在 **48 小时
  以内**，且全网候选均未更新到该集的，属于资源未跟上而非找源
  失败——记为「待源」：**不写 error、不给已验证可用的候选降
  评级**，progress note 注明（如 `E13 播出未满 48h、待源`），
  下轮正常重试；**超过 48 小时仍无源**才按常规缺源处理，并在
  汇报中点名。
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

**真实缺集 = 已播出集号集（步骤 3 按 air_date 过滤）− 实际已存集号集**。缺集为空 → progress 回写
`subscription_status: "completed"`；**先查 TMDB 状态，已 Ended/Canceled
则改用 `"ended"`**（判定口径见步骤 9 第 4 点），结束本条，不要再去搜索。

### 步骤 6 搜索频道找分享

只用 config 下发的 `tg_channels` 清单，不要自己另找野频道。两种搜法：

- **PanSou**（有可用实例时优先）：`GET <PanSou地址>/api/search?kw=<剧名>`
  等参数，限定网盘类型为 quark，合并多关键词结果。PanSou 实例地址是你
  运行环境的配置，不在 PanPilot 里。
- **逐频道直查**：`GET https://t.me/s/<频道>?q=<剧名>` 解析公开帖子里的
  `pan.quark.cn/s/<code>` 链接与帖子标题。串行、限速，不要并发轰炸。

收集候选：分享链接/码、来源频道、帖子链接、原始标题、标注的画质与大小。

- **失效分享不重复踩**：动手打开任何候选之前，先看这条订阅已有的
  candidates / logs 历史——**已标记失效（`candidate_dead`）的分享码
  直接跳过，不要再打开验证**（死链不会因为换一轮就复活，白开只浪费
  时间还增加风控）。本轮新发现的失效分享按 §7 当轮记 `candidate_dead`
  日志，下一轮即可凭记录跳过。

### 步骤 7 候选筛选与评分（两段式：先硬过滤，后打分）

选源规则的数据来源：pending 每条订阅附带的 **`quality_profile`**
（已合并订阅覆盖的生效档案；config 的 `quality` 是全局档案，仅作
参考，以 `quality_profile` 为准）。档案字段：

```jsonc
{
  "preferred_resolution": "1080p",  // 首选清晰度：2160p | 1080p | 720p | any
  "allow_fallback": true,           // 找不到首选清晰度时是否允许降级
  "exclude_remux": true,            // 排除蓝光原盘 / REMUX
  "exclude_cam": true,              // 排除枪版 CAM / TS / TC
  "prefer_h265": true,              // 同清晰度优先 H.265 / HEVC
  "max_episode_gb": 0,              // 单集大小上限（GB），0 = 不限
  "exclude_keywords": []            // 自定义排除关键词
}
```

对每个候选先打开分享（用 §6 的 share 接口列文件），然后：

#### 第一段：硬过滤（命中任一直接淘汰，不进入打分）

- **集号不覆盖**：解析文件名得到覆盖集号集（`S01E05`、`EP05`、`第5集`、
  `05.` 等），一集都不覆盖真实缺集的淘汰。
- **蓝光原盘**（`exclude_remux` 为 true 时）：候选标题/文件名含
  `REMUX`、`蓝光原盘`、`BD-Remux`、`Blu-ray 原盘`、原盘 ISO 等原盘
  特征 → 淘汰。注意区分：`BluRay` 转压（非原盘）不在此列，它在
  打分段有自己的来源优先级。
- **枪版**（`exclude_cam` 为 true 时）：含 `CAM`、`TS`、`TC`、`HDTS`、
  `HDTC`、`枪版` 等特征 → 淘汰。
- **自定义关键词**：`exclude_keywords` 任一命中候选标题或文件名
  （不区分大小写）→ 淘汰。
- **大小超限**（`max_episode_gb` > 0 时）：单集文件大小超过上限
  （电影按整个文件计）→ 该文件淘汰；整份分享的对应集都超限时
  整个候选淘汰。
- **清晰度不符**（`allow_fallback` 为 false 且 `preferred_resolution`
  不是 `any` 时）：候选清晰度不等于首选 → 淘汰。宁可本轮不转，
  等下一轮更好的源。
- **大小异常**：单集大小与同分享内相邻集差一个数量级（如别人 800MB
  它 58MB），或小到不合常理 → 该集**跳过**并在候选的
  `anomaly_note` 注明（如 `E05 仅 58MB`），不要把异常文件入库。
  **异常只淘汰该文件/该集，不整源拉黑**——其余正常的集仍可从该源转；
  只有同一候选里多集异常时，才在打分段降低整源评级。

#### 第二段：打分排序（在通过硬过滤的候选里选最优）

- **已入库规格最优先**：本季已有入库文件时，与已入库规格（分辨率/
  编码/HDR 形式）一致的候选排第一——**档案让位于已入库规格**
  （同季不混版规则不变，见 §5.4）。档案只决定「还没有任何已入库
  集」时的选源方向。
- **清晰度**：与 `preferred_resolution` 一致最高分；`allow_fallback`
  为 true 时，升档（如首选 1080p、候选 2160p）次之，降级再次之
  且按差距递减（一档差如 2160p→1080p 高于两档差如 2160p→720p）。
- **编码**：`prefer_h265` 为 true 时，同清晰度下 H.265 / HEVC /
  x265 加权高于 H.264 / AVC / x264。
- **来源**：固定优先级 **WEB-DL > 蓝光转压（BluRay，非原盘）>
  HDTV**。
- **同分 tie-break**：体积更接近该清晰度常见单集大小的优先
  （明显偏大可能注水、明显偏小可能压过头；结合大小异常规则
  判断），其次来源频道可信度、覆盖缺集数。
- **单源整季优先**：能以**单一来源覆盖全部本轮目标集、且全季规格
  一致**的候选加权优先于「多源各覆盖一部分」的组合。先定主源，
  **多源拼凑只用来补主源的缺口集**，不要一开始就东拼西凑——拼凑
  容易混规格、混命名来源，复核也更难。
- **多版本整包**：一个分享里有多个画质子夹（如 4K / 4K DV / 4K HDR /
  4K SDR 各一份全集）时，**只选一个子夹**：按上面顺序选最优的那版
  （已入库规格 > 档案打分）。绝不整包转存（可能几百 GB）。

把候选（含评分与异常说明）`POST /api/driver/candidates` 回报。
**manual 模式**：回报后订阅会转 `awaiting_confirm`，**停在这里等用户
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

1. 转存完成后，按 §5.4 的命名规范逐个重命名（**保留原扩展名**，
   如 `.mkv`）：电视剧用 `directories.episode_name_template`、电影用
   `movie_name_template`、综艺用 `variety_name_template`；字幕文件
   跟随视频改同基础名（规则见 §5.4）。改名偶发被夸克以 **14014**
   拒绝时按 §7 的重试规则处理，不要改名字绕过。
2. **再列一次目标文件夹复核（定量标准）**：不只是「文件在」——逐集
   比对目标文件的**大小与源分享清单中该集的大小**，**逐字节一致**
   才算入库成功；同时核对在位集号齐全、文件名符合模板。大小不一致
   的集**不要标 stored**，标 failed 并在 progress 的 note 里**逐集
   点名**（如 `E07 大小不一致：源 812345678 / 目标 812000000`）。
3. `POST /api/driver/progress` 逐集回写：
   `{season, episode, status: "stored", source_share_code, source_channel,
   quark_fid, file_name, file_size}`。
4. 订阅状态：仍有缺集 → `subscription_status: "partial_stored"`（服务端会
   自动排下一轮 `next_check_at = +check_interval_hours`）；全部集齐 →
   `"completed"`；**回写前再用 TMDB Key 查一次该剧的 TMDB 状态**，
   若已 **Ended/Canceled 且本季集数已齐全**，用 `"ended"` 代替
   `"completed"`，让订阅进入终态关闭、不再被下一轮重复拉起。
   带终态的 progress 会自动关闭本条 task。

### 步骤 10 心跳与收尾

- 单条处理超过几分钟时，周期性 `POST /api/driver/heartbeat` 续租，
  可顺带上报 `driver_status`。
- 整轮结束时用 `POST /api/driver/logs` 汇总关键事件（搜到几个候选、
  转了哪几集、跳过哪些异常），detail 里**只写事件与数字，不写任何密钥**。
- 向用户汇报本轮结果：每条订阅做了什么、转了哪几集、还缺什么、异常在哪。

## 5. 目录与命名规范（照此执行，不要猜）

本章是入库的**唯一规范**：目标路径怎么定、季集怎么认、文件怎么命名，
全部按下文的决策顺序与模板执行。`config.directories` 给出本机的具体
取值（路径、映射、模板），本章给出取值的使用规则；两者冲突时以
`config.directories` 的取值为准、本章规则不变。

### 5.1 directories 设置对象

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
  "episode_name_template": "{title} - S{season:02}E{episode:02} - 第 {episode} 集",
  "movie_name_template":   "{title} ({year})",
  "variety_name_template": "{title} - S{season:02}E{episode:02} - 第 {episode} 期"
}
```

模板占位符：`{title}` `{year}` `{season}` `{episode}`，带 `:02` 的是
两位零填充（如 `{episode:02}` → `05`）。模板渲染出的都是**不带扩展名**
的基础名，扩展名一律保留源文件的扩展名（见 §5.4）。

### 5.2 目标路径决策顺序（自上而下，命中即停）

#### 第 1 步：先盘点——找已有剧名夹，找到就复用

在动手新建任何文件夹之前，先在下列范围内按**剧名**查找已有的同名夹：

- 电视剧/综艺：`{base_dir}/{tv_dir}` 本层直放的剧名夹 + 每个地区/分类夹
  （国产剧、欧美剧、日韩剧、国漫、纪录片、综艺等现有子夹）内的剧名夹；
- 电影：`{base_dir}/{movie_dir}` 本层直放的剧名夹 + 每个分类夹
  （华语电影、外语电影、动画电影）内的剧名夹，以及电影合集夹内部
  （见下文第 3 步的合集规则）。

查找时容忍下列命名变体，它们都算「同一个家」：

| 变体 | 例子（目标：谷雨 2026） |
|---|---|
| 标准形（半角括号 + 空格） | `谷雨 (2026)` |
| 全角括号 | `谷雨（2026）` |
| 无年份 | `谷雨` |
| 标题带季后缀 | `剑来 第一季 (2024)`（目标是《剑来》时命中） |

- **找到已有夹 → 复用它，绝不新建第二个家。** 哪怕它所在的位置与
  §5.2 第 3 步算出的分类不一致，也以已有位置为准——用户的真实库里
  两种放法并存，统一性让位于不重复。
- 多个候选都有内容时，优先级：**已含目标季的那个** > **已含集数更多的
  那个** > **在分类夹里的那个**（优于大层直放）。
- 把最终选用的完整路径写进本条订阅的 progress `note` 或 logs
  （如 `target_dir=电影电视剧/电视剧/国产剧/谷雨 (2026)/Season 1`），
  便于事后排查。

#### 第 2 步：找不到才新建——路径公式与分类夹来源

```
电视剧/综艺：{base_dir}/{tv_dir}/{分类夹}/{title} ({year})/Season {n}/
电影：      {base_dir}/{movie_dir}/{分类夹}/{title} ({year})/     （无 Season 层）
```

- `{title} ({year})` 与 `Season {n}` 分别由 `title_template`、
  `season_template` 渲染；渲染前先按 §5.4 的清洗规则处理标题。
- **分类夹只能来自 `config.directories` 的三组映射**（`tv_region_map`、
  `tv_special_map`、`movie_category_map`），**禁止凭记忆自创分类名**。
  例：把日本剧放进「日剧」、韩国剧放进「韩剧」是**错的**——映射里
  JP/KR 都指向同一个「日韩剧」。
- 新建时逐层建：分类夹 → 剧名夹 → Season 夹（电影到剧名夹为止），
  每层建前先确认不存在（并发/重跑时不要重复建）。

#### 第 3 步：分类判定优先级（仅新建时用，顺序命中即停）

电视剧/综艺：

1. TMDB genres 命中纪录片（Documentary）或订阅本身是综艺
   （media_type=variety，或 genres 命中真人秀/脱口秀）→
   `tv_special_map` 的 `documentary` / `variety`；
2. 中国动画（origin_country ∈ CN/HK/TW 且 genres 命中动画）→
   `tv_special_map` 的 `animation_cn`（国漫）；
3. 其余按 origin_country 查 `tv_region_map`，无对应键时用 `"*"`
   兜底（默认欧美剧）。

电影：

1. genres 命中动画 → `movie_category_map` 的 `animation`（动画电影）；
2. 其余按 origin_country 查 `movie_category_map`
   （CN/HK/TW → 华语电影，无键用 `"*"` → 外语电影）。

**电影合集夹例外**：若电影层或分类夹内已存在系列合集夹（如「指环王」
这类把同系列多部装在一起的夹），且该片属于该系列 → 复用合集夹，
文件直接放进合集夹，不再单独建剧名夹。此规则在第 1 步盘点时一并检查。

### 5.3 季与集规则

**季：**

- 季号一律取 TMDB 的季号（订阅的 `season` 字段就是 TMDB 季号）。
- 正片季从 Season 1 起；多季订阅每季各建一个 `Season {n}` 夹，
  只处理订阅指定的季，不要顺手处理其他季。
- **特别篇 / Season 0 默认不转**；只有订阅里明确注明要特别篇时才转，
  放 `Season 0` 夹，命名规则同正片。

**集号解析**（从源文件名提取集号，下列写法都要认）：

| 写法 | 例 | 解析 |
|---|---|---|
| `S01E02` / `S1E2` | `xxx.S01E04.2160p.mkv` | 季 1 集 4（季以此为准，与目标季不一致则不是本季文件） |
| `第02集` / `第2集` | `xxx 第04集.mkv` | 集 4 |
| `EP02` / `E02` | `xxx.EP04.mkv`、`xxx E04.mkv` | 集 4 |
| 纯数字 | `xxx.04.mkv`、`xxx - 04.mkv` | 集 4（仅当上下文无其他数字含义时） |

- **一份文件含多集**（如 `S01E01-E02`、`第01-02集`、双集打包）→
  标记异常、**不转**，在 candidates 的 `anomaly_note` 或 logs 里注明
  （如 `E01-E02 双集文件，未转`）。
- **解析不出集号** → 不转，回报（progress note / logs 写明文件名与
  原因），不要猜一个集号硬塞。
- **只转缺集**：以步骤 5 盘点出的**实际已有集号集**为准，
  目标 = 订阅季已播出集数范围 − 已有集号集（未播出的集不算目标，
  见步骤 3）。目标文件夹里已存在同名文件
  → 视为已入库，跳过（不要重复转、不要覆盖）。
- **综艺集号以 TMDB 结构为准，不以「第 X 期」字面为准**：做期号↔集号
  映射之前，先看 TMDB 该季的集数构成、每集标题与播出日期。TMDB 把
  每期的「上/下」分别算一集时（如 7 期 = 14 集），资源的上/下文件与
  TMDB 集号 **1:1 映射**；TMDB 按整期算一集、而资源把一期拆成上/下
  两段时，**不要硬套期号**（一段文件对不上 TMDB 的一集）。对应关系
  无法确定时按 §5.4「不确定就停」处理：跳过该文件并在回报中点名，
  不要猜。

### 5.4 命名规范

#### 电视剧

- 文件名模板 `episode_name_template`：
  `{title} - S{season:02}E{episode:02} - 第 {episode} 集` + 源扩展名。
  例：`谷雨 - S01E04 - 第 4 集.mkv`。
- `{title}` 用**媒体库标题**（订阅的 `title`，即 TMDB 中文名），
  **不用源文件里的标题变体**（源文件叫 `GUY`、`guyv` 之类都与命名无关）。
- 完整路径正例：
  `电影电视剧/电视剧/国产剧/谷雨 (2026)/Season 1/谷雨 - S01E04 - 第 4 集.mkv`
- 复用正例：《两京十五日》已有剧名夹在「国产剧」下、已存 E01–E03 与
  E05–E12 → 只把 E04 转进**原夹**的 `Season 1`，改名
  `两京十五日 - S01E04 - 第 4 集.mkv`，其余集一律不动。
- **反例（禁止）**：
  - 新建全角括号的「谷雨（2026）」夹，与已有的 `谷雨 (2026)` 并存；
  - 已有夹在国产剧下，又在电视剧层直放再建一个同名夹；
  - 把整包多版本文件夹（4K/4K DV/4K HDR/… 各一份全集）整个转进来；
  - 用源文件原名入库（如 `GUY.S01E04.2160p.WEB-DL.mkv`）而不改名。

#### 电影

- 文件名模板 `movie_name_template`：`{title} ({year})` + 源扩展名，
  例：`独行月球 (2022).mkv`。文件直接放在剧名夹内，**无 Season 层**。
- 例外：目标剧名夹（或合集夹）内已有文件用了别的命名风格时，
  **跟随已有风格**，不要在一夹之内混两种命名。

#### 综艺

- 文件名模板 `variety_name_template`：
  `{title} - S{season:02}E{episode:02} - 第 {episode} 期` + 源扩展名，
  期号即集号（解析规则同 §5.3）。
- 日期型节目（以日期命名、解析不出期号）→ **保留原名转存**，
  并在 progress note / logs 里注明 `variety_keep_original_name`。

#### 字幕

- 与视频同基础名的字幕文件（`.srt` / `.ass` / `.ssa`）**跟随视频一同
  转存**，并改成与视频相同的基础名；原字幕带语言后缀时保留语言段：
  视频改名为 `谷雨 - S01E04 - 第 4 集.mkv`，其字幕 `xxx.zh.srt` →
  `谷雨 - S01E04 - 第 4 集.zh.srt`、`.ass` 同理。
- 只有字幕没有对应视频文件时不单独转。

#### 不转的东西（转存勾选时一律排除）

- 预告片、花絮、OST/音频包、海报图、`.nfo` 等附带文件；
- **综艺衍生内容**：先导片、加更、纯享版、会员专享/会员版、衍生
  特辑等非正片内容一律不转（除非订阅另有注明要收）。识别口径：
  文件名/标题含「先导」「加更」「纯享」「会员」「特辑」等字样，
  **且不在 TMDB 该季正片集列表内**——两个条件都成立才排除；
  拿不准是不是正片时，对照 TMDB 集列表的标题与日期再决定，
  仍不确定就跳过并点名（见「不确定就停」）。
- **0 字节文件**、样本片（sample）；
- **大小异常的单集**：与同季相邻集大小差一个数量级（如邻集 ~800MB、
  它只有 58MB）→ **默认不转**，并在 candidates 的 `anomaly_note` 或
  logs 里点名注明（如 `E05 仅 58MB，疑似损坏，未转`）。

#### 画质一致性（同一季不混版本）

- 同一季内已入库的集是某种规格（如 4K、或 1080p、或某 HDR 形式）时，
  后续补集**优先选同规格**的候选文件/子夹；规格以分辨率、编码、
  HDR 形式综合判断。**画质档案（`quality_profile`，见步骤 7）让位于
  已入库规格**：哪怕档案首选 1080p，本季已入了 2160p 的集，补集仍
  按 2160p 找；档案只在整季尚无已入库集时决定选源方向。
- 整包多版本分享（多个画质子夹各含全集）**只转选中的一个子夹**里
  的缺集文件，**禁止整包转存**。
- 本轮选定的规格写进 progress 的 note 或 logs（如
  `quality=2160p DV`），换源导致规格变化时更要点名说明。
- **同季已混版时的补集规格口径**：盘点发现同一季已有集存在两种以上
  规格（清晰度/码率档位明显不同）时，上面「已入库规格」不唯一，按
  以下顺序定本轮补集规格：① 以已有集中**数量占多数的规格**为准；
  ② 数量打平时，以**集号最大的连续一段**的规格为准（代表最近的
  入库习惯）。选定后必须在 progress note 注明「该季为混版现状、
  本轮按 X 规格补集」并在汇报中点名；**不许因为混版就回头替换/
  重转已有集**——已有集一律保留。规格判断以文件名特征与单集大小
  综合判断，判断不了就按画质档案执行并注明。

#### 文件夹名清洗（渲染 title_template 前处理标题）

- 括号一律**半角** `()`，标题与年份之间一个空格；年份为四位数字。
- 非法字符 `/ \ : * ? " < > |` 及控制字符：**替换为空格**，
  然后压缩连续空格为一个、去掉首尾空格。例：`天才，女友` 中的
  顿号是合法字符予以保留；`A/B 测试` → `A B 测试`。
- **年份缺失时文件夹名只用标题**（渲染为 `{title}`，不带括号），
  **不要臆造年份**；同时在 progress note 里注明 `year_unknown`。

#### 不确定就停（不要猜）

- **分类、季号、集号任一无法确定**时（映射查不到且无兜底、TMDB 季号
  与源文件冲突且无法判定、集号解析不出），**不要猜**：跳过该订阅
  （或该文件），在 progress 回写 `subscription_status: "error"` +
  note 写明卡在哪一步、缺什么信息，logs 同步一条，等人工处理。
- 猜错一次的代价（建错夹、转错集、命名错位）远大于晚一轮处理。

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
  `error` + note，订阅会按 next_check_at 下轮再来。**跨轮同样适用**：
  下一轮处理同一订阅时，先查历史 candidates/logs，已记
  `candidate_dead` 的分享码直接跳过、不再打开（见步骤 6）。
- **改名被 14014 拒绝**：夸克 `file/rename` 偶发返回 **14014
  「illegal text」**——这是夸克内容检查的误伤，完全合法的模板文件名
  也会中招（实测正常剧集名就被拒过）。遇到时**等待约 3 秒后重试
  1–2 次**，通常即成功。**不要**为了绕过它而改用其他名字——命名
  必须服从 §5.4 模板。重试仍失败才跳过该文件的改名（文件本身已
  入库，不要因此把整集标 failed），并在 progress note / logs /
  向用户的汇报里**点名该集**（如 `E24 改名 14014 重试 2 次仍失败，
  保留原名 <原文件名>`），等人工处理或下一轮再改。
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
