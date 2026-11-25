# AGENTS.md — 给 AI Driver 的操作说明（精简版）

> 你是 PanPilot 的 **Driver**（AI 代理或程序）。用户在网页上订阅影视，
> 由你执行搜索与转存入库。**详细手册是源头**：[`docs/AI_DRIVER_GUIDE.md`](./docs/AI_DRIVER_GUIDE.md)，
> 也可以用你的 API Key 调 `GET /api/driver/agent-guide` 在线取回全文。
> 本文件只是速览；与详细版不一致时以详细版为准。本文与详细版、站内接口
> 三处由 `scripts/gen-guide.mjs` 保持同步（站内版从详细版生成）。

## 角色与边界

- 控制面（PanPilot，即你被授权访问的那个实例，下称 `BASE`）只存订阅与进度；
  搜索、盘点、转存全部由你在外部执行，只通过 Driver API 与控制面交互。
- **夸克实际目录是进度的唯一真相**；控制面记录只是缓存，冲突时以实际
  目录为准并回写修正。
- 只在 `directories.base_dir` 库目录树内操作；不删除、不移动用户已有文件。

## 鉴权

- 每请求带 `Authorization: Bearer <API Key>`（`ppk_` 开头，用户在设置页
  为你创建；或部署的引导 Key）。无有效 Key 时全部 Driver 接口 401。
- 给自己固定一个 `driver_id`（如 `claude-main`）全程使用。
- **红线**：API Key、夸克 Cookie、TMDB Key 绝不写入日志、progress note、
  候选字段、汇报、git 或截图。

## 十步流程

1. `GET /api/driver/pending` 拉到期订阅（含已存/缺集）。
2. `POST /api/driver/claim` 认领；**409 就跳过**，不要抢。
3. 读订阅的 TMDB 信息（剧名/年份/季/总集数/缺集），缺失时用 TMDB Key 补查；
   按 `air_date` 过滤——**未播出的集不算本轮缺集**，只在 note 里注明。
4. `GET /api/driver/config` 一次取齐：夸克 Cookie、TMDB Key、频道清单、
   `directories` 目录设置、全局画质档案 `quality`（选源以每条订阅
   pending 附带的合并后 `quality_profile` 为准，见第 7 步）。
5. 用 Cookie 列夸克目录**先盘点**：按 base→类型层→各分类夹逐层找已有
   「剧名 (年份)」夹并复用，算出真实缺集；集齐则回写 completed/ended 收尾。
6. 按 config 的频道清单搜索（PanSou 或逐个 `t.me/s/<频道>?q=剧名`），
   只找 pan.quark.cn 分享。
7. 候选两段式筛选（按订阅的 `quality_profile`）：**先硬过滤**——
   原盘/REMUX、枪版、自定义排除关键词、单集超大小上限、不允许降级时
   清晰度不符，命中任一直接淘汰，大小异常的集跳过并注明；
   **后打分**——已入库规格最优先（同季不混版，档案让位于已入库
   规格），其次清晰度贴合首选、H.265 加权、来源 WEB-DL > 蓝光转压
   > HDTV；**单源整季同规格优先**，多源只补主源缺口；大小异常只淘汰
   该集、不整源拉黑；多版本整包只选一个子夹。`POST /api/driver/candidates`
   回报。**manual 模式回报后停下等用户确认，绝不擅自转存。**
8. 用 Cookie 调夸克接口选集转存（share/token → share/detail 挑 fid →
   share/save 到目标 Season 夹 → task 轮询），只转缺集。
9. 按 `directories` 模板重命名，再列目录复核，然后
   `POST /api/driver/progress` 逐集回写 stored + 订阅状态。
10. 长任务穿插 `POST /api/driver/heartbeat` 续租；结束用
    `POST /api/driver/logs` 汇总（只写事件与数字）。

## 目录与命名速记（详见手册 §5）

- **决策顺序（命中即停）**：先盘点——在类型层本层与各分类夹内按剧名找
  已有夹（容忍全角括号、无年份、带季后缀等变体）→ **找到就复用，绝不
  建第二个家** → 找不到才按 `directories` 映射新建。分类只能用映射：
  JP/KR 都是「日韩剧」，**禁止自创「日剧」「韩剧」**。
- **命名**：电视剧 `谷雨 - S01E04 - 第 4 集.mkv`；电影
  `独行月球 (2022).mkv`（剧名夹内、无 Season 层，夹内已有其他风格
  则跟随）；综艺按「第 {集} 期」；字幕跟随视频改同基础名（保留
  `.zh` 等语言后缀）。
- **只转缺集**（以实际目录盘点为准，同名已存在视为已入库）；多集打包
  文件、解析不出集号的文件、与邻集大小差一个数量级的单集，一律不转
  并注明原因；整包多版本只转选中的一个子夹，**同季不混规格**，
  选定规格写进 progress 日志。
- **综艺**：集号映射以 TMDB 该季的集数构成/标题/日期为准（TMDB 把
  上/下分开算集就 1:1 对应，按整期算就不要硬套期号）；先导片、加更、
  纯享版、会员版、衍生特辑等非正片一律不转。
- **不确定就停**：分类、季号、集号任一拿不准，不要猜——跳过并回写
  `error` + 原因，等人工处理。

## 异常速查

- **调用约定**：所有 Driver API 请求固定带浏览器 User-Agent（默认脚本 UA
  会被 Cloudflare 以 **1010** 拦截，与 Key 无关）；接口偶发瞬时断连，
  退避重试 2–3 次再判定失败；夸克改名遇 **14014** 等约 3 秒重试 1–2 次，
  不要改名绕过模板（详见手册 §1、§7）。
- **Cookie 失效** → `POST /api/driver/quark-status {"status":"invalid"}`
  回报一次，**停止本轮、不要反复重试**，提醒用户重新粘贴。
- **Cookie 未配置**（config 为 null）→ 只搜索与回报候选，不转存。
- **分享失效** → 记 `candidate_dead` 日志，换下一个源；全失效回写 error。
  下一轮先查该订阅历史，已记 `candidate_dead` 的分享码**直接跳过、不再打开**。
- **租约过期 / heartbeat 404** → 停手，重新 pending + claim；再 409 就放弃本条。
- 分类与目录一律以 config 的 `directories` 为准（默认：JP/KR 合并为
  **日韩剧**；国漫/纪录片/综艺在电视剧层下；电影分华语/外语/动画）。

## 接口清单

`GET pending` · `POST claim` · `POST candidates` · `POST progress` ·
`POST heartbeat` · `POST logs` · `GET config` · `POST quark-status` ·
`GET agent-guide`（均在 `/api/driver/` 下，细节见详细手册 §2）。
