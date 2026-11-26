import {
  ICON_ALERT,
  ICON_CHECK,
  ICON_CHEVRON,
  ICON_CHEVRON_LEFT,
  ICON_COPY,
  ICON_INFO,
  ICON_KEY,
  ICON_MOON,
  ICON_PAUSE,
  ICON_PLAY,
  ICON_REFRESH,
  ICON_SUN,
  ICON_TRASH,
} from "./icons";

/**
 * Client-side SPA script for PanPilot.
 * Uses plain single-quoted JS strings inside String.raw to avoid nested template-literal escaping issues.
 */
const ICON_JSON = JSON.stringify({
  sun: ICON_SUN,
  moon: ICON_MOON,
  pause: ICON_PAUSE,
  play: ICON_PLAY,
  refresh: ICON_REFRESH,
  trash: ICON_TRASH,
  info: ICON_INFO,
  check: ICON_CHECK,
  alert: ICON_ALERT,
  chevron: ICON_CHEVRON,
  chevronLeft: ICON_CHEVRON_LEFT,
  copy: ICON_COPY,
  key: ICON_KEY,
});

export const APP_SCRIPT = `var ICONS = ${ICON_JSON};
` + String.raw`
var VIEWS = ['dashboard', 'subscriptions', 'explore', 'discover', 'logs', 'settings'];
var VIEW_TITLES = { dashboard: '仪表盘', subscriptions: '我的订阅', explore: '探索', discover: '发现', logs: '日志', settings: '设置' };
var FINISHED_STATUSES = ['completed', 'ended'];
function isFinishedSub(s) { return FINISHED_STATUSES.indexOf(s.status) >= 0; }
var STATUS_LABEL = {
  subscribed: '已订阅', pending_search: '待搜索', searching: '搜索中',
  candidates_ready: '已找到候选', awaiting_confirm: '待确认', transferring: '转存中',
  verifying: '复核中', partial_stored: '部分入库', completed: '已集齐',
  ended: '已完结', paused: '已暂停', error: '出错'
};
var EP_STATUS_LABEL = {
  stored: '已入库', missing: '缺失', found: '已找到',
  transferring: '转存中', failed: '失败', skipped: '已跳过'
};

var subsCache = [];
var globalCheckHours = 6;
var storedMap = {};
var settingsCache = null;

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function fmtTime(sec) {
  if (!sec) return '—';
  return new Date(sec * 1000).toLocaleString();
}
function mediaLabel(t) { return t === 'movie' ? '电影' : (t === 'variety' ? '综艺' : '电视剧'); }
function statusClass(s) {
  if (s === 'completed' || s === 'ended') return 'b-done';
  if (s === 'partial_stored' || s === 'awaiting_confirm') return 'b-partial';
  if (s === 'paused') return 'b-paused';
  if (s === 'error') return 'b-error';
  return 'b-active';
}
function badge(s) {
  return '<span class="badge ' + statusClass(s) + '">' + esc(STATUS_LABEL[s] || s) + '</span>';
}
function posterUrl(p, size) { return p ? 'https://image.tmdb.org/t/p/' + (size || 'w342') + p : null; }
function posterImgHtml(s, cls) {
  var url = posterUrl(s.poster_path);
  if (url) return '<img class="' + cls + '" src="' + url + '" alt="" loading="lazy">';
  return '<div class="' + cls + ' poster-ph">' + esc((s.title || '?').slice(0, 1)) + '</div>';
}
async function api(path, opts) {
  var r = await fetch(path, opts || {});
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  return r;
}

/* ---------- Toast & Button Loading ---------- */
function toast(message, type) {
  var stack = document.getElementById('toast-stack');
  if (!stack) return;
  var kind = type === 'error' || type === 'warn' || type === 'success' ? type : 'info';
  var icon = kind === 'success' ? ICONS.check : (kind === 'error' || kind === 'warn' ? ICONS.alert : ICONS.info);
  var el = document.createElement('div');
  el.className = 'toast t-' + kind;
  el.innerHTML = '<span class="toast-icon">' + icon + '</span><span class="toast-text">' + esc(message) + '</span>';
  el.addEventListener('click', function () { if (el.parentNode) el.parentNode.removeChild(el); });
  stack.appendChild(el);
  setTimeout(function () {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, kind === 'error' ? 4600 : 3000);
}
function setBtnLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = !!loading;
  btn.classList.toggle('is-loading', !!loading);
}

/* ---------- Custom Select & Popover (replaces ugly native dropdown list) ---------- */
var activePopSel = null;
var activePopFocusIdx = -1;
function getPopover() { return document.getElementById('pp-popover'); }
function syncCustomSelect(sel) {
  if (!sel || !sel._csWrap) return;
  var opt = sel.options[sel.selectedIndex] || sel.options[0];
  var label = opt ? opt.text : '';
  sel._csLabel.textContent = label;
  sel._csTrigger.disabled = !!sel.disabled;
  sel._csTrigger.title = sel.title || label;
}
function closePopover() {
  var pop = getPopover();
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  pop.innerHTML = '';
  if (activePopSel && activePopSel._csTrigger) {
    activePopSel._csTrigger.setAttribute('aria-expanded', 'false');
  }
  activePopSel = null;
  activePopFocusIdx = -1;
}
function highlightPopOption(idx) {
  var pop = getPopover();
  var items = pop.querySelectorAll('.pp-pop-opt');
  if (!items.length) return;
  if (idx < 0) idx = items.length - 1;
  if (idx >= items.length) idx = 0;
  activePopFocusIdx = idx;
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle('is-focused', i === idx);
  }
  if (items[idx] && items[idx].scrollIntoView) items[idx].scrollIntoView({ block: 'nearest' });
}
function openPopover(sel) {
  var pop = getPopover();
  if (!pop || !sel || sel.disabled) return;
  if (activePopSel === sel && !pop.hidden) { closePopover(); return; }
  closePopover();
  activePopSel = sel;
  var opts = [];
  for (var i = 0; i < sel.options.length; i++) {
    var o = sel.options[i];
    if (o.disabled) continue;
    var isSel = i === sel.selectedIndex;
    if (isSel) activePopFocusIdx = opts.length;
    opts.push('<button type="button" class="pp-pop-opt' + (isSel ? ' is-selected' : '') + '" role="option" aria-selected="' + (isSel ? 'true' : 'false') + '" data-val="' + esc(o.value) + '">'
      + '<span>' + esc(o.text) + '</span>'
      + '<span class="pp-pop-check">' + ICONS.check + '</span></button>');
  }
  pop.innerHTML = opts.join('');
  pop.hidden = false;
  sel._csTrigger.setAttribute('aria-expanded', 'true');
  var rect = sel._csTrigger.getBoundingClientRect();
  var minW = Math.max(rect.width, 136);
  pop.style.minWidth = minW + 'px';
  pop.style.maxWidth = Math.min(340, window.innerWidth - 16) + 'px';
  var popH = Math.min(pop.scrollHeight || 200, 260);
  var popW = Math.max(pop.offsetWidth || minW, minW);
  var spaceBelow = window.innerHeight - rect.bottom - 8;
  var top = spaceBelow >= popH || spaceBelow >= rect.top
    ? Math.min(window.innerHeight - popH - 8, rect.bottom + 5)
    : Math.max(8, rect.top - popH - 5);
  var left = Math.min(window.innerWidth - popW - 8, Math.max(8, rect.left));
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
  highlightPopOption(activePopFocusIdx >= 0 ? activePopFocusIdx : 0);
}
function enhanceSelects(root) {
  var list = (root || document).querySelectorAll('select');
  for (var i = 0; i < list.length; i++) {
    (function (sel) {
      if (sel._csWrap) { syncCustomSelect(sel); return; }
      var wrap = document.createElement('div');
      wrap.className = 'cs-wrap' + ((sel.hasAttribute('data-qedit') || sel.hasAttribute('data-iedit')) ? ' is-sm' : '');
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      sel.classList.add('cs-native');
      sel.tabIndex = -1;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cs-trigger';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      var lbl = document.createElement('span');
      lbl.className = 'cs-label';
      var caret = document.createElement('span');
      caret.className = 'cs-caret';
      caret.innerHTML = ICONS.chevron;
      btn.appendChild(lbl);
      btn.appendChild(caret);
      wrap.appendChild(btn);
      sel._csWrap = wrap;
      sel._csTrigger = btn;
      sel._csLabel = lbl;
      syncCustomSelect(sel);
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openPopover(sel);
      });
      btn.addEventListener('keydown', function (e) {
        var pop = getPopover();
        var isOpen = !pop.hidden && activePopSel === sel;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!isOpen) { openPopover(sel); return; }
          highlightPopOption(activePopFocusIdx + (e.key === 'ArrowDown' ? 1 : -1));
        } else if (e.key === 'Enter' && isOpen) {
          e.preventDefault();
          var focused = pop.querySelector('.pp-pop-opt.is-focused');
          if (focused) focused.click();
        }
      });
      sel.addEventListener('change', function () { syncCustomSelect(sel); });
    })(list[i]);
  }
}
document.getElementById('pp-popover').addEventListener('click', function (e) {
  var optBtn = e.target.closest('.pp-pop-opt');
  if (!optBtn || !activePopSel) return;
  var sel = activePopSel;
  var val = optBtn.getAttribute('data-val');
  var changed = sel.value !== val;
  sel.value = val;
  syncCustomSelect(sel);
  closePopover();
  if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
});
document.addEventListener('click', function (e) {
  var pop = getPopover();
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target)) return;
  if (activePopSel && activePopSel._csTrigger && activePopSel._csTrigger.contains(e.target)) return;
  closePopover();
});
window.addEventListener('resize', closePopover);
window.addEventListener('scroll', closePopover, true);

/* ---------- Custom Confirm Modal (replaces window.confirm) ---------- */
var confirmResolver = null;
function closeConfirm(result) {
  var bd = document.getElementById('confirm-backdrop');
  if (!bd || bd.hidden) return;
  bd.hidden = true;
  var fn = confirmResolver;
  confirmResolver = null;
  if (fn) fn(!!result);
}
function confirmDialog(opts) {
  var bd = document.getElementById('confirm-backdrop');
  var titleEl = document.getElementById('confirm-title');
  var msgEl = document.getElementById('confirm-msg');
  var okBtn = document.getElementById('confirm-ok');
  titleEl.textContent = opts.title || '确认操作';
  msgEl.textContent = opts.message || '';
  okBtn.textContent = opts.confirmText || '确认';
  okBtn.className = opts.danger ? 'btn btn-danger-solid' : 'btn btn-primary';
  bd.hidden = false;
  okBtn.focus();
  return new Promise(function (resolve) { confirmResolver = resolve; });
}
document.getElementById('confirm-cancel').addEventListener('click', function () { closeConfirm(false); });
document.getElementById('confirm-ok').addEventListener('click', function () { closeConfirm(true); });
document.getElementById('confirm-backdrop').addEventListener('click', function (e) {
  if (e.target === this) closeConfirm(false);
});

/* ---------- Theme Switcher ---------- */
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}
function syncThemeButtons() {
  var isLight = currentTheme() === 'light';
  var icon = isLight ? ICONS.moon : ICONS.sun;
  var tip = isLight ? '切换到暗色主题' : '切换到亮色主题';
  ['theme-toggle', 'theme-toggle-m'].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) { b.innerHTML = icon; b.title = tip; b.setAttribute('aria-label', tip); }
  });
}
function toggleTheme() {
  var next = currentTheme() === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('pp_theme', next); } catch (e) {}
  syncThemeButtons();
}
syncThemeButtons();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
document.getElementById('theme-toggle-m').addEventListener('click', toggleTheme);

/* ---------- Navigation & Keyboard Shortcuts ---------- */
var currentView = 'dashboard';
function switchView(name) {
  closePopover();
  if (VIEWS.indexOf(name) < 0) name = 'dashboard';
  currentView = name;
  for (var i = 0; i < VIEWS.length; i++) {
    document.getElementById('view-' + VIEWS[i]).classList.toggle('active', VIEWS[i] === name);
  }
  var items = document.querySelectorAll('[data-nav]');
  for (var j = 0; j < items.length; j++) {
    items[j].classList.toggle('active', items[j].getAttribute('data-nav') === name);
  }
  document.getElementById('page-title').textContent = VIEW_TITLES[name];
  var wantHash = '#' + name;
  if (name === 'subscriptions' && subGroup === 'finished') wantHash = '#subscriptions-finished';
  if (location.hash !== wantHash) history.replaceState(null, '', wantHash);
  if (name === 'settings') switchSettingsTab(currentSettingsTab);
  if (name === 'logs') loadLogs(true);
  if (name === 'explore') ensureExploreLoaded();
}
var navItems = document.querySelectorAll('[data-nav]');
for (var n = 0; n < navItems.length; n++) {
  navItems[n].addEventListener('click', function () { switchView(this.getAttribute('data-nav')); });
}
function goDiscover() {
  switchView('discover');
  setTimeout(function () {
    var q = document.getElementById('tmdb-q');
    if (q) q.focus();
  }, 50);
}
document.getElementById('side-new-sub').addEventListener('click', goDiscover);
document.getElementById('top-new-sub').addEventListener('click', goDiscover);
document.getElementById('recent-view-all').addEventListener('click', function () { switchView('subscriptions'); });

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    var pop = getPopover();
    if (pop && !pop.hidden) { closePopover(); return; }
    var cbd = document.getElementById('confirm-backdrop');
    if (cbd && !cbd.hidden) { closeConfirm(false); return; }
    var mbd = document.getElementById('modal-backdrop');
    if (mbd && !mbd.hidden) { closeModal(); return; }
  }
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (currentView === 'subscriptions') {
      e.preventDefault();
      document.getElementById('sub-search').focus();
    } else if (currentView === 'discover') {
      e.preventDefault();
      document.getElementById('tmdb-q').focus();
    }
  }
});

/* ---------- Settings Tabs (v0.8 — keep DOM mounted) ---------- */
var SETTINGS_TABS = ['account', 'tmdb', 'quark', 'channels', 'directories', 'quality', 'subscription', 'driver', 'wecom'];
var currentSettingsTab = 'account';
function switchSettingsTab(name, updateHash) {
  if (SETTINGS_TABS.indexOf(name) < 0) name = 'account';
  currentSettingsTab = name;
  for (var i = 0; i < SETTINGS_TABS.length; i++) {
    document.getElementById('spanel-' + SETTINGS_TABS[i]).classList.toggle('active', SETTINGS_TABS[i] === name);
  }
  var tabs = document.querySelectorAll('.settings-tab');
  for (var j = 0; j < tabs.length; j++) {
    var on = tabs[j].getAttribute('data-stab') === name;
    tabs[j].classList.toggle('active', on);
    tabs[j].setAttribute('aria-selected', on ? 'true' : 'false');
  }
  if (updateHash !== false && location.hash !== '#' + name) {
    history.replaceState(null, '', '#' + name);
  }
}
var stabEls = document.querySelectorAll('.settings-tab');
for (var ti = 0; ti < stabEls.length; ti++) {
  stabEls[ti].addEventListener('click', function () { switchSettingsTab(this.getAttribute('data-stab')); });
}

/* ---------- Dashboard Alerts & Stats ---------- */
function renderDashAlerts() {
  var box = document.getElementById('dash-alerts');
  if (!box) return;
  var alerts = [];
  if (settingsCache) {
    var tmdb = settingsCache.tmdb_api_key || {};
    var cq = settingsCache.quark_cookie || {};
    if (!tmdb.configured) {
      alerts.push({
        isError: false,
        title: 'TMDB API Key 未配置',
        msg: '发现页的影视检索与封面回填暂不可用，请先配置 API Key。',
        btnText: '前往配置',
        action: 'go-tmdb'
      });
    }
    if (cq.enc_configured && !cq.configured) {
      alerts.push({
        isError: false,
        title: '夸克 Cookie 未配置',
        msg: '服务端尚未保存夸克网盘 Cookie，自动转存需依赖外部 Driver 自备登录态。',
        btnText: '去填写 Cookie',
        action: 'go-quark'
      });
    } else if (cq.driver_status === 'invalid') {
      alerts.push({
        isError: true,
        title: '夸克 Cookie 已失效',
        msg: 'Driver 最近检查回报 Cookie 已过期，请重新粘贴最新 Cookie。',
        btnText: '立即更新',
        action: 'go-quark'
      });
    }
  }
  var errSubs = subsCache.filter(function (s) { return s.status === 'error'; });
  if (errSubs.length) {
    alerts.push({
      isError: true,
      title: '有 ' + errSubs.length + ' 条订阅处于异常状态',
      msg: '建议检查详情中的错误原因或查看 Driver 操作日志。',
      btnText: '筛选异常订阅',
      action: 'go-err-subs'
    });
  }
  box.innerHTML = alerts.map(function (a) {
    return '<div class="alert-banner' + (a.isError ? ' is-error' : '') + '">'
      + '<span class="alert-banner-icon">' + ICONS.alert + '</span>'
      + '<div class="alert-banner-body"><strong>' + esc(a.title) + '</strong><span>' + esc(a.msg) + '</span></div>'
      + '<button type="button" class="btn btn-sm" data-alert-act="' + a.action + '">' + esc(a.btnText) + '</button>'
      + '</div>';
  }).join('');
}
document.getElementById('dash-alerts').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-alert-act]');
  if (!btn) return;
  var act = btn.getAttribute('data-alert-act');
  if (act === 'go-tmdb') { switchView('settings'); switchSettingsTab('tmdb'); }
  else if (act === 'go-quark') { switchView('settings'); switchSettingsTab('quark'); }
  else if (act === 'go-err-subs') {
    switchSubGroup('active');
    setSubFilter('error');
    switchView('subscriptions');
  }
});

var dashCards = document.querySelectorAll('.stat-card[data-jump]');
for (var dci = 0; dci < dashCards.length; dci++) {
  dashCards[dci].addEventListener('click', function () {
    var jump = this.getAttribute('data-jump');
    if (jump === 'subscriptions-finished') {
      switchSubGroup('finished');
      switchView('subscriptions');
    } else if (jump === 'subscriptions-active') {
      switchSubGroup('active');
      switchView('subscriptions');
    } else if (jump === 'logs') {
      switchView('logs');
    }
  });
}

/* ---------- Subscriptions & Detail Modal ---------- */
function progressOf(s) {
  var stored = storedMap[s.id] || 0;
  var total = s.total_episodes || 0;
  var pct = total > 0 ? Math.min(100, Math.round(stored / total * 100)) : (stored > 0 ? 100 : 0);
  var text = s.media_type === 'movie'
    ? (stored > 0 ? '已入库' : '未入库')
    : ('已入库 ' + stored + (total ? ' / ' + total + ' 集' : ' 集'));
  return { stored: stored, total: total, pct: pct, text: text };
}

var INTERVAL_PRESETS = [1, 2, 3, 6, 12, 24];
function intervalOptionsHtml(current) {
  var opts = INTERVAL_PRESETS.slice();
  if (current && opts.indexOf(current) < 0) {
    opts.push(current);
    opts.sort(function (a, b) { return a - b; });
  }
  return '<option value=""' + (!current ? ' selected' : '') + '>间隔 · 跟随全局</option>'
    + opts.map(function (h) {
        return '<option value="' + h + '"' + (current === h ? ' selected' : '') + '>每 ' + h + ' 小时</option>';
      }).join('');
}
function intervalShort(s) {
  return s.check_interval_hours
    ? '每 ' + s.check_interval_hours + ' 小时 · 单独设置'
    : '每 ' + globalCheckHours + ' 小时 · 跟随全局';
}

function subCard(s) {
  var p = progressOf(s);
  var done = isFinishedSub(s);
  var attrList = [
    mediaLabel(s.media_type),
    s.region || '',
    (s.season != null && s.media_type !== 'movie') ? ('第 ' + s.season + ' 季') : '',
    s.mode === 'auto' ? '自动转存' : '手动确认'
  ].filter(Boolean);
  var pauseBtn = s.status === 'paused'
    ? '<button type="button" class="btn btn-sm" data-act="resume" data-id="' + s.id + '">' + ICONS.play + '<span>恢复</span></button>'
    : '<button type="button" class="btn btn-sm" data-act="pause" data-id="' + s.id + '">' + ICONS.pause + '<span>暂停</span></button>';
  var qualityEdit = '<select data-qedit="' + s.id + '" title="画质偏好：只覆盖首选清晰度，其余跟随全局档案">'
    + '<option value=""' + (!s.quality ? ' selected' : '') + '>画质 · 跟随全局</option>'
    + ['2160p', '1080p', '720p'].map(function (r) {
        return '<option value="' + r + '"' + (s.quality === r ? ' selected' : '') + '>'
          + (r === '2160p' ? '优先 4K' : '优先 ' + r) + '</option>';
      }).join('')
    + '</select>';
  var intervalEdit = '<select data-iedit="' + s.id + '" title="检查间隔：这条订阅隔多久检查一次新集。处理完成后满 N 小时即到期；跟随全局 = 用全局间隔 ' + globalCheckHours + ' 小时，单独设置 = 用这条自己的间隔">'
    + intervalOptionsHtml(s.check_interval_hours)
    + '</select>';
  var checkNowBtn = (done || s.status === 'paused')
    ? ''
    : '<button type="button" class="btn btn-sm" data-act="checknow" data-id="' + s.id + '" title="把下次检查时间重置为现在：Driver 下次唤醒时一定会刷新这条订阅">' + ICONS.refresh + '<span>立即刷新</span></button>';
  var nowSec = Math.floor(Date.now() / 1000);
  var timeLine = done
    ? '完成于 ' + fmtTime(s.updated_at)
    : ((s.next_check_at && s.next_check_at <= nowSec)
        ? '已到期 · 等待 Driver 刷新'
        : '下次检查：' + fmtTime(s.next_check_at))
      + ' · ' + intervalShort(s);
  var errLine = s.status === 'error' && s.last_error
    ? '<div class="sub-err-note" title="' + esc(s.last_error) + '">' + esc(s.last_error) + '</div>'
    : '';
  return '<article class="sub-card' + (s.status === 'error' ? ' has-error' : '') + '">'
    + '<div class="sub-main">'
    + '<div class="poster-wrap" data-detail="' + s.id + '">'
    + posterImgHtml(s, 'poster')
    + (s.rating ? '<span class="poster-score num">★ ' + Number(s.rating).toFixed(1) + '</span>' : '')
    + '</div>'
    + '<div class="sub-body">'
    + '<div class="sub-head">'
    + '<div class="sub-title" data-detail="' + s.id + '">' + esc(s.title) + (s.year ? ' <span class="sub-year num">' + s.year + '</span>' : '') + '</div>'
    + badge(s.status)
    + '</div>'
    + '<div class="sub-attrs">' + esc(attrList.join(' · ')) + '</div>'
    + '<div class="sub-progress-wrap">'
    + '<div class="sub-meta"><span class="num">' + p.text + '</span><span class="num">' + p.pct + '%</span></div>'
    + '<div class="progress"><div class="progress-bar' + (done || p.pct >= 100 ? ' progress-bar-done' : '') + '" style="width:' + p.pct + '%"></div></div>'
    + '<div class="sub-next">' + timeLine + '</div>'
    + errLine
    + '</div></div></div>'
    + '<div class="sub-footer">'
    + pauseBtn
    + qualityEdit
    + intervalEdit
    + '<span class="spacer"></span>'
    + checkNowBtn
    + '<button type="button" class="btn btn-ghost btn-sm" data-detail="' + s.id + '" title="查看详情与集进度">' + ICONS.info + '<span>详情</span></button>'
    + '<button type="button" class="btn btn-icon sub-del-btn" data-act="delete" data-id="' + s.id + '" title="删除订阅" aria-label="删除订阅">' + ICONS.trash + '</button>'
    + '</div></article>';
}

var subGroup = 'active';
var subFilter = 'all';
var subSearchText = '';

function subsInGroup(group) {
  return subsCache.filter(function (s) { return group === 'finished' ? isFinishedSub(s) : !isFinishedSub(s); });
}
function setSubFilter(f) {
  subFilter = f || 'all';
  var pills = document.querySelectorAll('[data-subfilter]');
  for (var i = 0; i < pills.length; i++) {
    pills[i].classList.toggle('active', pills[i].getAttribute('data-subfilter') === subFilter);
  }
  renderSubs();
}
function switchSubGroup(group, updateHash) {
  subGroup = group === 'finished' ? 'finished' : 'active';
  var btns = document.querySelectorAll('[data-group]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute('data-group') === subGroup);
  }
  var fp = document.getElementById('sub-filter-pills');
  if (fp) fp.hidden = subGroup === 'finished';
  renderSubs();
  if (updateHash !== false) {
    var want = subGroup === 'finished' ? '#subscriptions-finished' : '#subscriptions';
    if (location.hash !== want) history.replaceState(null, '', want);
  }
}
function renderSubs() {
  var active = subsInGroup('active');
  var finished = subsInGroup('finished');
  document.getElementById('sub-count-active').textContent = active.length;
  document.getElementById('sub-count-finished').textContent = finished.length;
  var navPill = document.getElementById('nav-sub-count');
  if (navPill) navPill.textContent = active.length;

  var q = subSearchText.trim().toLowerCase();
  var clearBtn = document.getElementById('sub-search-clear');
  if (clearBtn) clearBtn.hidden = !subSearchText;

  var list = subsInGroup(subGroup).filter(function (s) {
    if (subGroup === 'active' && subFilter !== 'all') {
      if (subFilter === 'paused' && s.status !== 'paused') return false;
      if (subFilter === 'error' && s.status !== 'error') return false;
      if (subFilter === 'running' && (s.status === 'paused' || s.status === 'error')) return false;
    }
    if (!q) return true;
    return (s.title || '').toLowerCase().indexOf(q) >= 0
      || (s.original_title || '').toLowerCase().indexOf(q) >= 0;
  });

  var grid = document.getElementById('sub-grid');
  var empty = document.getElementById('sub-empty');
  var emptyText = document.getElementById('sub-empty-text');
  var emptyCta = document.getElementById('sub-empty-cta');
  if (list.length) {
    grid.style.display = '';
    empty.hidden = true;
    grid.innerHTML = list.map(subCard).join('');
    enhanceSelects(grid);
    return;
  }
  grid.style.display = 'none';
  grid.innerHTML = '';
  empty.hidden = false;
  emptyCta.hidden = true;
  if (q) {
    emptyText.textContent = '当前分组里没有匹配「' + subSearchText.trim() + '」的订阅。';
  } else if (subGroup === 'active' && subFilter !== 'all') {
    emptyText.textContent = '当前状态下没有订阅项，试试切回「全部」。';
  } else if (subGroup === 'finished') {
    emptyText.textContent = '还没有已完成的订阅。剧集集齐或确认完结后会自动归档到这里。';
  } else if (!subsCache.length) {
    emptyText.textContent = '暂无订阅，去「发现」页搜索一部想追的剧吧。';
    emptyCta.hidden = false;
  } else {
    emptyText.textContent = '订阅中的剧集都处理完了，去「已完成」看看，或添加一部新剧。';
    emptyCta.hidden = false;
  }
}

var groupBtns = document.querySelectorAll('[data-group]');
for (var gi = 0; gi < groupBtns.length; gi++) {
  groupBtns[gi].addEventListener('click', function () { switchSubGroup(this.getAttribute('data-group')); });
}
var filterBtns = document.querySelectorAll('[data-subfilter]');
for (var fi = 0; fi < filterBtns.length; fi++) {
  filterBtns[fi].addEventListener('click', function () { setSubFilter(this.getAttribute('data-subfilter')); });
}
document.getElementById('sub-search').addEventListener('input', function () {
  subSearchText = this.value;
  renderSubs();
});
document.getElementById('sub-search-clear').addEventListener('click', function () {
  var inp = document.getElementById('sub-search');
  inp.value = '';
  subSearchText = '';
  renderSubs();
  inp.focus();
});
document.getElementById('sub-empty-cta').addEventListener('click', goDiscover);

function renderDashboard(stats) {
  document.getElementById('stat-total').textContent = stats.total_subscriptions;
  document.getElementById('stat-following').textContent = stats.following;
  document.getElementById('stat-finished').textContent = stats.finished;
  document.getElementById('stat-stored').textContent = stats.stored_episodes;
  var recent = subsCache.slice().sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); }).slice(0, 6);
  var box = document.getElementById('recent-list');
  if (!recent.length) {
    box.innerHTML = '<div class="empty-state" style="padding:1.6rem"><p>还没有任何订阅记录，点击左侧「新建订阅」开始吧。</p></div>';
    return;
  }
  box.innerHTML = recent.map(function (s) {
    var p = progressOf(s);
    var done = isFinishedSub(s);
    return '<div class="recent-row" data-detail="' + s.id + '">'
      + posterImgHtml(s, '')
      + '<div class="recent-main">'
      + '<div class="recent-title">' + esc(s.title) + (s.year ? ' <span class="sub-year num">' + s.year + '</span>' : '') + '</div>'
      + '<div class="recent-sub">' + mediaLabel(s.media_type)
      + (s.region ? ' · ' + esc(s.region) : '')
      + (s.season != null && s.media_type !== 'movie' ? ' · 第 ' + s.season + ' 季' : '')
      + ' · 更新于 ' + fmtTime(s.updated_at) + '</div>'
      + '</div>'
      + '<div class="recent-prog">'
      + '<span class="muted num" style="font-size:.76rem">' + p.text + '</span>'
      + '<div class="progress"><div class="progress-bar' + (done || p.pct >= 100 ? ' progress-bar-done' : '') + '" style="width:' + p.pct + '%"></div></div>'
      + '</div>'
      + badge(s.status)
      + '</div>';
  }).join('');
}

document.getElementById('recent-list').addEventListener('click', function (e) {
  var row = e.target.closest('[data-detail]');
  if (row) openSubDetail(row.getAttribute('data-detail'));
});

async function loadSubs() {
  var r = await api('/api/subscriptions');
  var data = await r.json();
  subsCache = data.subscriptions || [];
  if (typeof data.check_interval_hours === 'number' && data.check_interval_hours > 0) {
    globalCheckHours = data.check_interval_hours;
  }
  var rs = await api('/api/stats');
  var sd = await rs.json();
  storedMap = (sd.stats && sd.stats.stored_by_subscription) || {};
  renderSubs();
  renderDashboard(sd.stats);
  renderDashAlerts();
  renderLogSubFilter();
  refreshExploreSubBadges();
}

async function openSubDetail(id) {
  var box = document.getElementById('modal-content');
  box.innerHTML = '<div class="skeleton" style="height:170px;margin-bottom:1rem"></div><div class="skeleton" style="height:90px"></div>';
  document.getElementById('modal-backdrop').hidden = false;
  try {
    var r = await api('/api/subscriptions/' + encodeURIComponent(id));
    var data = await r.json().catch(function () { return null; });
    if (!r.ok || !data || !data.subscription) {
      box.innerHTML = '<p class="error-text">' + esc(data && data.error ? data.error.message : '加载订阅详情失败') + '</p>';
      return;
    }
    var s = data.subscription;
    var eps = data.episodes || [];
    var p = progressOf(s);
    var tags = '<span class="tag">' + mediaLabel(s.media_type) + '</span>'
      + (s.region ? '<span class="tag">' + esc(s.region) + '</span>' : '')
      + (s.season != null && s.media_type !== 'movie' ? '<span class="tag">第 ' + s.season + ' 季</span>' : '')
      + (s.rating ? '<span class="tag tag-rate">★ ' + Number(s.rating).toFixed(1) + '</span>' : '')
      + badge(s.status);

    var epMap = {};
    for (var i = 0; i < eps.length; i++) {
      if (s.season == null || eps[i].season === s.season) epMap[eps[i].episode] = eps[i];
    }
    var epCount = s.total_episodes || 0;
    var maxRecorded = 0;
    eps.forEach(function (ep) { if (ep.episode > maxRecorded) maxRecorded = ep.episode; });
    var totalCells = Math.max(epCount, maxRecorded);

    var epMatrixHtml = '';
    if (s.media_type !== 'movie' && totalCells > 0) {
      var cells = [];
      for (var epNum = 1; epNum <= totalCells; epNum++) {
        var rec = epMap[epNum];
        var st = rec ? rec.status : 'missing';
        var tip = '第 ' + epNum + ' 集：' + (EP_STATUS_LABEL[st] || st)
          + (rec && rec.file_name ? '\n' + rec.file_name : '');
        cells.push('<div class="ep-cell ep-' + esc(st) + '" title="' + esc(tip) + '">' + epNum + '</div>');
      }
      epMatrixHtml = '<div class="modal-section">'
        + '<div class="modal-section-title">分集入库进度（' + esc(p.text) + '）</div>'
        + '<div class="ep-grid">' + cells.join('') + '</div></div>';
    }

    var errBlock = s.last_error
      ? '<div class="modal-section"><div class="modal-section-title">最近异常</div>'
        + '<div class="alert-banner is-error"><span class="alert-banner-icon">' + ICONS.alert + '</span>'
        + '<div class="alert-banner-body">' + esc(s.last_error) + '</div></div></div>'
      : '';

    var dirBlock = s.target_dir
      ? '<div class="modal-section"><div class="modal-section-title">目标入库路径</div>'
        + '<code>' + esc(s.target_dir) + '</code></div>'
      : '';

    box.innerHTML = '<div class="modal-hero">'
      + posterImgHtml(s, '')
      + '<div style="flex:1;min-width:0">'
      + '<div class="modal-title">' + esc(s.title) + (s.year ? ' <span class="sub-year num">' + s.year + '</span>' : '') + '</div>'
      + (s.original_title && s.original_title !== s.title ? '<div class="muted" style="font-size:.82rem;margin-top:.15rem">' + esc(s.original_title) + '</div>' : '')
      + '<div class="tag-row" style="margin-top:.55rem">' + tags + '</div>'
      + '<div class="form-grid-2" style="margin-top:.75rem">'
      + '<div class="field"><label class="field-label" for="sd-mode">执行模式</label>'
      + '<select id="sd-mode"><option value="auto"' + (s.mode === 'auto' ? ' selected' : '') + '>自动转存</option>'
      + '<option value="manual"' + (s.mode === 'manual' ? ' selected' : '') + '>手动确认</option></select></div>'
      + '<div class="field"><label class="field-label" for="sd-quality">画质覆盖</label>'
      + '<select id="sd-quality"><option value=""' + (!s.quality ? ' selected' : '') + '>画质 · 跟随全局</option>'
      + '<option value="2160p"' + (s.quality === '2160p' ? ' selected' : '') + '>优先 4K</option>'
      + '<option value="1080p"' + (s.quality === '1080p' ? ' selected' : '') + '>优先 1080p</option>'
      + '<option value="720p"' + (s.quality === '720p' ? ' selected' : '') + '>优先 720p</option></select></div>'
      + '<div class="field"><label class="field-label" for="sd-interval">检查间隔</label>'
      + '<select id="sd-interval">' + intervalOptionsHtml(s.check_interval_hours) + '</select></div>'
      + '</div></div></div>'
      + (s.overview ? '<div class="modal-section"><div class="modal-section-title">剧情简介</div><p class="overview">' + esc(s.overview) + '</p></div>' : '')
      + errBlock
      + dirBlock
      + epMatrixHtml
      + '<div class="modal-actions">'
      + '<button type="button" class="btn" id="sd-logs">查看日志</button>'
      + '<button type="button" class="btn btn-primary" id="sd-save">保存更改</button>'
      + '</div>';
    enhanceSelects(box);

    document.getElementById('sd-logs').addEventListener('click', function () {
      closeModal();
      logSubId = s.id;
      var sel = document.getElementById('log-sub-filter');
      if (sel) { sel.value = s.id; syncCustomSelect(sel); }
      switchView('logs');
    });
    document.getElementById('sd-save').addEventListener('click', async function () {
      var btn = this;
      setBtnLoading(btn, true);
      try {
        var mode = document.getElementById('sd-mode').value;
        var quality = document.getElementById('sd-quality').value;
        var payload = { mode: mode, quality: quality === '' ? null : quality };
        var intervalEl = document.getElementById('sd-interval');
        if (intervalEl) {
          var newInterval = intervalEl.value === '' ? null : Number(intervalEl.value);
          if (newInterval !== (s.check_interval_hours || null)) payload.check_interval_hours = newInterval;
        }
        var pr = await api('/api/subscriptions/' + encodeURIComponent(s.id), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!pr.ok) { toast('保存更改失败', 'error'); return; }
        toast('已保存订阅配置', 'success');
        closeModal();
        loadSubs();
      } finally {
        setBtnLoading(btn, false);
      }
    });
  } catch (e) {
    box.innerHTML = '<p class="error-text">加载失败，请重试。</p>';
  }
}

document.getElementById('sub-grid').addEventListener('click', async function (e) {
  var detailEl = e.target.closest('[data-detail]');
  if (detailEl) {
    openSubDetail(detailEl.getAttribute('data-detail'));
    return;
  }
  var btn = e.target.closest('button[data-act]');
  if (!btn) return;
  var id = btn.getAttribute('data-id');
  var act = btn.getAttribute('data-act');
  if (act === 'delete') {
    var ok = await confirmDialog({
      title: '删除订阅',
      message: '确定删除这个订阅吗？仅删除控制台订阅记录，不会改动夸克网盘内已入库的文件。',
      confirmText: '确认删除',
      danger: true
    });
    if (!ok) return;
    setBtnLoading(btn, true);
    try {
      var dr = await api('/api/subscriptions/' + id, { method: 'DELETE' });
      if (!dr.ok) { toast('删除失败', 'error'); return; }
      toast('已删除订阅', 'success');
    } finally {
      setBtnLoading(btn, false);
    }
  } else if (act === 'pause') {
    setBtnLoading(btn, true);
    try {
      var pr = await api('/api/subscriptions/' + id, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'paused' })
      });
      if (!pr.ok) { toast('暂停失败', 'error'); return; }
      toast('已暂停订阅', 'info');
    } finally {
      setBtnLoading(btn, false);
    }
  } else if (act === 'resume') {
    setBtnLoading(btn, true);
    try {
      var rr = await api('/api/subscriptions/' + id, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'pending_search', next_check_at: Math.floor(Date.now() / 1000) })
      });
      if (!rr.ok) { toast('恢复失败', 'error'); return; }
      toast('已恢复追更，将在下轮优先检查', 'success');
    } finally {
      setBtnLoading(btn, false);
    }
  } else if (act === 'checknow') {
    setBtnLoading(btn, true);
    try {
      var cr = await api('/api/subscriptions/' + id, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ next_check_at: Math.floor(Date.now() / 1000) })
      });
      if (!cr.ok) { toast('重置失败', 'error'); return; }
      toast('已重置为立即到期，Driver 下次唤醒时将刷新这条订阅', 'success');
    } finally {
      setBtnLoading(btn, false);
    }
  }
  loadSubs();
});

document.getElementById('sub-grid').addEventListener('change', async function (e) {
  var sel = e.target.closest('select[data-qedit]');
  if (!sel) return;
  sel.disabled = true;
  syncCustomSelect(sel);
  try {
    var r = await api('/api/subscriptions/' + sel.getAttribute('data-qedit'), {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quality: sel.value === '' ? null : sel.value })
    });
    if (!r.ok) { toast('画质偏好保存失败', 'error'); }
    else { toast('已更新画质偏好', 'success'); }
  } finally {
    sel.disabled = false;
    syncCustomSelect(sel);
  }
  loadSubs();
});

document.getElementById('sub-grid').addEventListener('change', async function (e) {
  var sel = e.target.closest('select[data-iedit]');
  if (!sel) return;
  sel.disabled = true;
  syncCustomSelect(sel);
  try {
    var r = await api('/api/subscriptions/' + sel.getAttribute('data-iedit'), {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ check_interval_hours: sel.value === '' ? null : Number(sel.value) })
    });
    if (!r.ok) { toast('检查间隔保存失败', 'error'); }
    else { toast('已更新检查间隔，下次检查已按新间隔重新排期', 'success'); }
  } finally {
    sel.disabled = false;
    syncCustomSelect(sel);
  }
  loadSubs();
});

/* ---------- Logs Page (v1.1) ---------- */
var logLevel = '';
var logSubId = '';
var logNextBefore = null;
var logLoading = false;
function logBadgeHtml(level) {
  var lv = level === 'warn' || level === 'error' ? level : 'info';
  var cls = lv === 'error' ? 'b-error' : (lv === 'warn' ? 'b-partial' : 'b-active');
  return '<span class="badge ' + cls + ' log-badge">' + lv + '</span>';
}
function logRowHtml(l) {
  var lv = l.level === 'warn' || l.level === 'error' ? l.level : 'info';
  var subLine = l.subscription_title ? esc(l.subscription_title) : '系统';
  if (l.driver_id) subLine += ' · ' + esc(l.driver_id);
  var detail = l.detail ? ' <span class="log-detail">' + esc(l.detail) + '</span>' : '';
  return '<div class="log-row lv-' + lv + '" title="点击展开 / 收起">'
    + '<div class="log-time">' + fmtTime(l.created_at) + '</div>'
    + logBadgeHtml(lv)
    + '<div class="log-main"><div class="log-sub">' + subLine + '</div>'
    + '<div class="log-msg"><span class="log-event">' + esc(l.event || '') + '</span>' + detail + '</div></div>'
    + '<span class="log-caret">' + ICONS.chevron + '</span>'
    + '</div>';
}
async function loadLogs(reset) {
  if (logLoading) return;
  logLoading = true;
  var list = document.getElementById('log-list');
  var moreBtn = document.getElementById('log-more');
  var refBtn = document.getElementById('log-refresh');
  if (reset) setBtnLoading(refBtn, true);
  else setBtnLoading(moreBtn, true);
  try {
    if (reset) {
      logNextBefore = null;
      list.innerHTML = '<div class="skeleton" style="height:48px"></div><div class="skeleton" style="height:48px"></div><div class="skeleton" style="height:48px"></div>';
      moreBtn.hidden = true;
    }
    var qs = '?limit=50';
    if (logLevel) qs += '&level=' + encodeURIComponent(logLevel);
    if (logSubId) qs += '&subscription_id=' + encodeURIComponent(logSubId);
    if (!reset && logNextBefore) qs += '&before=' + encodeURIComponent(logNextBefore);
    var r = await api('/api/logs' + qs);
    var data = await r.json();
    var rows = data.logs || [];
    if (reset) {
      list.innerHTML = rows.length
        ? rows.map(logRowHtml).join('')
        : '<div class="empty-state" style="padding:1.8rem"><p>暂无符合条件的日志。Driver 执行后，这里会记录每轮的操作流水。</p></div>';
    } else if (rows.length) {
      list.insertAdjacentHTML('beforeend', rows.map(logRowHtml).join(''));
    }
    logNextBefore = data.next_before;
    moreBtn.hidden = !data.has_more;
  } catch (e) {
    if (reset) list.innerHTML = '<p class="error-text">日志加载失败，请点击「刷新」重试。</p>';
  } finally {
    logLoading = false;
    setBtnLoading(refBtn, false);
    setBtnLoading(moreBtn, false);
  }
}
function renderLogSubFilter() {
  var sel = document.getElementById('log-sub-filter');
  if (!sel) return;
  var cur = logSubId || sel.value;
  var html = '<option value="">全部订阅</option>';
  for (var i = 0; i < subsCache.length; i++) {
    html += '<option value="' + subsCache[i].id + '"' + (subsCache[i].id === cur ? ' selected' : '') + '>'
      + esc(subsCache[i].title) + '</option>';
  }
  sel.innerHTML = html;
  syncCustomSelect(sel);
}
var logLvlBtns = document.querySelectorAll('[data-loglevel]');
for (var li = 0; li < logLvlBtns.length; li++) {
  logLvlBtns[li].addEventListener('click', function () {
    logLevel = this.getAttribute('data-loglevel') || '';
    for (var j = 0; j < logLvlBtns.length; j++) {
      logLvlBtns[j].classList.toggle('active', logLvlBtns[j] === this);
    }
    loadLogs(true);
  });
}
document.getElementById('log-sub-filter').addEventListener('change', function () {
  logSubId = this.value;
  loadLogs(true);
});
document.getElementById('log-refresh').addEventListener('click', function () { loadLogs(true); });
document.getElementById('log-more').addEventListener('click', function () { loadLogs(false); });
document.getElementById('log-list').addEventListener('click', function (e) {
  var row = e.target.closest('.log-row');
  if (row) row.classList.toggle('expanded');
});

/* ---------- Discover / TMDB ---------- */
var modalDetails = null;
function closeModal() { closePopover(); document.getElementById('modal-backdrop').hidden = true; }
document.getElementById('modal-close-x').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', function (e) {
  if (e.target === this) closeModal();
});

var TMDB_STATUS_ZH = {
  'Returning Series': '连载中',
  'In Production': '制作中',
  'Planned': '筹备中',
  'Ended': '已完结',
  'Canceled': '已取消',
  'Pilot': '试播集',
  'Released': '已上映',
  'Post Production': '后期制作',
  'Rumored': '传闻中'
};
var COUNTRY_ZH = {
  CN: '中国大陆', HK: '中国香港', TW: '中国台湾', US: '美国', GB: '英国', UK: '英国',
  JP: '日本', KR: '韩国', FR: '法国', DE: '德国', CA: '加拿大', AU: '澳大利亚',
  ES: '西班牙', IT: '意大利', IN: '印度', TH: '泰国', RU: '俄罗斯', SG: '新加坡',
  SE: '瑞典', DK: '丹麦', NO: '挪威', BE: '比利时', NL: '荷兰', BR: '巴西', MX: '墨西哥'
};
var LANG_ZH = {
  zh: '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语',
  es: '西班牙语', it: '意大利语', ru: '俄语', th: '泰语', hi: '印地语',
  pt: '葡萄牙语', sv: '瑞典语', da: '丹麦语', no: '挪威语', cn: '粤语'
};
function profileUrl(p) { return p ? 'https://image.tmdb.org/t/p/w185' + p : null; }
function backdropUrl(p) { return p ? 'https://image.tmdb.org/t/p/w780' + p : null; }
function fmtVoteCount(n) {
  if (!n || n <= 0) return '';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
function mapCountries(arr) {
  if (!arr || !arr.length) return [];
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var k = String(arr[i] || '').trim();
    if (!k) continue;
    var zh = COUNTRY_ZH[k] || k;
    if (out.indexOf(zh) < 0) out.push(zh);
  }
  return out;
}
function pad2(n) { return n < 10 ? '0' + n : String(n); }
function renderModalFacts(facts) {
  if (!facts || !facts.length) return '';
  return '<div class="modal-facts">' + facts.map(function (f) {
    return '<div class="modal-fact"><div class="modal-fact-label">' + esc(f.label) + '</div>'
      + '<div class="modal-fact-val">' + (f.html ? f.value : esc(f.value)) + '</div></div>';
  }).join('') + '</div>';
}
function renderCastSection(cast, fallbackActors) {
  if (cast && cast.length) {
    return '<div class="modal-section"><div class="modal-section-title">主要演员（' + cast.length + '）</div>'
      + '<div class="cast-strip">' + cast.map(function (c) {
        var av = c.profile_path
          ? '<img class="cast-avatar" src="' + esc(profileUrl(c.profile_path)) + '" alt="' + esc(c.name) + '" loading="lazy">'
          : '<div class="cast-avatar-ph">' + esc((c.name || '?').slice(0, 1)) + '</div>';
        return '<div class="cast-card" title="' + esc(c.name + (c.character ? ' · 饰 ' + c.character : '')) + '">'
          + av
          + '<div class="cast-name">' + esc(c.name) + '</div>'
          + (c.character ? '<div class="cast-role">' + esc(c.character) + '</div>' : '')
          + '</div>';
      }).join('') + '</div></div>';
  }
  if (fallbackActors && fallbackActors.length) {
    return '<div class="modal-section"><div class="modal-section-title">主演阵容</div>'
      + '<div class="cast-chips">' + fallbackActors.map(function (a) {
        return '<span class="cast-chip">' + esc(a) + '</span>';
      }).join('') + '</div></div>';
  }
  return '';
}

async function openDetail(item, overrideMediaType, extra) {
  modalDetails = null;
  var box = document.getElementById('modal-content');
  box.innerHTML = '<div class="skeleton" style="height:170px;margin-bottom:1rem"></div><div class="skeleton" style="height:80px"></div>';
  document.getElementById('modal-backdrop').hidden = false;
  var r = await api('/api/tmdb/details?type=' + encodeURIComponent(item.media_type) + '&id=' + item.tmdb_id);
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) {
    box.innerHTML = '<p class="error-text">' + esc(data && data.error ? data.error.message : '读取 TMDB 详情失败') + '</p>'
      + '<div class="modal-actions"><button type="button" class="btn" id="m-err-close">关闭</button></div>';
    document.getElementById('m-err-close').addEventListener('click', closeModal);
    return;
  }
  var d = data.details;
  if (overrideMediaType) d.media_type = overrideMediaType;
  modalDetails = d;
  var poster = d.poster_path
    ? '<img src="' + posterUrl(d.poster_path, 'w342') + '" alt="">'
    : (extra && extra.poster_url
      ? '<img src="' + esc(extra.poster_url) + '" alt="">'
      : '<div class="poster-ph">' + esc((d.title || '?').slice(0, 1)) + '</div>');
  var seasonOptions = '';
  var seasons = (d.seasons || []).filter(function (s) { return s.season >= 1; });
  for (var i = 0; i < seasons.length; i++) {
    var sYear = seasons[i].air_date ? seasons[i].air_date.slice(0, 4) : '';
    seasonOptions += '<option value="' + seasons[i].season + '" data-eps="' + seasons[i].episode_count + '">第 '
      + seasons[i].season + ' 季 · ' + seasons[i].episode_count + '集' + (sYear ? ' (' + sYear + ')' : '') + '</option>';
  }
  var modeField = '<div class="field"><label class="field-label" for="m-mode">执行模式</label>'
    + '<select id="m-mode"><option value="auto" selected>自动转存</option><option value="manual">手动确认</option></select></div>';
  var qualityField = '<div class="field"><label class="field-label" for="m-quality">画质覆盖</label>'
    + '<select id="m-quality"><option value="">画质 · 跟随全局</option><option value="2160p">优先 4K</option>'
    + '<option value="1080p">优先 1080p</option><option value="720p">优先 720p</option></select></div>';
  var intervalField = '<div class="field"><label class="field-label" for="m-interval">检查间隔</label>'
    + '<select id="m-interval">' + intervalOptionsHtml(null) + '</select></div>';
  var controls = (d.media_type === 'tv' || d.media_type === 'variety') && seasonOptions
    ? '<div class="form-grid-3" style="margin-top:.85rem"><div class="field"><label class="field-label" for="m-season">订阅季</label>'
      + '<select id="m-season">' + seasonOptions + '</select></div>' + modeField + qualityField + intervalField + '</div>'
    : '<div class="form-grid-2" style="margin-top:.85rem">' + modeField + qualityField + intervalField + '</div>';

  var banner = d.backdrop_path
    ? '<div class="modal-banner" style="background-image:url(\'' + esc(backdropUrl(d.backdrop_path)) + '\')"></div>'
    : '';
  var subParts = [];
  if (d.original_title && d.original_title !== d.title) subParts.push(d.original_title);
  if (d.tagline) subParts.push('“' + d.tagline + '”');
  var subLine = subParts.length ? '<div class="modal-sub-title">' + esc(subParts.join(' · ')) + '</div>' : '';

  var subbed = isItemSubscribed({ tmdb_id: d.tmdb_id, media_type: d.media_type, title: d.title });
  var genres = (d.genres && d.genres.length ? d.genres : (extra && extra.genres)) || [];
  var statusZh = d.status ? (TMDB_STATUS_ZH[d.status] || d.status) : '';
  var vc = fmtVoteCount(d.vote_count);
  var tagHtml = '<span class="tag">' + mediaLabel(d.media_type) + '</span>'
    + (d.region ? '<span class="tag">' + esc(d.region) + '</span>' : '')
    + (d.rating ? '<span class="tag tag-rate">TMDB ★ ' + Number(d.rating).toFixed(1) + (vc ? ' (' + vc + ')' : '') + '</span>' : '')
    + (extra && extra.rating ? '<span class="tag tag-douban">豆瓣 ★ ' + Number(extra.rating).toFixed(1) + '</span>' : '')
    + (statusZh ? '<span class="tag tag-status">' + esc(statusZh) + '</span>' : '')
    + (extra && extra.honor ? '<span class="tag tag-honor">' + esc(extra.honor) + '</span>' : '')
    + (genres.length ? '<span class="tag">' + esc(genres.join(' / ')) + '</span>' : '');

  var facts = [];
  var directors = (d.directors && d.directors.length ? d.directors : (extra && extra.directors)) || [];
  if (directors.length) facts.push({ label: d.media_type === 'movie' ? '导演' : '导演 / 主创', value: directors.join(' / ') });
  if (d.writers && d.writers.length) facts.push({ label: '编剧', value: d.writers.join(' / ') });
  if (d.release_date) facts.push({ label: d.media_type === 'movie' ? '上映日期' : '首播日期', value: d.release_date });
  if (d.media_type === 'movie' && d.runtime) {
    facts.push({ label: '片长', value: d.runtime + ' 分钟' });
  } else if (d.media_type !== 'movie' && d.episode_run_time) {
    facts.push({ label: '单集时长', value: '约 ' + d.episode_run_time + ' 分钟' });
  }
  if (d.media_type !== 'movie') {
    var progParts = [];
    if (d.number_of_seasons) progParts.push('共 ' + d.number_of_seasons + ' 季');
    if (d.number_of_episodes) progParts.push(d.number_of_episodes + ' 集');
    if (d.last_episode) {
      progParts.push('已播至 S' + pad2(d.last_episode.season) + 'E' + pad2(d.last_episode.episode));
    } else if (extra && extra.episodes_info) {
      progParts.push(extra.episodes_info);
    }
    if (d.next_episode) {
      progParts.push('下集 S' + pad2(d.next_episode.season) + 'E' + pad2(d.next_episode.episode)
        + (d.next_episode.air_date ? ' (' + d.next_episode.air_date + ')' : ''));
    }
    if (progParts.length) facts.push({ label: '剧集进度', value: progParts.join(' · ') });
  }
  if (d.networks && d.networks.length) facts.push({ label: '播出平台', value: d.networks.join(' / ') });
  var countriesText = mapCountries((d.production_countries && d.production_countries.length ? d.production_countries : d.origin_country) || (extra && extra.countries));
  var langZh = d.original_language ? (LANG_ZH[d.original_language] || d.original_language.toUpperCase()) : '';
  var areaLang = [countriesText.join(' / '), langZh].filter(Boolean).join(' · ');
  if (areaLang) facts.push({ label: '制片地区 / 语言', value: areaLang });
  var tmdbHref = 'https://www.themoviedb.org/' + (d.media_type === 'movie' ? 'movie' : 'tv') + '/' + d.tmdb_id;
  var extHtml = '<div class="ext-links"><a class="ext-link" href="' + esc(tmdbHref) + '" target="_blank" rel="noopener noreferrer">TMDB ↗</a>';
  if (extra && extra.douban_id) {
    extHtml += '<a class="ext-link" href="https://movie.douban.com/subject/' + encodeURIComponent(extra.douban_id) + '/" target="_blank" rel="noopener noreferrer">豆瓣 ↗</a>';
  }
  extHtml += '</div>';
  facts.push({ label: '外部资料', value: extHtml, html: true });

  var overviewText = d.overview || (extra && extra.overview) || '';
  var castHtml = renderCastSection(d.cast, extra && extra.actors);

  box.innerHTML = banner
    + '<div class="modal-hero">' + poster
    + '<div style="flex:1;min-width:0"><div class="modal-title"><span>' + esc(d.title) + '</span>'
    + (d.year ? '<span class="sub-year num">' + d.year + '</span>' : '')
    + (subbed ? '<span class="tag tag-subbed">已订阅</span>' : '') + '</div>'
    + subLine
    + '<div class="tag-row">' + tagHtml + '</div>'
    + controls + '</div></div>'
    + renderModalFacts(facts)
    + castHtml
    + (overviewText ? '<div class="modal-section"><div class="modal-section-title">剧情简介</div><p class="overview">' + esc(overviewText) + '</p></div>' : '')
    + '<div class="modal-actions"><button type="button" class="btn" id="m-cancel">取消</button>'
    + '<button type="button" class="btn btn-primary" id="m-subscribe">' + (subbed ? '再次确认订阅' : '确认订阅') + '</button></div>';
  enhanceSelects(box);
  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-subscribe').addEventListener('click', subscribeFromModal);
}

async function subscribeFromModal() {
  var d = modalDetails;
  if (!d) return;
  var btn = document.getElementById('m-subscribe');
  setBtnLoading(btn, true);
  try {
    var payload = {
      title: d.title, original_title: d.original_title || undefined,
      year: d.year, tmdb_id: d.tmdb_id, media_type: d.media_type,
      region: d.region || undefined, mode: document.getElementById('m-mode').value,
      quality: document.getElementById('m-quality').value || undefined,
      check_interval_hours: (function () { var el = document.getElementById('m-interval'); return el && el.value !== '' ? Number(el.value) : undefined; })(),
      poster_path: d.poster_path || undefined, overview: d.overview || undefined,
      rating: typeof d.rating === 'number' ? d.rating : undefined
    };
    if (d.media_type === 'tv' || d.media_type === 'variety') {
      var sel = document.getElementById('m-season');
      if (sel) {
        payload.season = Number(sel.value);
        var opt = sel.options[sel.selectedIndex];
        var eps = opt ? Number(opt.getAttribute('data-eps')) : 0;
        if (eps) payload.total_episodes = eps;
      }
    }
    var r = await api('/api/subscriptions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) { toast(data && data.error ? data.error.message : '订阅失败', 'error'); return; }
    closeModal();
    toast('已添加订阅「' + d.title + '」', 'success');
    await loadSubs();
    switchSubGroup('active');
    switchView('subscriptions');
  } finally {
    setBtnLoading(btn, false);
  }
}

document.getElementById('tmdb-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var q = document.getElementById('tmdb-q').value.trim();
  var box = document.getElementById('tmdb-results');
  var guide = document.getElementById('tmdb-guide');
  var btn = document.getElementById('tmdb-search-btn');
  if (!q) { toast('请先输入搜索关键词', 'warn'); return; }
  guide.innerHTML = '';
  box.innerHTML = '<div class="skeleton" style="aspect-ratio:2/3"></div>'.repeat(6);
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/tmdb/search?q=' + encodeURIComponent(q));
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      box.innerHTML = '';
      if (data && data.error && data.error.code === 'tmdb_not_configured') {
        guide.innerHTML = '<div class="guide-card"><h3>TMDB API Key 尚未配置</h3>'
          + '<p class="muted" style="margin:0 0 .75rem">选剧搜索需要先在「设置 → 媒体信息」保存 TMDB API Key（themoviedb.org 免费申请）；也可以直接使用下方表单手动添加订阅。</p>'
          + '<button type="button" class="btn btn-primary btn-sm" id="guide-go-settings">去配置 TMDB Key</button></div>';
        document.getElementById('guide-go-settings').addEventListener('click', function () {
          switchView('settings');
          switchSettingsTab('tmdb');
        });
      } else {
        toast(data && data.error ? data.error.message : 'TMDB 搜索失败', 'error');
      }
      return;
    }
    var results = data.results || [];
    if (!results.length) {
      box.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:1.8rem"><p>没有在 TMDB 找到相关结果，可尝试换个关键词或使用下方手动表单添加。</p></div>';
      return;
    }
    box.innerHTML = results.map(function (item, idx) {
      var poster = item.poster_path
        ? '<img src="' + posterUrl(item.poster_path, 'w342') + '" alt="" loading="lazy">'
        : '<div class="poster-ph">' + esc((item.title || '?').slice(0, 1)) + '</div>';
      var rate = item.rating ? '<span class="tmdb-rate-badge num">★ ' + Number(item.rating).toFixed(1) + '</span>' : '';
      return '<div class="tmdb-card" data-idx="' + idx + '">'
        + '<div class="tmdb-poster-box">' + poster
        + '<span class="tmdb-type-badge">' + (item.media_type === 'movie' ? '电影' : '剧集') + '</span>'
        + rate + '</div>'
        + '<div class="tmdb-info"><div class="t">' + esc(item.title) + '</div>'
        + '<div class="m num">' + [item.year, item.region].filter(Boolean).join(' · ') + '</div></div></div>';
    }).join('');
    var cards = box.querySelectorAll('.tmdb-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('click', function () {
        openDetail(results[Number(this.getAttribute('data-idx'))]);
      });
    }
  } finally {
    setBtnLoading(btn, false);
  }
});

document.getElementById('add-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = document.getElementById('add-submit-btn');
  var f = new FormData(e.target);
  var payload = {};
  f.forEach(function (v, k) { if (v !== '') payload[k] = v; });
  var numKeys = ['year', 'season', 'total_episodes'];
  for (var i = 0; i < numKeys.length; i++) {
    if (payload[numKeys[i]] != null) payload[numKeys[i]] = Number(payload[numKeys[i]]);
  }
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/subscriptions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) { toast(data && data.error ? data.error.message : '添加失败', 'error'); return; }
    toast('已添加订阅「' + (payload.title || '') + '」', 'success');
    e.target.reset();
    enhanceSelects(e.target);
    await loadSubs();
    switchSubGroup('active');
    switchView('subscriptions');
  } finally {
    setBtnLoading(btn, false);
  }
});

/* ---------- Settings ---------- */
async function loadSettings() {
  var r = await api('/api/settings');
  var data = await r.json();
  settingsCache = data.settings;
  var t = data.settings.tmdb_api_key;
  document.getElementById('tmdb-status').innerHTML =
    t.configured ? '<span class="status-ok">已配置</span>（' + esc(t.masked) + '）' : '<span class="muted">未配置</span>';
  document.getElementById('tab-dot-tmdb').hidden = !!t.configured;

  var cq = data.settings.quark_cookie || {};
  var quarkAttention = !cq.enc_configured || !cq.configured || cq.driver_status === 'invalid';
  document.getElementById('tab-dot-quark').hidden = !quarkAttention;

  var navDot = !t.configured || quarkAttention;
  ['nav-settings-dot', 'nav-settings-dot-m'].forEach(function (id) {
    var d = document.getElementById(id);
    if (d) d.hidden = !navDot;
  });

  document.getElementById('interval').textContent = data.settings.check_interval_hours;
  var isel = document.getElementById('set-interval');
  if (isel) {
    var hv = String(data.settings.check_interval_hours);
    var hasOpt = false;
    for (var oi = 0; oi < isel.options.length; oi++) if (isel.options[oi].value === hv) { hasOpt = true; break; }
    if (!hasOpt) {
      var extraOpt = document.createElement('option');
      extraOpt.value = hv;
      extraOpt.textContent = hv + ' 小时';
      isel.appendChild(extraOpt);
    }
    isel.value = hv;
    syncCustomSelect(isel);
  }
  var istate = document.getElementById('set-interval-state');
  if (istate) istate.textContent = data.settings.check_interval_custom ? '当前：自定义值（覆盖默认）' : '当前：默认值';
  var acc = data.settings.account;
  var uname = acc ? acc.username : '';
  document.getElementById('account-username').textContent = acc ? acc.username : '（未配置）';
  document.getElementById('account-source').textContent = acc ? (acc.source === 'settings' ? '后台已修改' : '部署初始值') : '—';
  document.getElementById('side-user').textContent = uname || '已登录';
  document.getElementById('side-avatar').textContent = (uname || 'P').slice(0, 1);
  document.getElementById('topbar-user').textContent = uname ? '@' + uname : '';

  renderCookieSettings(data.settings.quark_cookie);
  renderChannelSettings(data.settings.tg_channels);
  renderDirectorySettings(data.settings.directories, data.settings.directories_custom);
  renderQualitySettings(data.settings.quality, data.settings.quality_custom);
  renderWecomSettings(data.settings.wecom);
  renderDashAlerts();
  loadDriverKeys();
}

var intervalSaveBtn = document.getElementById('set-interval-save');
if (intervalSaveBtn) intervalSaveBtn.addEventListener('click', async function () {
  var sel = document.getElementById('set-interval');
  var btn = this;
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ check_interval_hours: Number(sel.value) })
    });
    if (!r.ok) { toast('保存全局间隔失败', 'error'); return; }
    toast('全局检查间隔已更新', 'success');
    loadSettings();
    loadSubs();
  } finally {
    setBtnLoading(btn, false);
  }
});
var intervalResetBtn = document.getElementById('set-interval-reset');
if (intervalResetBtn) intervalResetBtn.addEventListener('click', async function () {
  var btn = this;
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reset_check_interval: true })
    });
    if (!r.ok) { toast('恢复默认失败', 'error'); return; }
    toast('已恢复默认全局间隔', 'success');
    loadSettings();
    loadSubs();
  } finally {
    setBtnLoading(btn, false);
  }
});

function renderCookieSettings(c) {
  var st = document.getElementById('cookie-status');
  var drv = document.getElementById('cookie-driver-status');
  if (!c) { st.textContent = '—'; return; }
  if (!c.enc_configured) {
    st.innerHTML = '<span class="status-bad">功能未启用</span>';
    drv.textContent = '服务端未配置 COOKIE_ENC_SECRET，无法加密保存（绝不以明文存储）。';
    return;
  }
  if (!c.configured) {
    st.textContent = '未配置';
    drv.textContent = 'Driver 无法从控制台拉取 Cookie，只能使用执行端本地登录态。';
    return;
  }
  st.innerHTML = '<span class="status-ok">已加密保存</span>'
    + (c.length ? '（' + c.length + ' 字符）' : '')
    + (c.updated_at ? ' · ' + fmtTime(c.updated_at) : '');
  if (c.driver_status === 'invalid') {
    drv.innerHTML = '<span class="status-bad">Driver 回报：Cookie 已失效</span>（' + fmtTime(c.driver_checked_at)
      + '），请重新从夸克网页端复制最新 Cookie 粘贴保存。';
  } else if (c.driver_status === 'ok') {
    drv.innerHTML = '<span class="status-ok">Driver 回报：Cookie 有效</span>（' + fmtTime(c.driver_checked_at) + '）。';
  } else {
    drv.textContent = 'Driver 尚未回报过 Cookie 有效性。';
  }
}

function countChannelsText() {
  var lines = document.getElementById('channels-input').value.split(/[\n,]+/);
  var seen = {}, n = 0;
  for (var i = 0; i < lines.length; i++) {
    var name = lines[i].trim().replace(/^@+/, '');
    if (!name) continue;
    var k = name.toLowerCase();
    if (seen[k]) continue;
    seen[k] = 1; n++;
  }
  document.getElementById('channels-count').textContent = n;
  return n;
}
function renderChannelSettings(t) {
  var st = document.getElementById('channels-status');
  if (!t) { st.textContent = '—'; return; }
  document.getElementById('channels-input').value = (t.effective || []).join('\n');
  document.getElementById('channels-priority').checked = !!t.priority_only;
  countChannelsText();
  st.textContent = (t.custom ? '自定义清单（' + t.base_count + ' 个）' : '默认清单（' + t.default_count + ' 个）')
    + ' · 当前生效 ' + t.count + ' 个'
    + (t.priority_only ? (t.priority_fallback ? '（优先交集为空，已退回全量）' : '（夸克优先）') : '');
}

/* ---------- Settings: Library Directories ---------- */
var NL = String.fromCharCode(10);
function mapToText(obj) {
  var keys = Object.keys(obj || {});
  keys.sort(function (a, b) {
    if (a === '*') return 1;
    if (b === '*') return -1;
    return a < b ? -1 : 1;
  });
  return keys.map(function (k) { return k + '=' + obj[k]; }).join(NL);
}
function textToMap(text) {
  var out = {};
  var lines = String(text || '').split(NL);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var idx = line.indexOf('=');
    if (idx <= 0) continue;
    var k = line.slice(0, idx).trim();
    var v = line.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}
function collectDirectories() {
  return {
    base_dir: document.getElementById('dir-base').value.trim(),
    tv_dir: document.getElementById('dir-tv').value.trim(),
    movie_dir: document.getElementById('dir-movie').value.trim(),
    tv_region_map: textToMap(document.getElementById('dir-tv-region').value),
    tv_special_map: textToMap(document.getElementById('dir-tv-special').value),
    movie_category_map: textToMap(document.getElementById('dir-movie-category').value),
    title_template: document.getElementById('dir-title-template').value.trim(),
    season_template: document.getElementById('dir-season-template').value.trim(),
    episode_name_template: document.getElementById('dir-episode-template').value.trim(),
    movie_name_template: document.getElementById('dir-movie-name-template').value.trim(),
    variety_name_template: document.getElementById('dir-variety-template').value.trim()
  };
}
function renderNameTemplate(tpl, title, year) {
  return String(tpl || '').split('{title}').join(title).split('{year}').join(year)
    .split('{season:02}').join('01').split('{season}').join('1')
    .split('{episode:02}').join('01').split('{episode}').join('1');
}
function dirPreviewOf(d) {
  var title = renderNameTemplate(d.title_template, '谷雨', '2026');
  var season = renderNameTemplate(d.season_template, '谷雨', '2026');
  var ep = renderNameTemplate(d.episode_name_template, '谷雨', '2026');
  var region = (d.tv_region_map && (d.tv_region_map.CN || d.tv_region_map['*'])) || '';
  return [d.base_dir, d.tv_dir, region, title, season, ep + '.mkv'].filter(Boolean).join('/');
}
function updateDirPreview() {
  var d = collectDirectories();
  document.getElementById('directories-preview').textContent = dirPreviewOf(d);
  var title = renderNameTemplate(d.title_template, '独行月球', '2022');
  var cat = (d.movie_category_map && (d.movie_category_map.CN || d.movie_category_map['*'])) || '';
  var movieFile = renderNameTemplate(d.movie_name_template, '独行月球', '2022');
  document.getElementById('directories-preview-movie').textContent =
    [d.base_dir, d.movie_dir, cat, title, movieFile + '.mkv'].filter(Boolean).join('/');
  document.getElementById('directories-preview-variety').textContent =
    renderNameTemplate(d.variety_name_template, '奔跑吧', '2026') + '.mkv';
}
function renderDirectorySettings(d, custom) {
  var st = document.getElementById('directories-status');
  if (!d) { st.textContent = '—'; return; }
  document.getElementById('dir-base').value = d.base_dir || '';
  document.getElementById('dir-tv').value = d.tv_dir || '';
  document.getElementById('dir-movie').value = d.movie_dir || '';
  document.getElementById('dir-tv-region').value = mapToText(d.tv_region_map);
  document.getElementById('dir-tv-special').value = mapToText(d.tv_special_map);
  document.getElementById('dir-movie-category').value = mapToText(d.movie_category_map);
  document.getElementById('dir-title-template').value = d.title_template || '';
  document.getElementById('dir-season-template').value = d.season_template || '';
  document.getElementById('dir-episode-template').value = d.episode_name_template || '';
  document.getElementById('dir-movie-name-template').value = d.movie_name_template || '';
  document.getElementById('dir-variety-template').value = d.variety_name_template || '';
  st.textContent = custom ? '自定义目录设置' : '默认设置（按夸克结构预填）';
  updateDirPreview();
}
document.getElementById('directories-form').addEventListener('input', updateDirPreview);
document.getElementById('directories-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = e.target.querySelector('button[type="submit"]');
  var msg = document.getElementById('directories-msg');
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ directories: collectDirectories() })
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      var errText = data && data.error ? data.error.message : '保存失败';
      msg.textContent = errText;
      toast(errText, 'error');
      return;
    }
    msg.textContent = '已保存，Driver 下次拉取配置时生效。';
    toast('目录设置已保存', 'success');
    loadSettings();
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('directories-reset').addEventListener('click', async function () {
  var ok = await confirmDialog({
    title: '恢复默认目录设置',
    message: '恢复为默认入库目录设置吗？自定义的路径、映射与命名模板将被删除。',
    confirmText: '恢复默认',
    danger: true
  });
  if (!ok) return;
  var r = await api('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reset_directories: true })
  });
  if (!r.ok) { toast('恢复失败', 'error'); return; }
  document.getElementById('directories-msg').textContent = '已恢复默认目录设置。';
  toast('已恢复默认目录设置', 'success');
  loadSettings();
});

/* ---------- Settings: Quality Profile ---------- */
function collectQuality() {
  var kws = document.getElementById('q-exclude-keywords').value.split(/[\n,]+/)
    .map(function (s) { return s.trim(); }).filter(Boolean);
  var maxGb = Number(document.getElementById('q-max-gb').value);
  return {
    preferred_resolution: document.getElementById('q-resolution').value,
    allow_fallback: document.getElementById('q-fallback').checked,
    exclude_remux: document.getElementById('q-exclude-remux').checked,
    exclude_cam: document.getElementById('q-exclude-cam').checked,
    prefer_h265: document.getElementById('q-prefer-h265').checked,
    max_episode_gb: isFinite(maxGb) && maxGb >= 0 ? maxGb : 0,
    exclude_keywords: kws
  };
}
function renderQualitySettings(q, custom) {
  var st = document.getElementById('quality-status');
  if (!q) { st.textContent = '—'; return; }
  document.getElementById('q-resolution').value = q.preferred_resolution || '1080p';
  syncCustomSelect(document.getElementById('q-resolution'));
  document.getElementById('q-fallback').checked = q.allow_fallback !== false;
  document.getElementById('q-exclude-remux').checked = !!q.exclude_remux;
  document.getElementById('q-exclude-cam').checked = !!q.exclude_cam;
  document.getElementById('q-prefer-h265').checked = !!q.prefer_h265;
  document.getElementById('q-max-gb').value = q.max_episode_gb || 0;
  document.getElementById('q-exclude-keywords').value = (q.exclude_keywords || []).join(NL);
  st.textContent = custom ? '自定义画质档案' : '默认（1080p 优先 · 排除原盘与枪版）';
}
document.getElementById('quality-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = e.target.querySelector('button[type="submit"]');
  var msg = document.getElementById('quality-msg');
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quality: collectQuality() })
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      var errText = data && data.error ? data.error.message : '保存失败';
      msg.textContent = errText;
      toast(errText, 'error');
      return;
    }
    msg.textContent = '已保存，Driver 下次取配置时生效。';
    toast('画质偏好已保存', 'success');
    loadSettings();
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('quality-reset').addEventListener('click', async function () {
  var ok = await confirmDialog({
    title: '恢复默认画质偏好',
    message: '恢复为默认画质档案吗？当前自定义规则将被清除。',
    confirmText: '恢复默认',
    danger: true
  });
  if (!ok) return;
  var r = await api('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reset_quality: true })
  });
  if (!r.ok) { toast('恢复失败', 'error'); return; }
  document.getElementById('quality-msg').textContent = '已恢复默认画质偏好。';
  toast('已恢复默认画质偏好', 'success');
  loadSettings();
});

/* ---------- Settings: Driver API Keys & Agent Guide ---------- */
var agentGuideCache = null;
function copyPlainText(text, okMsg) {
  var done = function () { toast(okMsg, 'success'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    });
  } else {
    var ta2 = document.createElement('textarea');
    ta2.value = text;
    ta2.style.position = 'fixed';
    ta2.style.opacity = '0';
    document.body.appendChild(ta2);
    ta2.select();
    document.execCommand('copy');
    document.body.removeChild(ta2);
    done();
  }
}
async function ensureAgentGuide() {
  if (agentGuideCache !== null) return agentGuideCache;
  var r = await api('/api/agent-guide');
  var data = await r.json().catch(function () { return null; });
  if (!r.ok || !data || !data.guide) throw new Error('拉取 Agent Guide 失败');
  agentGuideCache = data.guide;
  return agentGuideCache;
}
var agPromptMode = 'short';
var dkOnceMeta = { key: '', name: '' };

function buildAiPrompt(opts) {
  var o = opts || {};
  var base = location.origin;
  var keyDisplay = o.key || '<所选 Key（点上方「复制提示词」自动填入）>';
  var driverId = o.driverId || '<所选 Key 名称>';
  var lines = [
    '你是 PanPilot 的 AI Driver，请立即开始执行一轮影视订阅检查、搜索与夸克转存入库。',
    '',
    '【连接凭据】',
    '- 控制面 BASE：' + base,
    '- 鉴权请求头：Authorization: Bearer ' + keyDisplay,
    '- driver_id：' + driverId,
    '- 重要提醒：所有请求必须携带常见浏览器 User-Agent（避免被 Cloudflare 边缘 1010 拦截）；严禁把 API Key、夸克 Cookie 或 TMDB Key 写入任何日志、progress note 或汇报文本。',
    '',
    '【开始步骤】',
    '1. 先拉取并通读操作手册：GET ' + base + '/api/driver/agent-guide',
    '2. 拉取执行配置：GET ' + base + '/api/driver/config（一次取齐夸克 Cookie、TMDB Key、频道清单、目录与全局画质设置）',
    '3. 拉取到期订阅：GET ' + base + '/api/driver/pending?limit=20，按手册十步流程逐条 claim（409 跳过）→ 盘点夸克实际目录 → 搜索 → 筛选 → 转存 → 重命名 → 复核 → 回写 progress 与 logs。'
  ];
  if (o.fullGuideText) {
    lines.push('', '---', '', o.fullGuideText.split('https://your-panpilot.example.com').join(base));
  }
  return lines.join('\n');
}
function renderAiPromptPreview() {
  var pre = document.getElementById('ag-prompt-preview');
  if (!pre) return;
  var txt = buildAiPrompt({});
  if (agPromptMode === 'full') {
    txt += '\n\n---（点击上方 Key 的「复制提示词」时，会自动在此处附带完整 agent-guide 操作手册全文）';
  }
  pre.textContent = txt;
}
function showOnceKey(token, name) {
  dkOnceMeta = { key: token || '', name: name || 'ai-driver' };
  var box = document.getElementById('dk-once');
  document.getElementById('dk-once-value').value = token;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}
document.getElementById('dk-copy').addEventListener('click', function () {
  var input = document.getElementById('dk-once-value');
  document.getElementById('dk-msg').textContent = '已复制到剪贴板。';
  copyPlainText(input.value, 'API Key 已复制到剪贴板');
});
document.getElementById('dk-copy-prompt').addEventListener('click', async function () {
  var btn = this;
  setBtnLoading(btn, true);
  try {
    var guide = agPromptMode === 'full' ? await ensureAgentGuide() : null;
    copyPlainText(buildAiPrompt({ key: dkOnceMeta.key, driverId: dkOnceMeta.name, fullGuideText: guide }), '已复制含 Key 的 AI 提示词');
  } catch (e) {
    toast(e && e.message ? e.message : '拉取手册失败', 'error');
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('dk-once-close').addEventListener('click', function () {
  document.getElementById('dk-once').hidden = true;
  document.getElementById('dk-once-value').value = '';
  dkOnceMeta = { key: '', name: '' };
});
var agModeBtns = document.querySelectorAll('[data-ag-mode]');
for (var ami = 0; ami < agModeBtns.length; ami++) {
  agModeBtns[ami].addEventListener('click', function () {
    agPromptMode = this.getAttribute('data-ag-mode') === 'full' ? 'full' : 'short';
    for (var j = 0; j < agModeBtns.length; j++) agModeBtns[j].classList.toggle('active', agModeBtns[j] === this);
    renderAiPromptPreview();
  });
}
document.getElementById('ag-copy-template').addEventListener('click', async function () {
  var btn = this;
  setBtnLoading(btn, true);
  try {
    var guide = agPromptMode === 'full' ? await ensureAgentGuide() : null;
    copyPlainText(buildAiPrompt({ fullGuideText: guide }), '已复制纯提示词模板（不含 Key）');
  } catch (e) {
    toast(e && e.message ? e.message : '拉取手册失败', 'error');
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('ag-copy-guide').addEventListener('click', async function () {
  var btn = this;
  setBtnLoading(btn, true);
  try {
    var guide = await ensureAgentGuide();
    copyPlainText(guide.split('https://your-panpilot.example.com').join(location.origin), '已复制操作手册原文');
  } catch (e) {
    toast(e && e.message ? e.message : '拉取手册失败', 'error');
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('ag-toggle-full').addEventListener('click', async function () {
  var btn = this;
  var wrap = document.getElementById('ag-full-wrap');
  var pre = document.getElementById('ag-full-text');
  if (!wrap.hidden) {
    wrap.hidden = true;
    btn.textContent = '展开完整手册全文';
    return;
  }
  setBtnLoading(btn, true);
  try {
    var guide = await ensureAgentGuide();
    pre.textContent = guide.split('https://your-panpilot.example.com').join(location.origin);
    wrap.hidden = false;
    btn.textContent = '收起完整手册';
  } catch (e) {
    toast(e && e.message ? e.message : '拉取手册失败', 'error');
  } finally {
    setBtnLoading(btn, false);
  }
});
renderAiPromptPreview();
async function loadDriverKeys() {
  var st = document.getElementById('driver-keys-status');
  var box = document.getElementById('driver-keys-list');
  var r = await api('/api/settings/driver-keys');
  var data = await r.json().catch(function () { return null; });
  if (!r.ok || !data) { st.textContent = '加载失败'; return; }
  var keys = data.driver_keys || [];
  var active = keys.filter(function (k) { return !k.revoked_at; }).length;
  st.textContent = active + ' 个有效 / 共 ' + keys.length + ' 个'
    + (data.bootstrap_key && data.bootstrap_key.configured ? '（另含引导 Key）' : '');
  if (!keys.length) {
    box.innerHTML = '<div class="empty-state" style="padding:1.4rem"><p>还没有通过控制台创建过 Key，在下方输入名称即可为 Driver 生成独立凭据。</p></div>';
    return;
  }
  box.innerHTML = keys.map(function (k) {
    var isActive = !k.revoked_at;
    var actions = isActive
      ? '<button type="button" class="btn btn-sm btn-primary" data-dk-copy-prompt="' + esc(k.id) + '" data-dk-name="' + esc(k.name) + '">' + ICONS.copy + '<span>复制提示词</span></button>'
        + '<button type="button" class="btn btn-sm" data-dk-copy-key="' + esc(k.id) + '" data-dk-name="' + esc(k.name) + '">' + ICONS.key + '<span>复制 Key</span></button>'
        + '<button type="button" class="btn btn-sm" data-dk-reset="' + esc(k.id) + '">重置</button>'
        + '<button type="button" class="btn btn-sm btn-danger" data-dk-revoke="' + esc(k.id) + '">吊销</button>'
      : '';
    var legacyHint = isActive && !k.can_copy ? ' · 旧 Key（点复制可一键重置启用）' : '';
    return '<div class="dk-row"><div class="dk-main">'
      + '<div class="dk-name">' + esc(k.name) + ' <code>' + esc(k.token_hint) + '</code>'
      + (isActive ? '<span class="badge b-done">有效</span>' : '<span class="badge b-paused">已吊销</span>')
      + '</div>'
      + '<div class="dk-sub num">创建于 ' + fmtTime(k.created_at)
      + ' · 最近使用：' + (k.last_used_at ? fmtTime(k.last_used_at) : '从未')
      + (k.revoked_at ? ' · 吊销于 ' + fmtTime(k.revoked_at) : '')
      + legacyHint + '</div></div>'
      + '<div class="dk-actions">' + actions + '</div></div>';
  }).join('');
}
async function revealOrResetKey(id, name, actionLabel) {
  var r = await api('/api/settings/driver-keys/' + encodeURIComponent(id) + '/reveal');
  var d = await r.json().catch(function () { return null; });
  if (r.ok && d && d.key) return { key: d.key, name: d.name || name };
  if (d && d.error && d.error.code === 'key_not_recoverable') {
    var ok = await confirmDialog({
      title: '该旧 Key 未存档明文',
      message: '「' + name + '」创建于加密存档之前，服务端仅存哈希无法反解。是否立即重置并生成新 Key 以便' + actionLabel + '？（旧 Key 将作废，重置后以后可随时一键复制）',
      confirmText: '重置并' + actionLabel,
      danger: true
    });
    if (!ok) return null;
    var rr = await api('/api/settings/driver-keys/' + encodeURIComponent(id) + '/reset', { method: 'POST' });
    var rd = await rr.json().catch(function () { return null; });
    if (!rr.ok || !rd || !rd.key) {
      toast(rd && rd.error ? rd.error.message : '重置失败', 'error');
      return null;
    }
    if (!rd.stored_encrypted) showOnceKey(rd.key, rd.driver_key && rd.driver_key.name);
    loadDriverKeys();
    return { key: rd.key, name: (rd.driver_key && rd.driver_key.name) || name };
  }
  toast(d && d.error ? d.error.message : '读取 Key 失败', 'error');
  return null;
}
document.getElementById('driver-keys-list').addEventListener('click', async function (e) {
  var copyPromptBtn = e.target.closest('button[data-dk-copy-prompt]');
  var copyKeyBtn = e.target.closest('button[data-dk-copy-key]');
  var resetBtn = e.target.closest('button[data-dk-reset]');
  var revokeBtn = e.target.closest('button[data-dk-revoke]');
  var msg = document.getElementById('dk-msg');
  if (copyPromptBtn) {
    var pid = copyPromptBtn.getAttribute('data-dk-copy-prompt');
    var pname = copyPromptBtn.getAttribute('data-dk-name') || 'ai-driver';
    setBtnLoading(copyPromptBtn, true);
    try {
      var resP = await revealOrResetKey(pid, pname, '复制提示词');
      if (!resP) return;
      var guide = agPromptMode === 'full' ? await ensureAgentGuide() : null;
      var promptText = buildAiPrompt({ key: resP.key, driverId: resP.name, fullGuideText: guide });
      copyPlainText(promptText, '已复制「' + resP.name + '」的 AI 启动提示词' + (guide ? '（含完整手册）' : ''));
      msg.textContent = '已复制「' + resP.name + '」的 AI 启动提示词，可直接粘贴给 AI 开始执行。';
    } catch (err) {
      toast(err && err.message ? err.message : '复制提示词失败', 'error');
    } finally {
      setBtnLoading(copyPromptBtn, false);
    }
    return;
  }
  if (copyKeyBtn) {
    var kid = copyKeyBtn.getAttribute('data-dk-copy-key');
    var kname = copyKeyBtn.getAttribute('data-dk-name') || 'ai-driver';
    setBtnLoading(copyKeyBtn, true);
    try {
      var resK = await revealOrResetKey(kid, kname, '复制 Key');
      if (!resK) return;
      copyPlainText(resK.key, '已复制「' + resK.name + '」的 API Key');
      msg.textContent = '已复制「' + resK.name + '」的 API Key。';
    } finally {
      setBtnLoading(copyKeyBtn, false);
    }
    return;
  }
  if (resetBtn) {
    var okReset = await confirmDialog({
      title: '重置 Driver API Key',
      message: '确定重置这个 Key 吗？旧 Key 将立即作废，对应 Driver 必须换用新 Key 才能继续访问。',
      confirmText: '确认重置',
      danger: true
    });
    if (!okReset) return;
    setBtnLoading(resetBtn, true);
    try {
      var rr = await api('/api/settings/driver-keys/' + resetBtn.getAttribute('data-dk-reset') + '/reset', { method: 'POST' });
      var rd = await rr.json().catch(function () { return null; });
      if (!rr.ok) {
        var re = rd && rd.error ? rd.error.message : '重置失败';
        msg.textContent = re; toast(re, 'error'); return;
      }
      if (rd.stored_encrypted) {
        document.getElementById('dk-once').hidden = true;
        msg.textContent = '已重置：新 Key 已加密存档，直接点上方「复制提示词」或「复制 Key」即可。';
        toast('Key 已重置，可随时一键复制', 'success');
      } else {
        msg.textContent = '已重置：旧 Key 已吊销，新 Key 请在上方复制（仅展示一次）。';
        toast('Key 已重置，请立即复制保存', 'success');
        showOnceKey(rd.key, rd.driver_key && rd.driver_key.name);
      }
      loadDriverKeys();
    } finally {
      setBtnLoading(resetBtn, false);
    }
    return;
  }
  if (revokeBtn) {
    var okRevoke = await confirmDialog({
      title: '吊销 Driver API Key',
      message: '确定吊销这个 Key 吗？使用它的 Driver 将立即失去全部接口权限，此操作不可恢复。',
      confirmText: '确认吊销',
      danger: true
    });
    if (!okRevoke) return;
    setBtnLoading(revokeBtn, true);
    try {
      var vr = await api('/api/settings/driver-keys/' + revokeBtn.getAttribute('data-dk-revoke') + '/revoke', { method: 'POST' });
      var vd = await vr.json().catch(function () { return null; });
      if (!vr.ok) {
        var ve = vd && vd.error ? vd.error.message : '吊销失败';
        msg.textContent = ve; toast(ve, 'error'); return;
      }
      msg.textContent = '已吊销。';
      toast('Key 已吊销', 'info');
      loadDriverKeys();
    } finally {
      setBtnLoading(revokeBtn, false);
    }
  }
});
document.getElementById('dk-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var msg = document.getElementById('dk-msg');
  var btn = e.target.querySelector('button[type="submit"]');
  var name = document.getElementById('dk-name').value.trim();
  if (!name) { msg.textContent = '请先填写 Driver 名称'; toast('请填写 Driver 名称', 'warn'); return; }
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/settings/driver-keys', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name })
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      var errText = data && data.error ? data.error.message : '创建失败';
      msg.textContent = errText; toast(errText, 'error'); return;
    }
    document.getElementById('dk-name').value = '';
    if (data.stored_encrypted) {
      document.getElementById('dk-once').hidden = true;
      msg.textContent = '已生成「' + name + '」，点击列表中右侧「复制提示词」或「复制 Key」即可使用。';
      toast('已生成「' + name + '」，可随时一键复制提示词或 Key', 'success');
    } else {
      msg.textContent = '已创建：请把上方 Key 配置到 Driver 里（仅显示一次）。';
      toast('已生成新的 Driver API Key', 'success');
      showOnceKey(data.key, data.driver_key && data.driver_key.name);
    }
    loadDriverKeys();
  } finally {
    setBtnLoading(btn, false);
  }
});

/* ---------- Settings: Account / TMDB / Cookie / Channels ---------- */
document.getElementById('account-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = e.target.querySelector('button[type="submit"]');
  var msg = document.getElementById('account-msg');
  var current = document.getElementById('acc-current').value;
  var username = document.getElementById('acc-username').value.trim();
  var pw1 = document.getElementById('acc-password').value;
  var pw2 = document.getElementById('acc-password2').value;
  if (!current) { msg.textContent = '请先输入当前密码'; toast('请输入当前密码', 'warn'); return; }
  if (!username && !pw1) { msg.textContent = '新用户名和新密码至少填一个'; toast('新用户名和新密码至少填一个', 'warn'); return; }
  if (pw1 !== pw2) { msg.textContent = '两次输入的新密码不一致'; toast('两次输入的新密码不一致', 'error'); return; }
  var payload = { current_password: current };
  if (username) payload.new_username = username;
  if (pw1) payload.new_password = pw1;
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/account', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      var errText = data && data.error ? data.error.message : '保存失败';
      msg.textContent = errText; toast(errText, 'error'); return;
    }
    msg.textContent = '已保存：' + data.note;
    toast('账号凭据已更新', 'success');
    e.target.reset();
    loadSettings();
  } finally {
    setBtnLoading(btn, false);
  }
});

document.getElementById('tmdb-key-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = e.target.querySelector('button[type="submit"]');
  var key = document.getElementById('tmdb-key').value.trim();
  if (!key) { toast('请输入 TMDB API Key', 'warn'); return; }
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tmdb_api_key: key })
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) { toast(data && data.error ? data.error.message : '保存失败', 'error'); return; }
    document.getElementById('tmdb-key').value = '';
    toast('TMDB API Key 已保存', 'success');
    loadSettings();
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('tmdb-clear').addEventListener('click', async function () {
  var ok = await confirmDialog({
    title: '清除 TMDB API Key',
    message: '清除后「发现」页的选剧搜索和元数据回填将停用，确定清除吗？',
    confirmText: '确认清除',
    danger: true
  });
  if (!ok) return;
  var r = await api('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clear_tmdb_api_key: true })
  });
  if (!r.ok) { toast('清除失败', 'error'); return; }
  toast('已清除 TMDB API Key', 'info');
  loadSettings();
});

document.getElementById('cookie-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = e.target.querySelector('button[type="submit"]');
  var msg = document.getElementById('cookie-msg');
  var v = document.getElementById('cookie-input').value.trim();
  if (!v) { msg.textContent = '请先粘贴 Cookie'; toast('请先粘贴夸克 Cookie', 'warn'); return; }
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quark_cookie: v })
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      var errText = data && data.error ? data.error.message : '保存失败';
      msg.textContent = errText; toast(errText, 'error'); return;
    }
    document.getElementById('cookie-input').value = '';
    msg.textContent = '已加密保存，Driver 下次拉取配置时生效。';
    toast('夸克 Cookie 已加密保存', 'success');
    loadSettings();
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('cookie-clear').addEventListener('click', async function () {
  var ok = await confirmDialog({
    title: '清除夸克 Cookie',
    message: '确定清除已保存的夸克 Cookie 吗？清除后 Driver 将无法再从控制台取用它。',
    confirmText: '确认清除',
    danger: true
  });
  if (!ok) return;
  var r = await api('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clear_quark_cookie: true })
  });
  if (!r.ok) { toast('清除失败', 'error'); return; }
  document.getElementById('cookie-msg').textContent = '已清除。';
  toast('已清除夸克 Cookie', 'info');
  loadSettings();
});

document.getElementById('channels-input').addEventListener('input', countChannelsText);
document.getElementById('channels-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = e.target.querySelector('button[type="submit"]');
  var msg = document.getElementById('channels-msg');
  var names = document.getElementById('channels-input').value.split(/[\n,]+/)
    .map(function (s) { return s.trim().replace(/^@+/, ''); }).filter(Boolean);
  var payload = {
    tg_channels: names,
    tg_channels_priority_only: document.getElementById('channels-priority').checked
  };
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      var errText = data && data.error ? data.error.message : '保存失败';
      msg.textContent = errText; toast(errText, 'error'); return;
    }
    msg.textContent = '已保存，Driver 下次取配置时生效。';
    toast('频道列表已保存', 'success');
    loadSettings();
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('channels-reset').addEventListener('click', async function () {
  var ok = await confirmDialog({
    title: '恢复默认频道清单',
    message: '恢复为内置默认清单（147 个已验证频道）吗？当前自定义清单将被删除。',
    confirmText: '恢复默认',
    danger: true
  });
  if (!ok) return;
  var r = await api('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reset_tg_channels: true })
  });
  if (!r.ok) { toast('恢复失败', 'error'); return; }
  document.getElementById('channels-msg').textContent = '已恢复默认清单。';
  toast('已恢复默认频道清单', 'success');
  loadSettings();
});

/* ---------- Settings: WeCom ---------- */
function updateWecomVerifyPreview() {
  var name = (document.getElementById('wc-verify-name').value || '').trim().replace(/^\/+/, '');
  var el = document.getElementById('wc-verify-preview');
  if (!el) return;
  el.textContent = name ? ('验证访问地址：' + location.origin + '/' + name) : '未填写校验文件（仅启用纯聊天搜剧与主动推送时可暂不填）。';
}
function renderWecomSettings(w) {
  var cbInput = document.getElementById('wc-callback-url');
  if (cbInput) cbInput.value = location.origin + '/api/wecom/callback';
  var st = document.getElementById('wecom-status');
  if (!w) { if (st) st.textContent = '—'; return; }
  if (!w.enc_configured) {
    st.innerHTML = '<span class="status-bad">未启用密钥加密</span>';
  } else if (w.enabled && w.corp_id && w.has_secret) {
    st.innerHTML = '<span class="status-ok">已启用</span>';
  } else if (w.corp_id || w.has_secret) {
    st.innerHTML = '<span class="muted">已配置（未开启）</span>';
  } else {
    st.innerHTML = '<span class="muted">未配置</span>';
  }
  document.getElementById('wc-enabled').checked = !!w.enabled;
  document.getElementById('wc-corp-id').value = w.corp_id || '';
  document.getElementById('wc-agent-id').value = w.agent_id != null ? String(w.agent_id) : '';
  document.getElementById('wc-proxy-url').value = w.proxy_url || 'https://qywx.ttai.net';
  document.getElementById('wc-users').value = (w.allowed_users || []).join(', ');
  document.getElementById('wc-notify').checked = w.notify_enabled !== false;
  document.getElementById('wc-oauth').checked = w.oauth_enabled !== false;
  document.getElementById('wc-verify-name').value = w.verify_file_name || '';
  document.getElementById('wc-verify-content').value = w.verify_file_content || '';

  document.getElementById('wc-secret-hint').textContent = w.has_secret ? ('已加密保存（' + w.secret_masked + '）') : '未配置';
  document.getElementById('wc-token-hint').textContent = w.has_token ? ('已加密保存（' + w.token_masked + '）') : '未配置';
  document.getElementById('wc-aes-hint').textContent = w.has_aes_key ? ('已加密保存（' + w.aes_key_masked + '）') : '未配置';
  updateWecomVerifyPreview();
}
document.getElementById('wc-verify-name').addEventListener('input', updateWecomVerifyPreview);
document.getElementById('wc-copy-cb').addEventListener('click', function () {
  var inp = document.getElementById('wc-callback-url');
  inp.select();
  var ok = function () { toast('回调 URL 已复制到剪贴板', 'success'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(inp.value).then(ok, function () { document.execCommand('copy'); ok(); });
  } else { document.execCommand('copy'); ok(); }
});
document.getElementById('wecom-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = document.getElementById('wc-save');
  var msg = document.getElementById('wecom-msg');
  var agentVal = document.getElementById('wc-agent-id').value.trim();
  var payload = {
    enabled: document.getElementById('wc-enabled').checked,
    corp_id: document.getElementById('wc-corp-id').value.trim(),
    agent_id: agentVal ? Number(agentVal) : null,
    proxy_url: document.getElementById('wc-proxy-url').value.trim() || 'https://qywx.ttai.net',
    allowed_users: document.getElementById('wc-users').value.trim(),
    notify_enabled: document.getElementById('wc-notify').checked,
    oauth_enabled: document.getElementById('wc-oauth').checked,
    verify_file_name: document.getElementById('wc-verify-name').value.trim(),
    verify_file_content: document.getElementById('wc-verify-content').value.trim()
  };
  var sec = document.getElementById('wc-secret').value.trim();
  var tok = document.getElementById('wc-token').value.trim();
  var aes = document.getElementById('wc-aes-key').value.trim();
  if (sec) payload.secret = sec;
  if (tok) payload.token = tok;
  if (aes) payload.encoding_aes_key = aes;

  setBtnLoading(btn, true);
  try {
    var r = await api('/api/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wecom: payload })
    });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      var errText = data && data.error ? data.error.message : '保存失败';
      msg.textContent = errText; toast(errText, 'error'); return;
    }
    document.getElementById('wc-secret').value = '';
    document.getElementById('wc-token').value = '';
    document.getElementById('wc-aes-key').value = '';
    msg.textContent = '企业微信配置已保存。';
    toast('企业微信配置已保存', 'success');
    loadSettings();
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('wc-sync-menu').addEventListener('click', async function () {
  var btn = this;
  var msg = document.getElementById('wecom-msg');
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/wecom/menu/sync', { method: 'POST' });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      var errText = data && data.error ? data.error.message : '菜单同步失败';
      msg.textContent = errText; toast(errText, 'error'); return;
    }
    msg.textContent = '自定义菜单已下发到企业微信（重新打开应用会话即可看到最新菜单）。';
    toast('自定义菜单同步成功', 'success');
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('wc-test').addEventListener('click', async function () {
  var btn = this;
  var msg = document.getElementById('wecom-msg');
  setBtnLoading(btn, true);
  try {
    var r = await api('/api/wecom/test', { method: 'POST' });
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      var errText = data && data.error ? data.error.message : '测试发送失败';
      msg.textContent = errText; toast(errText, 'error'); return;
    }
    msg.textContent = '测试消息已发送至：' + (data && data.target ? data.target : '全部成员');
    toast('测试消息已发送', 'success');
  } finally {
    setBtnLoading(btn, false);
  }
});
document.getElementById('wc-clear-secrets').addEventListener('click', async function () {
  var ok = await confirmDialog({
    title: '清除企业微信密钥',
    message: '确定清除已保存的应用 Secret、回调 Token 和 EncodingAESKey 吗？清除后回调验签与推送将暂停。',
    confirmText: '确认清除',
    danger: true
  });
  if (!ok) return;
  var r = await api('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clear_wecom_secrets: true })
  });
  if (!r.ok) { toast('清除失败', 'error'); return; }
  document.getElementById('wecom-msg').textContent = '已清除企业微信加密密钥。';
  toast('已清除企业微信密钥', 'info');
  loadSettings();
});

/* ---------- Explore (MoviePilot-style shelves & rankings) ---------- */
var expTab = 'recommend';
var expInited = false;
var expTmdbType = 'tv';
var expTmdbPage = 1;
var expTmdbTotalPages = 1;
var expTmdbLoading = false;
var expDoubanCol = 'tv_hot';
var expDoubanStart = 0;
var expDoubanHasMore = false;
var expDoubanLoading = false;
var expCache = {};
var expItemMap = {};

var EXP_SHELVES = [
  { id: 'tmdb-trending', title: 'TMDB 本周流行', source: 'tmdb', url: '/api/explore/tmdb?kind=trending&type=all&page=1', jump: { tab: 'tmdb', type: 'tv', sort: 'popularity.desc' } },
  { id: 'db-tv-hot', title: '豆瓣热门剧集', source: 'douban', url: '/api/explore/douban?collection=tv_hot&start=0&count=18', jump: { tab: 'douban', col: 'tv_hot' } },
  { id: 'db-movie-showing', title: '豆瓣正在热映', source: 'douban', url: '/api/explore/douban?collection=movie_showing&start=0&count=18', jump: { tab: 'douban', col: 'movie_showing' } },
  { id: 'tmdb-tv-popular', title: 'TMDB 热门剧集', source: 'tmdb', url: '/api/explore/tmdb?kind=popular&type=tv&page=1', jump: { tab: 'tmdb', type: 'tv', sort: 'popularity.desc' } },
  { id: 'tmdb-movie-popular', title: 'TMDB 热门电影', source: 'tmdb', url: '/api/explore/tmdb?kind=popular&type=movie&page=1', jump: { tab: 'tmdb', type: 'movie', sort: 'popularity.desc' } },
  { id: 'db-tv-domestic', title: '豆瓣热门国产剧', source: 'douban', url: '/api/explore/douban?collection=tv_domestic&start=0&count=18', jump: { tab: 'douban', col: 'tv_domestic' } },
  { id: 'db-tv-variety', title: '豆瓣热门综艺', source: 'douban', url: '/api/explore/douban?collection=tv_variety_show&start=0&count=18', jump: { tab: 'douban', col: 'tv_variety_show' } },
  { id: 'db-tv-anime', title: '豆瓣热门动画', source: 'douban', url: '/api/explore/douban?collection=tv_animation&start=0&count=18', jump: { tab: 'douban', col: 'tv_animation' } }
];

function isItemSubscribed(item) {
  var t = (item.title || '').trim().toLowerCase();
  for (var i = 0; i < subsCache.length; i++) {
    var s = subsCache[i];
    if (item.tmdb_id && s.tmdb_id === item.tmdb_id && s.media_type === item.media_type) return true;
    if (t && (s.title || '').trim().toLowerCase() === t) return true;
  }
  return false;
}
function expCardHtml(item) {
  expItemMap[item.id] = item;
  var subbed = isItemSubscribed(item);
  var poster = item.poster_url
    ? '<img src="' + esc(item.poster_url) + '" alt="" loading="lazy">'
    : '<div class="poster-ph">' + esc((item.title || '?').slice(0, 1)) + '</div>';
  var typeLbl = item.media_type === 'movie' ? '电影' : (item.media_type === 'variety' ? '综艺' : '剧集');
  var rateBadge = item.rating ? '<span class="tmdb-rate-badge num">★ ' + Number(item.rating).toFixed(1) + '</span>' : '';
  var epBadge = item.episodes_info ? '<span class="exp-ep-badge">' + esc(item.episodes_info) + '</span>' : '';
  var subBadge = subbed ? '<span class="exp-sub-badge">已订阅</span>' : '';
  var metaLine = [item.year || '', item.region || ''].filter(Boolean).join(' · ') || (item.subtitle || '');
  return '<article class="exp-card" data-exp-id="' + esc(item.id) + '" data-exp-sub-key="' + esc(item.id) + '">'
    + '<div class="exp-poster">' + poster
    + '<span class="tmdb-type-badge">' + typeLbl + '</span>'
    + subBadge + epBadge + rateBadge + '</div>'
    + '<div class="exp-info"><div class="exp-title" title="' + esc(item.title) + '">' + esc(item.title) + '</div>'
    + '<div class="exp-meta num">' + esc(metaLine || '点击查看详情') + '</div></div></article>';
}
function refreshExploreSubBadges() {
  var cards = document.querySelectorAll('.exp-card[data-exp-id]');
  for (var i = 0; i < cards.length; i++) {
    var item = expItemMap[cards[i].getAttribute('data-exp-id')];
    if (!item) continue;
    var box = cards[i].querySelector('.exp-poster');
    if (!box) continue;
    var cur = box.querySelector('.exp-sub-badge');
    var has = isItemSubscribed(item);
    if (has && !cur) box.insertAdjacentHTML('beforeend', '<span class="exp-sub-badge">已订阅</span>');
    else if (!has && cur) cur.parentNode.removeChild(cur);
  }
}
function switchExploreTab(tab) {
  expTab = tab === 'tmdb' || tab === 'douban' ? tab : 'recommend';
  var btns = document.querySelectorAll('[data-exptab]');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-exptab') === expTab);
  ['recommend', 'tmdb', 'douban'].forEach(function (k) {
    document.getElementById('exp-panel-' + k).classList.toggle('active', k === expTab);
  });
  if (expTab === 'tmdb' && !document.getElementById('exp-tmdb-grid').children.length) loadTmdbExplore(true);
  if (expTab === 'douban' && !document.getElementById('exp-douban-grid').children.length) loadDoubanExplore(true);
}
var expTabBtns = document.querySelectorAll('[data-exptab]');
for (var eti = 0; eti < expTabBtns.length; eti++) {
  expTabBtns[eti].addEventListener('click', function () { switchExploreTab(this.getAttribute('data-exptab')); });
}
document.getElementById('exp-go-search').addEventListener('click', goDiscover);

function ensureExploreLoaded() {
  if (expInited) return;
  expInited = true;
  loadExploreRecommend();
}
async function loadExploreRecommend() {
  var box = document.getElementById('exp-shelves');
  box.innerHTML = EXP_SHELVES.map(function (sh) {
    return '<div class="exp-shelf" id="shelf-' + sh.id + '">'
      + '<div class="exp-shelf-head"><div class="exp-shelf-title-wrap">'
      + '<h3 class="exp-shelf-title">' + esc(sh.title) + '</h3>'
      + '<span class="exp-src-tag ' + (sh.source === 'tmdb' ? 'exp-src-tmdb' : 'exp-src-douban') + '">' + (sh.source === 'tmdb' ? 'TMDB' : '豆瓣') + '</span>'
      + '</div><button type="button" class="btn btn-ghost btn-sm" data-shelf-jump="' + sh.id + '">查看全部 ' + ICONS.chevron + '</button></div>'
      + '<div class="exp-track-wrap" id="track-wrap-' + sh.id + '">'
      + '<div class="exp-track" id="track-' + sh.id + '">'
      + '<div class="skeleton" style="flex:0 0 158px;aspect-ratio:2/3;border-radius:12px"></div>'.repeat(6)
      + '</div></div></div>';
  }).join('');

  var tmdbTipShown = false;
  await Promise.all(EXP_SHELVES.map(async function (sh) {
    var track = document.getElementById('track-' + sh.id);
    var wrap = document.getElementById('track-wrap-' + sh.id);
    if (!track) return;
    try {
      var data = expCache[sh.url];
      if (!data) {
        var r = await api(sh.url);
        data = await r.json().catch(function () { return null; });
        if (!r.ok) {
          if (data && data.error && data.error.code === 'tmdb_not_configured') {
            if (!tmdbTipShown) {
              tmdbTipShown = true;
              track.innerHTML = '<div class="guide-card" style="width:100%;margin:0"><h3>TMDB 榜单暂未开启</h3><p class="muted" style="margin:0 0 .6rem">在「设置 → 媒体信息」保存 TMDB API Key 后即可查看 TMDB 流行与高分榜单；下方豆瓣榜单仍可直接浏览订阅。</p><button type="button" class="btn btn-primary btn-sm" id="exp-go-tmdb-cfg">去配置 TMDB Key</button></div>';
              var cfgBtn = document.getElementById('exp-go-tmdb-cfg');
              if (cfgBtn) cfgBtn.addEventListener('click', function () { switchView('settings'); switchSettingsTab('tmdb'); });
            } else {
              var shelfEl = document.getElementById('shelf-' + sh.id);
              if (shelfEl) shelfEl.style.display = 'none';
            }
            return;
          }
          track.innerHTML = '<p class="muted">暂时无法加载该榜单。</p>';
          return;
        }
        expCache[sh.url] = data;
      }
      var items = data.items || [];
      if (!items.length) { track.innerHTML = '<p class="muted">暂无数据。</p>'; return; }
      track.innerHTML = items.map(expCardHtml).join('');
      if (wrap && !wrap.querySelector('.exp-scroll-btn')) {
        wrap.insertAdjacentHTML('beforeend',
          '<button type="button" class="exp-scroll-btn exp-scroll-prev" data-scroll-dir="-1" aria-label="向左滚动">' + ICONS.chevronLeft + '</button>'
          + '<button type="button" class="exp-scroll-btn exp-scroll-next" data-scroll-dir="1" aria-label="向右滚动">' + ICONS.chevron + '</button>');
      }
    } catch (e) {
      track.innerHTML = '<p class="muted">加载失败。</p>';
    }
  }));
}

document.getElementById('exp-shelves').addEventListener('click', function (e) {
  var jumpBtn = e.target.closest('button[data-shelf-jump]');
  if (jumpBtn) {
    var sid = jumpBtn.getAttribute('data-shelf-jump');
    for (var i = 0; i < EXP_SHELVES.length; i++) {
      if (EXP_SHELVES[i].id === sid) {
        var j = EXP_SHELVES[i].jump;
        if (j.tab === 'tmdb') {
          expTmdbType = j.type || 'tv';
          setTmdbTypeButtons(expTmdbType);
          var sortEl = document.getElementById('exp-tmdb-sort');
          if (sortEl) { sortEl.value = j.sort || 'popularity.desc'; syncCustomSelect(sortEl); }
          switchExploreTab('tmdb');
          loadTmdbExplore(true);
        } else {
          selectDoubanCollection(j.col || 'tv_hot');
          switchExploreTab('douban');
        }
        return;
      }
    }
    return;
  }
  var scrollBtn = e.target.closest('button[data-scroll-dir]');
  if (scrollBtn) {
    var wrap = scrollBtn.closest('.exp-track-wrap');
    var track = wrap && wrap.querySelector('.exp-track');
    if (track) track.scrollBy({ left: Number(scrollBtn.getAttribute('data-scroll-dir')) * 560, behavior: 'smooth' });
    return;
  }
  var card = e.target.closest('.exp-card[data-exp-id]');
  if (card) openExploreCard(card);
});

function setTmdbTypeButtons(t) {
  var btns = document.querySelectorAll('[data-tmdb-type]');
  for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-tmdb-type') === t);
}
async function loadTmdbExplore(reset) {
  if (expTmdbLoading) return;
  expTmdbLoading = true;
  var grid = document.getElementById('exp-tmdb-grid');
  var guide = document.getElementById('exp-tmdb-guide');
  var moreBtn = document.getElementById('exp-tmdb-more');
  if (reset) {
    expTmdbPage = 1;
    guide.innerHTML = '';
    grid.innerHTML = '<div class="skeleton" style="aspect-ratio:2/3;border-radius:12px"></div>'.repeat(12);
    moreBtn.hidden = true;
  } else {
    setBtnLoading(moreBtn, true);
  }
  try {
    var sort = document.getElementById('exp-tmdb-sort').value;
    var genre = document.getElementById('exp-tmdb-genre').value;
    var lang = document.getElementById('exp-tmdb-lang').value;
    var year = document.getElementById('exp-tmdb-year').value;
    var qs = '?kind=discover&type=' + encodeURIComponent(expTmdbType)
      + '&sort=' + encodeURIComponent(sort)
      + (genre ? '&genre=' + encodeURIComponent(genre) : '')
      + (lang ? '&lang=' + encodeURIComponent(lang) : '')
      + (year ? '&year=' + encodeURIComponent(year) : '')
      + '&page=' + expTmdbPage;
    var r = await api('/api/explore/tmdb' + qs);
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      if (reset) grid.innerHTML = '';
      if (data && data.error && data.error.code === 'tmdb_not_configured') {
        guide.innerHTML = '<div class="guide-card"><h3>TMDB API Key 尚未配置</h3><p class="muted" style="margin:0 0 .7rem">配置 TMDB API Key 后即可按题材、地区、年份浏览 TMDB 全库。也可以先切换「豆瓣榜单」逛热门片单。</p><button type="button" class="btn btn-primary btn-sm" id="exp-tmdb-cfg-btn">去配置 TMDB Key</button></div>';
        document.getElementById('exp-tmdb-cfg-btn').addEventListener('click', function () { switchView('settings'); switchSettingsTab('tmdb'); });
      } else {
        toast(data && data.error ? data.error.message : '加载 TMDB 探索失败', 'error');
      }
      return;
    }
    var items = data.items || [];
    if (reset) {
      grid.innerHTML = items.length ? items.map(expCardHtml).join('') : '<div class="empty-state" style="grid-column:1/-1"><p>没有符合筛选条件的影视作品。</p></div>';
    } else if (items.length) {
      grid.insertAdjacentHTML('beforeend', items.map(expCardHtml).join(''));
    }
    expTmdbTotalPages = data.total_pages || 1;
    moreBtn.hidden = expTmdbPage >= expTmdbTotalPages;
  } finally {
    expTmdbLoading = false;
    setBtnLoading(moreBtn, false);
  }
}

var tmdbTypeBtns = document.querySelectorAll('[data-tmdb-type]');
for (var tti = 0; tti < tmdbTypeBtns.length; tti++) {
  tmdbTypeBtns[tti].addEventListener('click', function () {
    expTmdbType = this.getAttribute('data-tmdb-type') || 'tv';
    setTmdbTypeButtons(expTmdbType);
    loadTmdbExplore(true);
  });
}
['exp-tmdb-sort', 'exp-tmdb-genre', 'exp-tmdb-lang', 'exp-tmdb-year'].forEach(function (id) {
  document.getElementById(id).addEventListener('change', function () { loadTmdbExplore(true); });
});
document.getElementById('exp-tmdb-more').addEventListener('click', function () {
  expTmdbPage += 1;
  loadTmdbExplore(false);
});
document.getElementById('exp-tmdb-grid').addEventListener('click', function (e) {
  var card = e.target.closest('.exp-card[data-exp-id]');
  if (card) openExploreCard(card);
});

function selectDoubanCollection(col) {
  expDoubanCol = col;
  var pills = document.querySelectorAll('[data-dbcol]');
  for (var i = 0; i < pills.length; i++) pills[i].classList.toggle('active', pills[i].getAttribute('data-dbcol') === col);
  loadDoubanExplore(true);
}
async function loadDoubanExplore(reset) {
  if (expDoubanLoading) return;
  expDoubanLoading = true;
  var grid = document.getElementById('exp-douban-grid');
  var moreBtn = document.getElementById('exp-douban-more');
  if (reset) {
    expDoubanStart = 0;
    grid.innerHTML = '<div class="skeleton" style="aspect-ratio:2/3;border-radius:12px"></div>'.repeat(12);
    moreBtn.hidden = true;
  } else {
    setBtnLoading(moreBtn, true);
  }
  try {
    var r = await api('/api/explore/douban?collection=' + encodeURIComponent(expDoubanCol) + '&start=' + expDoubanStart + '&count=20');
    var data = await r.json().catch(function () { return null; });
    if (!r.ok || !data) {
      if (reset) grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><p>豆瓣榜单暂不可用，请稍后重试。</p></div>';
      toast(data && data.error ? data.error.message : '加载豆瓣榜单失败', 'error');
      return;
    }
    var items = data.items || [];
    if (reset) {
      grid.innerHTML = items.length ? items.map(expCardHtml).join('') : '<div class="empty-state" style="grid-column:1/-1"><p>该榜单暂无条目。</p></div>';
    } else if (items.length) {
      grid.insertAdjacentHTML('beforeend', items.map(expCardHtml).join(''));
    }
    expDoubanStart += items.length;
    expDoubanHasMore = !!data.has_more;
    moreBtn.hidden = !expDoubanHasMore;
  } finally {
    expDoubanLoading = false;
    setBtnLoading(moreBtn, false);
  }
}
document.getElementById('exp-douban-pills').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-dbcol]');
  if (!btn) return;
  selectDoubanCollection(btn.getAttribute('data-dbcol') || 'tv_hot');
});
document.getElementById('exp-douban-more').addEventListener('click', function () {
  loadDoubanExplore(false);
});
document.getElementById('exp-douban-grid').addEventListener('click', function (e) {
  var card = e.target.closest('.exp-card[data-exp-id]');
  if (card) openExploreCard(card);
});

async function openExploreCard(cardEl) {
  var item = expItemMap[cardEl.getAttribute('data-exp-id')];
  if (!item) return;
  if (item.source === 'tmdb' && item.tmdb_id) {
    openDetail({ tmdb_id: item.tmdb_id, media_type: item.media_type === 'movie' ? 'movie' : 'tv' });
    return;
  }
  cardEl.classList.add('is-loading');
  try {
    var qs = '?title=' + encodeURIComponent(item.title)
      + '&media_type=' + encodeURIComponent(item.media_type)
      + (item.year ? '&year=' + item.year : '');
    var r = await api('/api/explore/match' + qs);
    var data = await r.json().catch(function () { return null; });
    if (data && data.tmdb_configured && data.matched && data.matched.tmdb_id) {
      openDetail({ tmdb_id: data.matched.tmdb_id, media_type: data.matched.media_type }, item.media_type === 'variety' ? 'variety' : null, item);
      return;
    }
    openQuickSubscribeModal(item);
  } finally {
    cardEl.classList.remove('is-loading');
  }
}

function openQuickSubscribeModal(item) {
  var box = document.getElementById('modal-content');
  var poster = item.poster_url
    ? '<img src="' + esc(item.poster_url) + '" alt="">'
    : '<div class="poster-ph">' + esc((item.title || '?').slice(0, 1)) + '</div>';
  var mType = item.media_type || 'tv';
  var isMovie = mType === 'movie';
  var subbed = isItemSubscribed(item);
  var genres = item.genres && item.genres.length ? item.genres : [];
  var facts = [];
  if (item.directors && item.directors.length) facts.push({ label: '导演 / 主创', value: item.directors.join(' / ') });
  if (item.countries && item.countries.length) facts.push({ label: '制片地区', value: item.countries.join(' / ') });
  if (genres.length) facts.push({ label: '类型', value: genres.join(' / ') });
  if (item.episodes_info) facts.push({ label: '更新进度', value: item.episodes_info });
  if (item.douban_id) {
    facts.push({
      label: '外部资料',
      value: '<div class="ext-links"><a class="ext-link" href="https://movie.douban.com/subject/' + encodeURIComponent(item.douban_id) + '/" target="_blank" rel="noopener noreferrer">豆瓣主页 ↗</a></div>',
      html: true
    });
  }
  box.innerHTML = '<div class="modal-hero">' + poster
    + '<div style="flex:1;min-width:0"><div class="modal-title"><span>' + esc(item.title) + '</span>'
    + (item.year ? '<span class="sub-year num">' + item.year + '</span>' : '')
    + (subbed ? '<span class="tag tag-subbed">已订阅</span>' : '') + '</div>'
    + '<div class="tag-row"><span class="tag tag-douban">豆瓣榜单</span>'
    + '<span class="tag">' + mediaLabel(mType) + '</span>'
    + (item.region ? '<span class="tag">' + esc(item.region) + '</span>' : '')
    + (item.rating ? '<span class="tag tag-rate">★ ' + Number(item.rating).toFixed(1) + '</span>' : '')
    + (item.honor ? '<span class="tag tag-honor">' + esc(item.honor) + '</span>' : '')
    + (genres.length ? '<span class="tag">' + esc(genres.join(' / ')) + '</span>' : '') + '</div>'
    + '<div class="form-grid-3" style="margin-top:.8rem">'
    + '<div class="field"><label class="field-label" for="qm-type">类型</label>'
    + '<select id="qm-type"><option value="tv"' + (mType === 'tv' ? ' selected' : '') + '>电视剧</option>'
    + '<option value="movie"' + (mType === 'movie' ? ' selected' : '') + '>电影</option>'
    + '<option value="variety"' + (mType === 'variety' ? ' selected' : '') + '>综艺</option></select></div>'
    + (!isMovie ? '<div class="field"><label class="field-label" for="qm-season">订阅季</label><input id="qm-season" type="number" min="1" value="1"></div>' : '<div></div>')
    + '<div class="field"><label class="field-label" for="qm-mode">执行模式</label>'
    + '<select id="qm-mode"><option value="auto" selected>自动转存</option><option value="manual">手动确认</option></select></div>'
    + '</div></div></div>'
    + renderModalFacts(facts)
    + renderCastSection(null, item.actors)
    + (item.subtitle && !facts.length ? '<p class="muted" style="margin-top:.85rem">' + esc(item.subtitle) + '</p>' : '')
    + (item.overview ? '<div class="modal-section"><div class="modal-section-title">简介</div><p class="overview">' + esc(item.overview) + '</p></div>' : '')
    + '<div class="modal-actions"><button type="button" class="btn" id="qm-cancel">取消</button>'
    + '<button type="button" class="btn btn-primary" id="qm-submit">' + (subbed ? '再次确认订阅' : '确认订阅') + '</button></div>';
  enhanceSelects(box);
  document.getElementById('modal-backdrop').hidden = false;
  document.getElementById('qm-cancel').addEventListener('click', closeModal);
  document.getElementById('qm-submit').addEventListener('click', async function () {
    var btn = this;
    setBtnLoading(btn, true);
    try {
      var mt = document.getElementById('qm-type').value;
      var sEl = document.getElementById('qm-season');
      var payload = {
        title: item.title,
        year: item.year,
        media_type: mt,
        region: item.region || undefined,
        season: mt === 'movie' ? undefined : (sEl && Number(sEl.value) ? Number(sEl.value) : 1),
        rating: item.rating,
        overview: item.overview || item.subtitle || undefined,
        mode: document.getElementById('qm-mode').value
      };
      var r = await api('/api/subscriptions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await r.json().catch(function () { return null; });
      if (!r.ok) { toast(data && data.error ? data.error.message : '订阅失败', 'error'); return; }
      closeModal();
      toast('已添加订阅「' + item.title + '」', 'success');
      await loadSubs();
    } finally {
      setBtnLoading(btn, false);
    }
  });
}

/* ---------- Init ---------- */
var initial = document.body.getAttribute('data-initial-view') || 'dashboard';
if (location.hash) {
  var h = location.hash.slice(1);
  if (h === 'subscriptions-finished') { initial = 'subscriptions'; subGroup = 'finished'; }
  else if (VIEWS.indexOf(h) >= 0) initial = h;
  else if (SETTINGS_TABS.indexOf(h) >= 0) { initial = 'settings'; currentSettingsTab = h; }
}
enhanceSelects(document);
switchView(initial);
switchSubGroup(subGroup, false);
loadSettings();
loadSubs();
`;
