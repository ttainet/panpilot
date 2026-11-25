import { APP_CSS } from "./styles";
import { APP_SCRIPT } from "./client";
import {
  ICON_ARROW_RIGHT,
  ICON_BRAND,
  ICON_CLOSE,
  ICON_DASH,
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
                  <option value="manual">手动确认</option>
                  <option value="auto">自动转存</option>
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
          <button type="button" class="settings-tab" data-stab="driver" role="tab">Driver</button>
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

        <div class="settings-panel" id="spanel-driver">
          <div class="card" id="card-driver-keys">
            <div class="card-head">
              <h2>Driver API Key 管理</h2>
              <span class="status-pill-box" id="driver-keys-status">加载中…</span>
            </div>
            <p class="section-desc">Driver 需在请求头携带 <code>Authorization: Bearer &lt;Key&gt;</code> 才可拉取任务与配置（夸克 Cookie、TMDB Key、频道清单）。建议每个 Driver 单独创建一个 Key；明文<strong>仅在创建或重置时展示一次</strong>，服务端仅存 SHA-256 哈希。</p>

            <div id="driver-keys-list" style="margin-bottom:.9rem"></div>

            <div id="dk-once" class="once-vault" hidden>
              <div class="once-vault-title">${ICON_KEY}<span>新 Key 只显示这一次，请立即复制保存到 Driver 配置：</span></div>
              <form class="input-group" id="dk-once-form">
                <input id="dk-once-value" readonly autocomplete="off">
                <button type="button" class="btn btn-primary" id="dk-copy">复制 Key</button>
                <button type="button" class="btn btn-ghost" id="dk-once-close">我已保存，关闭</button>
              </form>
            </div>

            <form id="dk-form">
              <div class="field">
                <label class="field-label" for="dk-name">新建 Driver API Key</label>
                <div class="input-group">
                  <input id="dk-name" placeholder="输入 Driver 名称，如 claude-main / home-nas" autocomplete="off">
                  <button type="submit" class="btn btn-primary">${ICON_PLUS}<span>新建 Key</span></button>
                </div>
              </div>
            </form>
            <p id="dk-msg" class="muted" style="margin-top:.65rem"></p>
            <p class="muted" style="margin-top:.4rem">提示：部署时设置的 <code>DRIVER_TOKEN</code> 为系统引导 Key，始终有效且不在此列表中展示。</p>
          </div>

          <div class="card">
            <div class="card-head">
              <h2>Driver 调度参数</h2>
            </div>
            <p class="section-desc" style="margin-bottom:0">Driver 默认检查间隔为 <strong id="interval">…</strong> 小时一轮（由 Worker 环境变量 <code>CHECK_INTERVAL_HOURS</code> 控制）。Driver API Key 与网页端登录会话完全隔离。</p>
          </div>
        </div>
      </section>
    </main>
  </div>
</div>

<!-- 移动端底部 Tab 导航 -->
<nav class="mobile-tabs" aria-label="移动端导航">
  <button type="button" class="mobile-tab" data-nav="dashboard">${ICON_DASH}<span>仪表盘</span></button>
  <button type="button" class="mobile-tab" data-nav="subscriptions">${ICON_SUBS}<span>订阅</span></button>
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

<script>
${APP_SCRIPT}
</script>
</body>
</html>`;
}
