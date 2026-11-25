import { APP_CSS } from "./styles";
import { ICON_ALERT, ICON_BRAND, ICON_EYE, ICON_EYE_OFF, ICON_MOON, ICON_SUN } from "./icons";

export function loginHtml(failed: boolean): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PanPilot 登录</title>
<script>
(function(){try{var t=localStorage.getItem('pp_theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();
</script>
<style>${APP_CSS}</style>
</head>
<body>
<div class="login-wrap">
  <button type="button" class="btn btn-ghost btn-icon login-theme-btn" id="login-theme-btn" title="切换亮/暗主题" aria-label="切换亮/暗主题">${ICON_SUN}</button>
  <div class="login-card">
    <div class="login-brand">
      <div class="brand-logo">${ICON_BRAND}</div>
      <div class="brand-name">PanPilot</div>
      <div class="brand-sub">影视订阅控制台</div>
    </div>
    ${failed ? `<div class="login-alert" role="alert">${ICON_ALERT}<span>用户名或密码不正确，请核对后重试。</span></div>` : ""}
    <form method="post" action="/login" id="login-form">
      <div class="field">
        <label class="field-label" for="login-username">用户名</label>
        <input id="login-username" name="username" placeholder="输入用户名" autocomplete="username" autofocus required>
      </div>
      <div class="field">
        <label class="field-label" for="login-password">密码</label>
        <div class="pw-wrap">
          <input id="login-password" name="password" type="password" placeholder="输入密码" autocomplete="current-password" required>
          <button type="button" class="pw-toggle" id="pw-toggle" aria-label="显示或隐藏密码" title="显示/隐藏密码">${ICON_EYE}</button>
        </div>
      </div>
      <button type="submit" class="btn btn-primary" id="login-submit">登录控制台</button>
    </form>
    <p class="muted login-foot">订阅控制面：搜索与转存由外部 Driver 执行；网盘 Cookie 仅在你主动填写后以 AES-GCM 加密形式保存，仅供你的 Driver 取用。</p>
  </div>
</div>
<script>
(function(){
  var pw = document.getElementById('login-password');
  var tog = document.getElementById('pw-toggle');
  var iconEye = '${ICON_EYE.replace(/'/g, "\\'")}';
  var iconEyeOff = '${ICON_EYE_OFF.replace(/'/g, "\\'")}';
  if (tog && pw) {
    tog.addEventListener('click', function () {
      var show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      tog.innerHTML = show ? iconEyeOff : iconEye;
    });
  }
  var form = document.getElementById('login-form');
  var btn = document.getElementById('login-submit');
  if (form && btn) {
    form.addEventListener('submit', function () {
      btn.classList.add('is-loading');
      btn.disabled = true;
    });
  }
  var themeBtn = document.getElementById('login-theme-btn');
  var iconSun = '${ICON_SUN.replace(/'/g, "\\'")}';
  var iconMoon = '${ICON_MOON.replace(/'/g, "\\'")}';
  function syncThemeIcon() {
    var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    if (themeBtn) themeBtn.innerHTML = cur === 'light' ? iconMoon : iconSun;
  }
  syncThemeIcon();
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      var next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('pp_theme', next); } catch (e) {}
      syncThemeIcon();
    });
  }
})();
</script>
</body>
</html>`;
}
