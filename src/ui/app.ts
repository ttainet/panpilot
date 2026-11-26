import { APP_CSS } from "./styles";
import { APP_SCRIPT } from "./client";
import {
  ICON_ARROW_RIGHT,
  ICON_BRAND,
  ICON_CHEVRON,
  ICON_CHEVRON_LEFT,
  ICON_CLOSE,
  ICON_COPY,
  ICON_DASH,
  ICON_EXPLORE,
  ICON_FILM,
  ICON_FIND,
  ICON_GEAR,
  ICON_KEY,
  ICON_LOG,
  ICON_LOGOUT,
  ICON_PLUS,
  ICON_REFRESH,
  ICON_SEARCH,
  ICON_SUBS,
  ICON_SUN,
} from "./icons";

export function appHtml(initialView: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>PanPilot — 影视订阅控制台</title>
<script>
(function(){try{var t=localStorage.getItem('pp_theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();
</script>
<style>${APP_CSS}</style>
</head>
<body data-initial-view="${initialView}">
<div class="layout">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <div class="brand-logo">${ICON_BRAND}</div>
      <div>
        <div class="brand-name">PanPilot</div>
        <div class="brand-sub">影视订阅控制台</div>
      </div>
    </div>

    <button type="button" class="btn btn-primary side-cta" id="side-new-sub">
      ${ICON_PLUS}<span>新建订阅</span>
    </button>

    <nav class="menu" aria-label="主导航">
      <button type="button" class="menu-item" data-nav="dashboard">${ICON_DASH}<span>仪表盘</span></button>
      <button type="button" class="menu-item" data-nav="subscriptions">${ICON_SUBS}<span>我的订阅</span><span class="nav-pill num" id="nav-sub-count">0</span></button>
      <button type="button" class="menu-item" data-nav="explore">${ICON_EXPLORE}<span>探索</span></button>
      <button type="button" class="menu-item" data-nav="discover">${ICON_FIND}<span>发现</span></button>
      <button type="button" class="menu-item" data-nav="logs">${ICON_LOG}<span>日志</span></button>
      <button type="button" class="menu-item" data-nav="settings">${ICON_GEAR}<span>设置</span><span class="nav-dot" id="nav-settings-dot" hidden title="有待处理配置"></span></button>
    </nav>

    <div class="sidebar-foot">
      <div class="user-chip">
        <div class="user-avatar" id="side-avatar">P</div>
        <div class="side-user" id="side-user">加载中…</div>
      </div>
      <div class="foot-actions">
        <button type="button" class="btn btn-icon" id="theme-toggle" title="切换亮/暗主题" aria-label="切换亮/暗主题">${ICON_SUN}</button>
        <form method="post" action="/logout">
          <button class="btn logout-btn" type="submit">${ICON_LOGOUT}<span>退出</span></button>
        </form>
      </div>
    </div>
  </aside>

  <div class="main">
    <header class="topbar">
      <div class="mobile-brand">
        <div class="brand-logo" style="width:28px;height:28px;border-radius:8px">${ICON_BRAND}</div>
        <span>PanPilot</span>
      </div>
      <div class="page-title" id="page-title">仪表盘</div>
      <div class="topbar-actions">
        <span class="topbar-user" id="topbar-user"></span>
        <button type="button" class="btn btn-sm btn-primary mobile-only" id="top-new-sub">${ICON_PLUS}<span>添加</span></button>
        <button type="button" class="btn btn-icon mobile-only" id="theme-toggle-m" title="切换亮/暗主题" aria-label="切换亮/暗主题">${ICON_SUN}</button>
        <form method="post" action="/logout" class="mobile-only">
          <button type="submit" class="btn btn-icon" title="退出登录" aria-label="退出登录">${ICON_LOGOUT}</button>
        </form>
      </div>
    </header>

    <main class="content">
      <!-- ==================== 仪表盘 ==================== -->
      <section class="view" id="view-dashboard">
        <div class="alert-stack" id="dash-alerts"></div>

        <div class="stat-grid">
          <button type="button" class="stat-card" data-jump="subscriptions-active">
            <div class="stat-top">
              <span class="stat-label">订阅总数</span>
              <span class="stat-arrow">${ICON_ARROW_RIGHT}</span>
            </div>
            <div class="stat-value" id="stat-total">–</div>
            <div class="stat-foot">全部追踪剧集与电影</div>
          </button>
          <button type="button" class="stat-card stat-accent" data-jump="subscriptions-active">
            <div class="stat-top">
              <span class="stat-label">订阅中</span>
              <span class="stat-arrow">${ICON_ARROW_RIGHT}</span>
            </div>
            <div class="stat-value" id="stat-following">–</div>
            <div class="stat-foot">含待处理与暂停任务</div>
          </button>
          <button type="button" class="stat-card stat-green" data-jump="subscriptions-finished">
            <div class="stat-top">
              <span class="stat-label">已完结 / 集齐</span>
              <span class="stat-arrow">${ICON_ARROW_RIGHT}</span>
            </div>
            <div class="stat-value" id="stat-finished">–</div>
            <div class="stat-foot">点击查看已完成列表</div>
          </button>
          <button type="button" class="stat-card" data-jump="logs">
            <div class="stat-top">
              <span class="stat-label">已入库集数</span>
              <span class="stat-arrow">${ICON_ARROW_RIGHT}</span>
            </div>
            <div class="stat-value" id="stat-stored">–</div>
            <div class="stat-foot">查看 Driver 入库日志</div>
          </button>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>最近更新的订阅</h2>
            <button type="button" class="btn btn-ghost btn-sm" id="recent-view-all">查看全部 ${ICON_ARROW_RIGHT}</button>
          </div>
          <div id="recent-list">
            <div class="skeleton" style="height:54px;margin-bottom:.55rem"></div>
            <div class="skeleton" style="height:54px;margin-bottom:.55rem"></div>
            <div class="skeleton" style="height:54px"></div>
          </div>
        </div>

        <p class="muted">搜索与转存由外部 Driver 定期执行；本控制台管理订阅状态、目录模板与画质规则，夸克实际目录是进度的唯一真相。</p>
      </section>

      <!-- ==================== 我的订阅 ==================== -->
      <section class="view" id="view-subscriptions">
        <div class="sub-toolbar">
          <div class="seg" role="tablist" aria-label="订阅分组">
            <button type="button" class="seg-btn active" data-group="active" role="tab">订阅中 <span class="seg-count num" id="sub-count-active">0</span></button>
            <button type="button" class="seg-btn" data-group="finished" role="tab">已完成 <span class="seg-count num" id="sub-count-finished">0</span></button>
          </div>
          <div class="filter-pills" id="sub-filter-pills" aria-label="状态筛选">
            <button type="button" class="pill-btn active" data-subfilter="all">全部</button>
            <button type="button" class="pill-btn" data-subfilter="running">进行中</button>
            <button type="button" class="pill-btn" data-subfilter="paused">已暂停</button>
            <button type="button" class="pill-btn" data-subfilter="error">异常</button>
          </div>
          <div class="sub-search-wrap">
            ${ICON_SEARCH}
            <input class="sub-search" id="sub-search" type="search" placeholder="搜索剧名或原名… (快捷键 /)">
            <button type="button" class="search-clear" id="sub-search-clear" hidden aria-label="清空搜索">${ICON_CLOSE}</button>
          </div>
        </div>

        <div class="sub-grid" id="sub-grid">
          <div class="skeleton" style="height:172px;border-radius:16px"></div>
          <div class="skeleton" style="height:172px;border-radius:16px"></div>
          <div class="skeleton" style="height:172px;border-radius:16px"></div>
        </div>

        <div class="empty-state" id="sub-empty" hidden>
          <div class="empty-icon">${ICON_FILM}</div>
          <p id="sub-empty-text">暂无订阅</p>
          <button type="button" class="btn btn-primary btn-sm" id="sub-empty-cta" hidden>去「发现」添加订阅</button>
        </div>
      </section>

      <!-- ==================== 探索 ==================== -->
      <section class="view" id="view-explore">
        <div class="exp-topbar">
          <div class="seg" role="tablist" aria-label="探索来源">
            <button type="button" class="seg-btn active" data-exptab="recommend" role="tab">推荐榜单</button>
            <button type="button" class="seg-btn" data-exptab="tmdb" role="tab">TMDB 探索</button>
            <button type="button" class="seg-btn" data-exptab="douban" role="tab">豆瓣榜单</button>
          </div>
          <button type="button" class="btn btn-sm" id="exp-go-search">${ICON_SEARCH}<span>精准搜片 / 手动录入</span></button>
        </div>

        <div class="exp-panel active" id="exp-panel-recommend">
          <div id="exp-shelves">
            <div class="skeleton" style="height:240px;margin-bottom:1.4rem;border-radius:16px"></div>
            <div class="skeleton" style="height:240px;border-radius:16px"></div>
          </div>
        </div>

        <div class="exp-panel" id="exp-panel-tmdb">
          <div class="exp-filters">
            <div class="seg" role="tablist" aria-label="TMDB 媒体类型">
              <button type="button" class="seg-btn active" data-tmdb-type="tv">电视剧</button>
              <button type="button" class="seg-btn" data-tmdb-type="movie">电影</button>
            </div>
            <select id="exp-tmdb-sort" aria-label="排序方式">
              <option value="popularity.desc">最热门</option>
              <option value="vote_average.desc">高分好评</option>
              <option value="first_air_date.desc">最新播出</option>
            </select>
            <select id="exp-tmdb-genre" aria-label="题材分类">
              <option value="">全部题材</option>
              <option value="18">剧情</option>
              <option value="35">喜剧</option>
              <option value="10759">动作冒险</option>
              <option value="9648">悬疑</option>
              <option value="10765">科幻奇幻</option>
              <option value="16">动画</option>
              <option value="80">犯罪</option>
              <option value="99">纪录片</option>
            </select>
            <select id="exp-tmdb-lang" aria-label="语言地区">
              <option value="">全部地区</option>
              <option value="zh">华语</option>
              <option value="en">欧美</option>
              <option value="ja">日本</option>
              <option value="ko">韩国</option>
            </select>
            <select id="exp-tmdb-year" aria-label="年份">
              <option value="">全部年份</option>
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
              <option value="2022">2022</option>
            </select>
          </div>
          <div id="exp-tmdb-guide"></div>
          <div class="exp-grid" id="exp-tmdb-grid"></div>
          <div class="exp-more-wrap"><button type="button" class="btn" id="exp-tmdb-more" hidden>加载更多</button></div>
        </div>

        <div class="exp-panel" id="exp-panel-douban">
          <div class="exp-pills" id="exp-douban-pills" role="tablist" aria-label="豆瓣榜单分类">
            <button type="button" class="pill-btn active" data-dbcol="tv_hot">热门剧集</button>
            <button type="button" class="pill-btn" data-dbcol="movie_showing">正在热映</button>
            <button type="button" class="pill-btn" data-dbcol="movie_hot_gaia">热门电影</button>
            <button type="button" class="pill-btn" data-dbcol="tv_domestic">国产剧</button>
            <button type="button" class="pill-btn" data-dbcol="tv_american">欧美剧</button>
            <button type="button" class="pill-btn" data-dbcol="tv_japanese">日剧</button>
            <button type="button" class="pill-btn" data-dbcol="tv_korean">韩剧</button>
            <button type="button" class="pill-btn" data-dbcol="tv_animation">热门动画</button>
            <button type="button" class="pill-btn" data-dbcol="tv_variety_show">热门综艺</button>
            <button type="button" class="pill-btn" data-dbcol="tv_chinese_best_weekly">华语口碑剧</button>
            <button type="button" class="pill-btn" data-dbcol="tv_global_best_weekly">全球口碑剧</button>
            <button type="button" class="pill-btn" data-dbcol="movie_weekly_best">一周口碑电影</button>
            <button type="button" class="pill-btn" data-dbcol="movie_top250">豆瓣 Top250</button>
          </div>
          <div class="exp-grid" id="exp-douban-grid"></div>
          <div class="exp-more-wrap"><button type="button" class="btn" id="exp-douban-more" hidden>加载更多</button></div>
        </div>
      </section>

      <!-- ==================== 发现 ==================== -->
      <section class="view" id="view-discover">
        <div class="card">
          <div class="card-head">
            <h2>从 TMDB 选剧订阅</h2>
          </div>
          <p class="section-desc">输入片名搜索 TMDB 元数据，点击海报卡片即可按季订阅并自动匹配入库目录。综艺在 TMDB 中归为电视剧，如按综艺模板入库，可在下方手动表单中将类型设为「综艺」。</p>
          <form class="tmdb-search-bar" id="tmdb-form">
            <div class="input-with-icon">
              ${ICON_SEARCH}
              <input id="tmdb-q" placeholder="输入剧名或电影名，例如：谷雨、沙丘… (快捷键 /)">
            </div>
            <button type="submit" class="btn btn-primary" id="tmdb-search-btn">${ICON_SEARCH}<span>搜索 TMDB</span></button>
          </form>
          <div id="tmdb-guide"></div>
          <div id="tmdb-results" class="tmdb-grid"></div>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>手动添加订阅</h2>
          </div>
          <p class="section-desc">TMDB 未配置或暂未收录时可直接录入订阅；若需要展示海报与自动评分，建议优先使用上方 TMDB 搜索。</p>
          <form id="add-form">
            <div class="form-grid">
              <div class="field" style="grid-column: span 2">
                <label class="field-label" for="f-title">片名 *</label>
                <input name="title" id="f-title" placeholder="例如：谷雨" required>
              </div>
              <div class="field">
                <label class="field-label" for="f-media_type">媒体类型</label>
                <select name="media_type" id="f-media_type">
                  <option value="tv">电视剧</option>
                  <option value="movie">电影</option>
                  <option value="variety">综艺</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="f-year">年份</label>
                <input name="year" id="f-year" type="number" placeholder="如 2026" min="1900" max="2100">
              </div>
              <div class="field">
                <label class="field-label" for="f-region">地区 / 分类</label>
                <input name="region" id="f-region" placeholder="如 国产剧 / 欧美剧">
              </div>
              <div class="field">
                <label class="field-label" for="f-season">季号（剧集/综艺）</label>
                <input name="season" id="f-season" type="number" placeholder="如 1" min="0">
              </div>
              <div class="field">
                <label class="field-label" for="f-total_episodes">总集数</label>
                <input name="total_episodes" id="f-total_episodes" type="number" placeholder="如 24" min="1">
              </div>
              <div class="field">
                <label class="field-label" for="f-mode">执行模式</label>
                <select name="mode" id="f-mode">
                  <option value="auto" selected>自动转存</option>
                  <option value="manual">手动确认</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="f-quality">画质偏好</label>
                <select name="quality" id="f-quality" title="画质偏好（清晰度覆盖）">
                  <option value="">跟随全局档案</option>
                  <option value="2160p">优先 4K (2160p)</option>
                  <option value="1080p">优先 1080p</option>
                  <option value="720p">优先 720p</option>
                </select>
              </div>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary" id="add-submit-btn">${ICON_PLUS}<span>添加订阅</span></button>
            </div>
          </form>
        </div>
      </section>

      <!-- ==================== 日志 ==================== -->
      <section class="view" id="view-logs">
        <div class="card">
          <div class="card-head">
            <h2>Driver 操作日志</h2>
            <button class="btn btn-sm" id="log-refresh" type="button">${ICON_REFRESH}<span>刷新</span></button>
          </div>
          <p class="section-desc">记录 Driver 每轮的认领、盘点、选源、转存与异常事件（时间倒序）。点击任意日志行可展开完整详情。</p>
          <div class="logs-toolbar">
            <div class="seg" role="tablist" aria-label="日志级别">
              <button type="button" class="seg-btn active" data-loglevel="">全部</button>
              <button type="button" class="seg-btn" data-loglevel="info">info</button>
              <button type="button" class="seg-btn" data-loglevel="warn">warn</button>
              <button type="button" class="seg-btn" data-loglevel="error">error</button>
            </div>
            <select id="log-sub-filter" aria-label="按订阅筛选">
              <option value="">全部订阅</option>
            </select>
          </div>
          <div class="log-list" id="log-list"><p class="muted">加载中…</p></div>
          <div class="log-more-wrap"><button class="btn" id="log-more" type="button" hidden>加载更多日志</button></div>
        </div>
      </section>

      <!-- ==================== 设置 ==================== -->
      <section class="view" id="view-settings">
        <div class="settings-tabs" role="tablist" aria-label="设置分类">
          <button type="button" class="settings-tab" data-stab="account" role="tab">账号</button>
          <button type="button" class="settings-tab" data-stab="tmdb" role="tab">媒体信息<span class="tab-dot" id="tab-dot-tmdb" hidden></span></button>
          <button type="button" class="settings-tab" data-stab="quark" role="tab">网盘<span class="tab-dot" id="tab-dot-quark" hidden></span></button>
          <button type="button" class="settings-tab" data-stab="channels" role="tab">搜索源</button>
          <button type="button" class="settings-tab" data-stab="directories" role="tab">入库目录</button>
          <button type="button" class="settings-tab" data-stab="quality" role="tab">画质偏好</button>
          <button type="button" class="settings-tab" data-stab="subscription" role="tab">订阅设置</button>
          <button type="button" class="settings-tab" data-stab="driver" role="tab">Driver</button>
          <button type="button" class="settings-tab" data-stab="wecom" role="tab">企业微信</button>
        </div>

        <div class="settings-panel" id="spanel-account">
          <div class="card">
            <div class="card-head">
              <h2>登录账号管理</h2>
              <span class="status-pill-box">当前：<strong id="account-username">…</strong> · <span id="account-source">…</span></span>
            </div>
            <p class="section-desc">初始账号密码来自部署 Secrets，在此修改后以新凭据为准（密码仅存 PBKDF2 哈希）。修改时须验证当前密码；保存后其他设备上的旧会话会自动失效，当前浏览器会无缝续签。</p>
            <form id="account-form">
              <div class="form-grid-2">
                <div class="field">
                  <label class="field-label" for="acc-current">当前密码 *</label>
                  <input id="acc-current" type="password" placeholder="验证当前密码" autocomplete="current-password" required>
                </div>
                <div class="field">
                  <label class="field-label" for="acc-username">新用户名（不改可留空）</label>
                  <input id="acc-username" placeholder="1–64 个字符，不含空白" autocomplete="username">
                </div>
                <div class="field">
                  <label class="field-label" for="acc-password">新密码（不改可留空）</label>
                  <input id="acc-password" type="password" placeholder="至少 6 位" autocomplete="new-password">
                </div>
                <div class="field">
                  <label class="field-label" for="acc-password2">确认新密码</label>
                  <input id="acc-password2" type="password" placeholder="再次输入新密码" autocomplete="new-password">
                </div>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary">保存新账号</button>
              </div>
            </form>
            <p id="account-msg" class="muted" style="margin-top:.65rem"></p>
          </div>
        </div>

        <div class="settings-panel" id="spanel-tmdb">
          <div class="card">
            <div class="card-head">
              <h2>TMDB 媒体库凭据</h2>
              <span class="status-pill-box" id="tmdb-status">加载中…</span>
            </div>
            <p class="section-desc">TMDB API Key 保存在服务端设置中（页面仅展示末 4 位掩码），用于「发现」页选剧搜索、封面拉取与年份/地区元数据回填。Key 可在 themoviedb.org 免费申请。</p>
            <form id="tmdb-key-form">
              <div class="field">
                <label class="field-label" for="tmdb-key">更新 TMDB API Key</label>
                <div class="input-group">
                  <input id="tmdb-key" placeholder="输入新的 TMDB API Key (v3 auth)" autocomplete="off">
                  <button type="submit" class="btn btn-primary">保存 Key</button>
                  <button type="button" class="btn btn-danger" id="tmdb-clear">清除</button>
                </div>
              </div>
            </form>
          </div>
        </div>

        <div class="settings-panel" id="spanel-quark">
          <div class="card" id="card-quark-cookie">
            <div class="card-head">
              <h2>夸克网盘 Cookie</h2>
              <span class="status-pill-box" id="cookie-status">加载中…</span>
            </div>
            <p class="section-desc">Driver 使用它调用夸克接口完成盘点、转存与重命名。Cookie 以 <strong>AES-GCM 加密</strong>保存（密钥位于 Worker Secret，页面与网页接口永不回显明文或密文）；仅持有有效 API Key 的 Driver 可取回。Cookie 等同登录凭证，切勿外传。</p>
            <p id="cookie-driver-status" class="muted" style="margin:0 0 .85rem"></p>
            <form id="cookie-form">
              <div class="field">
                <label class="field-label" for="cookie-input">更新夸克 Cookie</label>
                <div class="input-group">
                  <input id="cookie-input" type="password" placeholder="粘贴完整夸克网页端 Cookie（已保存的值不会回显）" autocomplete="off">
                  <button type="submit" class="btn btn-primary">加密保存</button>
                  <button type="button" class="btn btn-danger" id="cookie-clear">清除</button>
                </div>
              </div>
            </form>
            <p id="cookie-msg" class="muted" style="margin-top:.65rem"></p>
          </div>
        </div>

        <div class="settings-panel" id="spanel-channels">
          <div class="card" id="card-tg-channels">
            <div class="card-head">
              <h2>Telegram 搜索源频道</h2>
              <span class="status-pill-box" id="channels-status">加载中…</span>
            </div>
            <p class="section-desc">Driver 搜索时使用的 Telegram 频道用户名，一行一个。未自定义时使用内置默认清单（147 个已验证有效频道）。开启「只用夸克优先频道」时，默认清单取 76 个夸克优先子集；自定义清单则取其与这 76 个的交集（交集为空则退回自定义全量）。</p>
            <form id="channels-form">
              <div class="field">
                <label class="field-label" for="channels-input">频道清单（当前共 <span id="channels-count" class="num">0</span> 个，保存时自动去重去空行）</label>
                <textarea id="channels-input" rows="11" spellcheck="false"></textarea>
              </div>
              <div style="margin-top:.85rem">
                <label class="switch-row" for="channels-priority">
                  <div class="switch-text">
                    <div class="switch-title">只用夸克优先频道（76）</div>
                    <div class="switch-desc">缩小搜索范围到高命中率的夸克资源频道，加快 Driver 每轮检索速度</div>
                  </div>
                  <span class="switch">
                    <input type="checkbox" id="channels-priority">
                    <span class="switch-track"></span>
                  </span>
                </label>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary">保存频道列表</button>
                <button type="button" class="btn" id="channels-reset">恢复默认（147）</button>
              </div>
            </form>
            <p id="channels-msg" class="muted" style="margin-top:.65rem"></p>
          </div>
        </div>

        <div class="settings-panel" id="spanel-directories">
          <div class="card" id="card-directories">
            <div class="card-head">
              <h2>入库目录与命名规范</h2>
              <span class="status-pill-box" id="directories-status">加载中…</span>
            </div>
            <p class="section-desc">Driver 转存入库时遵循的网盘目录结构与重命名模板。映射每行一条，格式 <code>代码=文件夹名</code>（<code>*</code> 表示兜底；电影映射含 <code>animation</code>；剧集特殊分类含 <code>animation_cn</code> / <code>documentary</code> / <code>variety</code>）。占位符支持 <code>{title}</code> <code>{year}</code> <code>{season}</code> <code>{episode}</code> 及 <code>:02</code> 零填充。</p>

            <form id="directories-form">
              <div class="form-grid-3">
                <div class="field">
                  <label class="field-label" for="dir-base">根目录</label>
                  <input id="dir-base">
                </div>
                <div class="field">
                  <label class="field-label" for="dir-tv">电视剧目录</label>
                  <input id="dir-tv">
                </div>
                <div class="field">
                  <label class="field-label" for="dir-movie">电影目录</label>
                  <input id="dir-movie">
                </div>
              </div>

              <div class="form-grid-3" style="margin-top:.9rem">
                <div class="field">
                  <label class="field-label" for="dir-tv-region">电视剧地区映射</label>
                  <textarea id="dir-tv-region" rows="5" spellcheck="false"></textarea>
                </div>
                <div class="field">
                  <label class="field-label" for="dir-tv-special">电视剧特殊分类</label>
                  <textarea id="dir-tv-special" rows="5" spellcheck="false"></textarea>
                </div>
                <div class="field">
                  <label class="field-label" for="dir-movie-category">电影分类映射</label>
                  <textarea id="dir-movie-category" rows="5" spellcheck="false"></textarea>
                </div>
              </div>

              <div class="form-grid-3" style="margin-top:.9rem">
                <div class="field">
                  <label class="field-label" for="dir-title-template">剧名夹模板</label>
                  <input id="dir-title-template">
                </div>
                <div class="field">
                  <label class="field-label" for="dir-season-template">季夹模板</label>
                  <input id="dir-season-template">
                </div>
                <div class="field">
                  <label class="field-label" for="dir-movie-name-template">电影文件模板</label>
                  <input id="dir-movie-name-template">
                </div>
              </div>
              <div class="form-grid-2" style="margin-top:.85rem">
                <div class="field">
                  <label class="field-label" for="dir-episode-template">单集文件模板</label>
                  <input id="dir-episode-template">
                </div>
                <div class="field">
                  <label class="field-label" for="dir-variety-template">综艺文件模板</label>
                  <input id="dir-variety-template">
                </div>
              </div>

              <div class="preview-terminal" aria-label="入库路径实时预览">
                <div class="preview-line"><span class="preview-tag">电视剧</span><span id="directories-preview">—</span></div>
                <div class="preview-line"><span class="preview-tag">电影</span><span id="directories-preview-movie">—</span></div>
                <div class="preview-line"><span class="preview-tag">综艺</span><span id="directories-preview-variety">—</span></div>
              </div>

              <div class="form-actions">
                <button type="submit" class="btn btn-primary">保存目录设置</button>
                <button type="button" class="btn" id="directories-reset">恢复默认</button>
              </div>
            </form>
            <p id="directories-msg" class="muted" style="margin-top:.65rem"></p>
          </div>
        </div>

        <div class="settings-panel" id="spanel-quality">
          <div class="card" id="card-quality">
            <div class="card-head">
              <h2>全局画质偏好档案</h2>
              <span class="status-pill-box" id="quality-status">加载中…</span>
            </div>
            <p class="section-desc">Driver 选源采用「先硬过滤、后打分」策略。单条订阅可单独覆盖首选清晰度，其余开关均以本档案为准；若同季已有入库文件，则优先沿用已入库规格保持同季一致。</p>
            <form id="quality-form">
              <div class="form-grid-2">
                <div class="field">
                  <label class="field-label" for="q-resolution">首选清晰度</label>
                  <select id="q-resolution">
                    <option value="2160p">2160p（4K）</option>
                    <option value="1080p">1080p</option>
                    <option value="720p">720p</option>
                    <option value="any">不限（any）</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label" for="q-max-gb">单集大小上限（GB，0 表示不限）</label>
                  <input id="q-max-gb" type="number" min="0" max="1024" step="0.5">
                </div>
              </div>

              <div class="form-grid-2" style="margin-top:.9rem">
                <label class="switch-row" for="q-fallback">
                  <div class="switch-text">
                    <div class="switch-title">允许画质降级</div>
                    <div class="switch-desc">找不到首选清晰度时接受更低清晰度</div>
                  </div>
                  <span class="switch"><input type="checkbox" id="q-fallback"><span class="switch-track"></span></span>
                </label>
                <label class="switch-row" for="q-prefer-h265">
                  <div class="switch-text">
                    <div class="switch-title">优先 H.265 / HEVC</div>
                    <div class="switch-desc">同清晰度下优先高压缩比编码</div>
                  </div>
                  <span class="switch"><input type="checkbox" id="q-prefer-h265"><span class="switch-track"></span></span>
                </label>
                <label class="switch-row" for="q-exclude-remux">
                  <div class="switch-text">
                    <div class="switch-title">排除蓝光原盘 / REMUX</div>
                    <div class="switch-desc">硬过滤体积庞大的未压制原盘源</div>
                  </div>
                  <span class="switch"><input type="checkbox" id="q-exclude-remux"><span class="switch-track"></span></span>
                </label>
                <label class="switch-row" for="q-exclude-cam">
                  <div class="switch-text">
                    <div class="switch-title">排除枪版（CAM / TS / TC）</div>
                    <div class="switch-desc">硬过滤院线偷拍低质资源</div>
                  </div>
                  <span class="switch"><input type="checkbox" id="q-exclude-cam"><span class="switch-track"></span></span>
                </label>
              </div>

              <div class="field" style="margin-top:.9rem">
                <label class="field-label" for="q-exclude-keywords">自定义排除关键词（一行一个，命中标题或文件名即淘汰）</label>
                <textarea id="q-exclude-keywords" rows="4" spellcheck="false" placeholder="例如：高码水印、某发布组"></textarea>
              </div>

              <div class="form-actions">
                <button type="submit" class="btn btn-primary">保存画质偏好</button>
                <button type="button" class="btn" id="quality-reset">恢复默认</button>
              </div>
            </form>
            <p id="quality-msg" class="muted" style="margin-top:.65rem"></p>
          </div>
        </div>

        <div class="settings-panel" id="spanel-subscription">
          <div class="card">
            <div class="card-head">
              <h2>订阅调度参数</h2>
            </div>
            <p class="section-desc">Driver 按统一批次处理到期订阅：每天北京时间 <strong>00:00 / 06:00 / 12:00 / 18:00</strong> 四个批次。订阅处理完成后，下次检查对齐到不早于处理时刻 +<strong id="interval">…</strong> 小时的第一个批次点（实际间隔为最小间隔的 1–2 倍）。新建订阅立即可执行，首次处理后进入批次节奏。</p>
            <div style="display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap">
              <div class="field" style="min-width:180px">
                <label class="field-label" for="set-interval">全局最小检查间隔</label>
                <select id="set-interval">
                  <option value="1">1 小时</option>
                  <option value="2">2 小时</option>
                  <option value="3">3 小时</option>
                  <option value="6">6 小时</option>
                  <option value="12">12 小时</option>
                  <option value="24">24 小时</option>
                </select>
              </div>
              <button type="button" class="btn btn-primary" id="set-interval-save">保存</button>
              <button type="button" class="btn btn-ghost" id="set-interval-reset">恢复默认</button>
              <span class="muted" id="set-interval-state" style="padding-bottom:.45rem"></span>
            </div>
            <p class="section-desc" style="margin-bottom:0;margin-top:.6rem">保存后即时生效于之后的新排期；已经排定的下次检查时间不变，下一次处理后按新间隔排。单条订阅在卡片上单独设置的间隔优先于全局。</p>
          </div>
        </div>

        <div class="settings-panel" id="spanel-driver">
          <div class="card" id="card-driver-keys">
            <div class="card-head">
              <h2>Driver API Key 管理</h2>
              <span class="status-pill-box" id="driver-keys-status">加载中…</span>
            </div>
            <p class="section-desc">每个 Driver 建议创建独立 Key（如 <code>claude-main</code> / <code>Muse</code>）。已配置 <code>COOKIE_ENC_SECRET</code> 时会在服务端 <strong>AES-GCM 加密存档</strong>，可直接点击每行右侧的「<strong>复制提示词</strong>」（自动带入该 Key 与名称作为 <code>driver_id</code>）或「<strong>复制 Key</strong>」发给 AI 立即开始工作。</p>

            <div id="driver-keys-list" style="margin-bottom:.9rem"></div>

            <div id="dk-once" class="once-vault" hidden>
              <div class="once-vault-title">${ICON_KEY}<span>当前未启用加密存档，新 Key 仅显示这一次，请立即复制保存：</span></div>
              <form class="input-group" id="dk-once-form">
                <input id="dk-once-value" readonly autocomplete="off">
                <button type="button" class="btn btn-primary" id="dk-copy-prompt">复制 AI 启动指令（含此 Key）</button>
                <button type="button" class="btn" id="dk-copy">仅复制 Key</button>
                <button type="button" class="btn btn-ghost" id="dk-once-close">我已保存，关闭</button>
              </form>
            </div>

            <form id="dk-form">
              <div class="field">
                <label class="field-label" for="dk-name">新建 Driver API Key</label>
                <div class="input-group">
                  <input id="dk-name" placeholder="输入 Driver 名称（同时用作 driver_id），如 claude-main / Muse" autocomplete="off">
                  <button type="submit" class="btn btn-primary">${ICON_PLUS}<span>新建 Key</span></button>
                </div>
              </div>
            </form>
            <p id="dk-msg" class="muted" style="margin-top:.65rem"></p>
            <p class="muted" style="margin-top:.4rem">提示：部署时设置的 <code>DRIVER_TOKEN</code> 为系统引导 Key，始终有效且不在此列表中展示。</p>
          </div>

          <div class="card" id="card-agent-guide">
            <div class="card-head">
              <h2>AI 启动提示词模板 & 操作手册（agent-guide）</h2>
              <div class="seg" role="tablist" aria-label="提示词模板模式">
                <button type="button" class="seg-btn active" data-ag-mode="short">精简启动指令</button>
                <button type="button" class="seg-btn" data-ag-mode="full">附带完整手册</button>
              </div>
            </div>
            <p class="section-desc">在上方任一 Key 行点击「<strong>复制提示词</strong>」，会按下面选中的模式把该 Key 和名称自动填入模板（精简版让 AI 先自动拉取 <code>/api/driver/agent-guide</code>；若你的 AI 无法自行发 GET 请求，可切换为「附带完整手册」）。切勿把含明文 Key 的提示词发到公开渠道或截图。</p>

            <pre class="preview-terminal" id="ag-prompt-preview" style="white-space:pre-wrap;word-break:break-word;margin-top:.85rem">加载中…</pre>

            <div class="form-actions">
              <button type="button" class="btn" id="ag-copy-template">${ICON_COPY}<span>复制纯模板（不含 Key）</span></button>
              <button type="button" class="btn" id="ag-copy-guide">${ICON_COPY}<span>仅复制操作手册原文</span></button>
              <button type="button" class="btn btn-ghost" id="ag-toggle-full">展开完整手册全文</button>
            </div>

            <div id="ag-full-wrap" hidden style="margin-top:.95rem">
              <pre class="preview-terminal" id="ag-full-text" style="max-height:460px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin-top:0">加载中…</pre>
            </div>
          </div>

        </div>

        <div class="settings-panel" id="spanel-wecom">
          <form id="wecom-form">
            <div class="card">
              <div class="card-head">
                <h2>企业微信自建应用</h2>
                <span class="status-pill-box" id="wecom-status">加载中…</span>
              </div>
              <p class="section-desc">在微信内直接发片名搜剧、回复序号订阅（默认自动转存）、接收新集入库/Cookie 失效提醒，并通过自定义菜单免密打开移动控制台。所有密钥均使用 <code>COOKIE_ENC_SECRET</code> 进行 <strong>AES-GCM 加密</strong>保存，页面只展示掩码。</p>

              <div class="field" style="margin-bottom:.95rem">
                <label class="switch-row" for="wc-enabled">
                  <div class="switch-text">
                    <div class="switch-title">启用企业微信联动</div>
                    <div class="switch-desc">开启后处理回调消息、自动回复搜剧结果并启用自定义菜单/主动推送</div>
                  </div>
                  <span class="switch"><input type="checkbox" id="wc-enabled"><span class="switch-track"></span></span>
                </label>
              </div>

              <div class="field" style="margin-bottom:.95rem">
                <label class="field-label" for="wc-callback-url">接收消息服务器 URL（填入企业微信后台「接收消息 → 设置 API 接收」）</label>
                <div class="input-group">
                  <input id="wc-callback-url" readonly autocomplete="off" style="font-family:var(--pp-mono);font-size:.84rem">
                  <button type="button" class="btn" id="wc-copy-cb">${ICON_COPY}<span>复制地址</span></button>
                </div>
              </div>

              <div class="form-grid-2">
                <div class="field">
                  <label class="field-label" for="wc-corp-id">企业 ID（CorpID）</label>
                  <input id="wc-corp-id" placeholder="如 wwxxxxxxxxxxxxxxxx" autocomplete="off">
                </div>
                <div class="field">
                  <label class="field-label" for="wc-agent-id">应用 AgentId</label>
                  <input id="wc-agent-id" type="number" min="1" placeholder="如 1000002" autocomplete="off">
                </div>
                <div class="field">
                  <label class="field-label" for="wc-proxy-url">企微 API 代理地址（固定出口 IP 用）</label>
                  <input id="wc-proxy-url" placeholder="https://qywx.ttai.net" autocomplete="off">
                  <span class="field-hint">已预设你的 VPS 代理 <code>https://qywx.ttai.net</code>（对应可信 IP：<code>94.241.161.18</code>）</span>
                </div>
                <div class="field">
                  <label class="field-label" for="wc-users">允许的 UserID 白名单（必填，用于权限控制与免密登录）</label>
                  <input id="wc-users" placeholder="如 ZhangSan，多个用英文逗号分隔" autocomplete="off">
                  <span class="field-hint">在企业微信管理后台「通讯录 → 成员详情 → 账号」查看 UserID</span>
                </div>
              </div>

              <div class="form-grid-3" style="margin-top:.9rem">
                <div class="field">
                  <label class="field-label" for="wc-secret">应用 Secret（不改可留空）</label>
                  <input id="wc-secret" type="password" placeholder="粘贴应用 Secret" autocomplete="off">
                  <span class="field-hint" id="wc-secret-hint">未配置</span>
                </div>
                <div class="field">
                  <label class="field-label" for="wc-token">回调 Token（不改可留空）</label>
                  <input id="wc-token" type="password" placeholder="后台随机生成后粘贴" autocomplete="off">
                  <span class="field-hint" id="wc-token-hint">未配置</span>
                </div>
                <div class="field">
                  <label class="field-label" for="wc-aes-key">EncodingAESKey（不改可留空）</label>
                  <input id="wc-aes-key" type="password" placeholder="43 位 Base64 字符" autocomplete="off">
                  <span class="field-hint" id="wc-aes-hint">未配置</span>
                </div>
              </div>

              <div class="form-grid-2" style="margin-top:.9rem">
                <label class="switch-row" for="wc-notify">
                  <div class="switch-text">
                    <div class="switch-title">主动微信推送通知</div>
                    <div class="switch-desc">新集入库、剧集完结、订阅异常与夸克 Cookie 失效时自动提醒</div>
                  </div>
                  <span class="switch"><input type="checkbox" id="wc-notify"><span class="switch-track"></span></span>
                </label>
                <label class="switch-row" for="wc-oauth">
                  <div class="switch-text">
                    <div class="switch-title">微信内免密打开控制台</div>
                    <div class="switch-desc">点击菜单网页入口时走企微 OAuth2 校验白名单 UserID 免密登录</div>
                  </div>
                  <span class="switch"><input type="checkbox" id="wc-oauth"><span class="switch-track"></span></span>
                </label>
              </div>
            </div>

            <div class="card">
              <div class="card-head">
                <h2>可信域名校验文件（OAuth2 免密登录需要）</h2>
              </div>
              <p class="section-desc">在企业微信「网页授权及 JS-SDK → 设置可信域名」下载 <code>WW_verify_xxx.txt</code> 后把文件名与内容填入此处保存，PanPilot 会自动在根目录对外提供验证。</p>
              <div class="form-grid-2">
                <div class="field">
                  <label class="field-label" for="wc-verify-name">校验文件名</label>
                  <input id="wc-verify-name" placeholder="如 WW_verify_AbCdEfGh.txt" autocomplete="off">
                </div>
                <div class="field">
                  <label class="field-label" for="wc-verify-content">校验文件内容</label>
                  <input id="wc-verify-content" placeholder="粘贴文件内的一行校验字符串" autocomplete="off">
                </div>
              </div>
              <p class="muted" id="wc-verify-preview" style="margin-top:.6rem"></p>

              <div class="form-actions">
                <button type="submit" class="btn btn-primary" id="wc-save">保存企业微信配置</button>
                <button type="button" class="btn" id="wc-sync-menu">一键同步自定义菜单</button>
                <button type="button" class="btn" id="wc-test">发送测试消息</button>
                <button type="button" class="btn btn-danger" id="wc-clear-secrets">清除已存密钥</button>
              </div>
              <p id="wecom-msg" class="muted" style="margin-top:.65rem"></p>
            </div>
          </form>
        </div>
      </section>
    </main>
  </div>
</div>

<!-- 移动端底部 Tab 导航 -->
<nav class="mobile-tabs" aria-label="移动端导航">
  <button type="button" class="mobile-tab" data-nav="dashboard">${ICON_DASH}<span>仪表盘</span></button>
  <button type="button" class="mobile-tab" data-nav="subscriptions">${ICON_SUBS}<span>订阅</span></button>
  <button type="button" class="mobile-tab" data-nav="explore">${ICON_EXPLORE}<span>探索</span></button>
  <button type="button" class="mobile-tab" data-nav="discover">${ICON_FIND}<span>发现</span></button>
  <button type="button" class="mobile-tab" data-nav="logs">${ICON_LOG}<span>日志</span></button>
  <button type="button" class="mobile-tab" data-nav="settings">${ICON_GEAR}<span>设置</span><span class="nav-dot" id="nav-settings-dot-m" hidden></span></button>
</nav>

<!-- 详情弹窗 (TMDB / 订阅详情共用) -->
<div class="modal-backdrop" id="modal-backdrop" hidden>
  <div class="modal" role="dialog" aria-modal="true">
    <button type="button" class="btn btn-ghost btn-icon modal-close" id="modal-close-x" aria-label="关闭弹窗">${ICON_CLOSE}</button>
    <div id="modal-content"><p class="muted">加载中…</p></div>
  </div>
</div>

<!-- 安全确认弹窗 (替代原生 confirm) -->
<div class="modal-backdrop" id="confirm-backdrop" hidden>
  <div class="modal modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
    <h3 id="confirm-title" style="margin:0 0 .45rem">确认操作</h3>
    <p id="confirm-msg" class="muted" style="margin:0"></p>
    <div class="modal-actions">
      <button type="button" class="btn" id="confirm-cancel">取消</button>
      <button type="button" class="btn btn-primary" id="confirm-ok">确认</button>
    </div>
  </div>
</div>

<!-- 全局 Toast 容器 -->
<div class="toast-stack" id="toast-stack" aria-live="polite"></div>

<!-- 共享自定义下拉浮层 -->
<div class="pp-popover" id="pp-popover" role="listbox" hidden></div>

<script>
${APP_SCRIPT}
</script>
</body>
</html>`;
}
