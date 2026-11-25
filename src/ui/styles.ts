/**
 * PanPilot Design System — Cinema Editorial Control Plane.
 * Supports Cinema Dark (default) and Warm Paper Light via [data-theme="light"].
 */

export const APP_CSS = `
  :root {
    color-scheme: dark;
    --pp-bg: #09090b;
    --pp-bg-elevated: #111216;
    --pp-panel: #15171d;
    --pp-panel-2: #1c1f28;
    --pp-panel-hover: #212530;
    --pp-footer-bg: rgba(255, 255, 255, 0.02);
    --pp-border: rgba(255, 255, 255, 0.08);
    --pp-border-strong: rgba(255, 255, 255, 0.15);
    --pp-text: #f3f4f6;
    --pp-text-2: #c9cdd8;
    --pp-muted: #8b92a5;
    --pp-placeholder: #5a6173;

    --pp-accent: #e5a00d;
    --pp-accent-hover: #f5b82e;
    --pp-accent-soft: rgba(229, 160, 13, 0.14);
    --pp-accent-border: rgba(229, 160, 13, 0.35);
    --pp-accent-ink: #161003;

    --pp-green: #2dd4a0;
    --pp-green-soft: rgba(45, 212, 160, 0.14);
    --pp-sky: #38bdf8;
    --pp-sky-soft: rgba(56, 189, 248, 0.14);
    --pp-amber: #f59e0b;
    --pp-amber-soft: rgba(245, 158, 11, 0.15);
    --pp-red: #f87171;
    --pp-red-soft: rgba(248, 113, 113, 0.15);
    --pp-gray: #8b92a5;
    --pp-gray-soft: rgba(139, 146, 165, 0.15);

    --pp-topbar-bg: rgba(9, 9, 11, 0.82);
    --pp-backdrop: rgba(4, 5, 8, 0.72);
    --pp-terminal-bg: #0b0c10;
    --pp-terminal-text: #d7dde8;

    --pp-radius-sm: 8px;
    --pp-radius: 12px;
    --pp-radius-lg: 16px;
    --pp-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.25);
    --pp-shadow: 0 10px 30px rgba(0, 0, 0, 0.42);
    --pp-shadow-lg: 0 22px 54px rgba(0, 0, 0, 0.6);

    --pp-font: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --pp-mono: ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
    --pp-ease: cubic-bezier(0.22, 1, 0.36, 1);
  }

  [data-theme="light"] {
    color-scheme: light;
    --pp-bg: #f6f5f0;
    --pp-bg-elevated: #fbfaf7;
    --pp-panel: #ffffff;
    --pp-panel-2: #f1efe8;
    --pp-panel-hover: #eae6dc;
    --pp-footer-bg: rgba(18, 22, 30, 0.025);
    --pp-border: rgba(18, 22, 30, 0.09);
    --pp-border-strong: rgba(18, 22, 30, 0.17);
    --pp-text: #16181d;
    --pp-text-2: #3b404d;
    --pp-muted: #656c7c;
    --pp-placeholder: #9aa0ad;

    --pp-accent: #c88000;
    --pp-accent-hover: #dc8e00;
    --pp-accent-soft: rgba(200, 128, 0, 0.12);
    --pp-accent-border: rgba(200, 128, 0, 0.36);
    --pp-accent-ink: #ffffff;

    --pp-green: #0d9668;
    --pp-green-soft: rgba(13, 150, 104, 0.12);
    --pp-sky: #0284c7;
    --pp-sky-soft: rgba(2, 132, 199, 0.11);
    --pp-amber: #c26d06;
    --pp-amber-soft: rgba(194, 109, 6, 0.12);
    --pp-red: #dc2626;
    --pp-red-soft: rgba(220, 38, 38, 0.11);
    --pp-gray: #64748b;
    --pp-gray-soft: rgba(100, 116, 139, 0.12);

    --pp-topbar-bg: rgba(246, 245, 240, 0.85);
    --pp-backdrop: rgba(15, 18, 25, 0.48);
    --pp-terminal-bg: #181a20;
    --pp-terminal-text: #e5e9f0;

    --pp-shadow-sm: 0 1px 4px rgba(15, 18, 25, 0.05);
    --pp-shadow: 0 8px 24px rgba(15, 18, 25, 0.07);
    --pp-shadow-lg: 0 20px 48px rgba(15, 18, 25, 0.15);
  }

  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--pp-font);
    background: var(--pp-bg);
    color: var(--pp-text);
    min-height: 100vh;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  a { color: var(--pp-accent); text-decoration: none; }
  a:hover { color: var(--pp-accent-hover); text-decoration: underline; }
  button, input, select, textarea { font: inherit; color: inherit; }

  :focus-visible {
    outline: 2px solid var(--pp-accent);
    outline-offset: 2px;
  }

  .num, .stat-value, .badge, .log-time, .tag-rate {
    font-variant-numeric: tabular-nums;
  }

  /* ---- Inputs & Forms ---- */
  input, select, textarea {
    background: var(--pp-bg-elevated);
    border: 1px solid var(--pp-border-strong);
    border-radius: var(--pp-radius-sm);
    padding: 0.56rem 0.78rem;
    font-size: 0.92rem;
    transition: border-color 0.15s var(--pp-ease), box-shadow 0.15s var(--pp-ease), background 0.15s;
  }
  input:hover, select:hover, textarea:hover {
    border-color: rgba(139, 146, 165, 0.42);
  }
  input:focus, select:focus, textarea:focus {
    outline: none;
    border-color: var(--pp-accent);
    box-shadow: 0 0 0 3px var(--pp-accent-soft);
  }
  input::placeholder, textarea::placeholder { color: var(--pp-placeholder); }
  textarea {
    width: 100%;
    font-family: var(--pp-mono);
    font-size: 0.84rem;
    line-height: 1.55;
    resize: vertical;
  }

  .field { display: flex; flex-direction: column; gap: 0.36rem; min-width: 0; }
  .field-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--pp-text-2);
    letter-spacing: 0.01em;
  }
  .field-hint { font-size: 0.78rem; color: var(--pp-muted); line-height: 1.45; }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.85rem 1rem;
  }
  .form-grid-2 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem 1rem;
  }
  .form-grid-3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.85rem 1rem;
  }
  .form-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .input-group {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .input-group input { flex: 1 1 240px; min-width: 0; }
  .input-with-icon { position: relative; display: flex; align-items: center; }
  .input-with-icon > svg {
    position: absolute;
    left: 0.78rem;
    color: var(--pp-muted);
    pointer-events: none;
  }
  .input-with-icon input { padding-left: 2.3rem; width: 100%; }
  .pw-wrap { position: relative; display: flex; align-items: center; }
  .pw-wrap input { width: 100%; padding-right: 2.6rem; }
  .pw-toggle {
    position: absolute;
    right: 0.45rem;
    background: transparent;
    border: none;
    color: var(--pp-muted);
    padding: 0.35rem;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .pw-toggle:hover { color: var(--pp-text); background: var(--pp-panel-2); }

  /* ---- Toggle Switch ---- */
  .switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.72rem 0.9rem;
    border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius);
    background: var(--pp-bg-elevated);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .switch-row:hover { border-color: var(--pp-border-strong); background: var(--pp-panel-2); }
  .switch-text { min-width: 0; }
  .switch-title { font-size: 0.9rem; font-weight: 550; color: var(--pp-text); }
  .switch-desc { font-size: 0.79rem; color: var(--pp-muted); margin-top: 0.12rem; }
  .switch {
    position: relative;
    flex: 0 0 auto;
    width: 40px;
    height: 22px;
    display: inline-block;
  }
  .switch input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .switch-track {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background: var(--pp-panel-2);
    border: 1px solid var(--pp-border-strong);
    transition: background 0.18s var(--pp-ease), border-color 0.18s;
  }
  .switch-track::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--pp-muted);
    transition: transform 0.18s var(--pp-ease), background 0.18s;
  }
  .switch input:checked + .switch-track {
    background: var(--pp-accent);
    border-color: var(--pp-accent);
  }
  .switch input:checked + .switch-track::after {
    transform: translateX(18px);
    background: var(--pp-accent-ink);
  }
  .switch input:focus-visible + .switch-track {
    outline: 2px solid var(--pp-accent);
    outline-offset: 2px;
  }

  /* ---- Buttons ---- */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border: 1px solid var(--pp-border-strong);
    background: var(--pp-panel-2);
    color: var(--pp-text);
    border-radius: var(--pp-radius-sm);
    padding: 0.52rem 0.95rem;
    font-size: 0.89rem;
    font-weight: 550;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s, transform 0.1s, opacity 0.15s;
  }
  .btn:hover:not(:disabled) { background: var(--pp-panel-hover); }
  .btn:active:not(:disabled) { transform: scale(0.98); }
  .btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .btn-sm { padding: 0.36rem 0.72rem; font-size: 0.82rem; }
  .btn-icon { padding: 0.45rem; width: 34px; height: 34px; }

  .btn-primary {
    background: var(--pp-accent);
    border-color: var(--pp-accent);
    color: var(--pp-accent-ink);
    font-weight: 650;
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--pp-accent-hover);
    border-color: var(--pp-accent-hover);
  }
  .btn-ghost {
    background: transparent;
    border-color: transparent;
    color: var(--pp-muted);
  }
  .btn-ghost:hover:not(:disabled) {
    background: var(--pp-panel-2);
    color: var(--pp-text);
  }
  .btn-danger {
    background: transparent;
    border-color: rgba(248, 113, 113, 0.32);
    color: var(--pp-red);
  }
  .btn-danger:hover:not(:disabled) {
    background: var(--pp-red-soft);
    border-color: var(--pp-red);
  }
  .btn-danger-solid {
    background: var(--pp-red);
    border-color: var(--pp-red);
    color: #fff;
    font-weight: 650;
  }
  .btn-danger-solid:hover:not(:disabled) { filter: brightness(1.08); }

  .btn.is-loading { position: relative; pointer-events: none; opacity: 0.78; }
  .btn.is-loading::before {
    content: "";
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: pp-spin 0.65s linear infinite;
  }
  @keyframes pp-spin { to { transform: rotate(360deg); } }

  .muted { color: var(--pp-muted); font-size: 0.86rem; line-height: 1.55; }
  .error-text { color: var(--pp-red); font-size: 0.88rem; }
  .status-bad { color: var(--pp-red); font-weight: 600; }
  .status-ok { color: var(--pp-green); font-weight: 600; }
  code {
    font-family: var(--pp-mono);
    font-size: 0.84em;
    background: var(--pp-panel-2);
    border: 1px solid var(--pp-border);
    border-radius: 5px;
    padding: 0.08rem 0.35rem;
  }

  /* ---- Shell Layout ---- */
  .layout { display: flex; min-height: 100vh; }
  .sidebar {
    width: 244px;
    flex: 0 0 244px;
    background: var(--pp-bg-elevated);
    border-right: 1px solid var(--pp-border);
    display: flex;
    flex-direction: column;
    padding: 1.1rem 0.85rem;
    position: sticky;
    top: 0;
    height: 100vh;
    z-index: 15;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.2rem 0.45rem 1rem;
  }
  .brand-logo {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--pp-accent);
    color: var(--pp-accent-ink);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 6px 18px var(--pp-accent-soft);
    flex: 0 0 auto;
  }
  .brand-name { font-size: 1.08rem; font-weight: 750; letter-spacing: -0.01em; line-height: 1.2; }
  .brand-sub { font-size: 0.72rem; color: var(--pp-muted); margin-top: 0.08rem; }

  .side-cta {
    width: 100%;
    margin-bottom: 0.95rem;
    justify-content: center;
    border-radius: 10px;
  }

  .menu { display: flex; flex-direction: column; gap: 0.24rem; }
  .menu-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.65rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 10px;
    padding: 0.6rem 0.72rem;
    cursor: pointer;
    text-align: left;
    color: var(--pp-muted);
    font-size: 0.93rem;
    font-weight: 500;
    transition: background 0.14s, color 0.14s, border-color 0.14s;
  }
  .menu-item svg { flex: 0 0 auto; opacity: 0.85; }
  .menu-item:hover { background: var(--pp-panel); color: var(--pp-text); }
  .menu-item.active {
    background: var(--pp-panel-2);
    border-color: var(--pp-border);
    color: var(--pp-text);
    font-weight: 600;
  }
  .menu-item.active svg { color: var(--pp-accent); opacity: 1; }
  .menu-item.active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 22%;
    bottom: 22%;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--pp-accent);
  }
  .nav-pill {
    margin-left: auto;
    font-size: 0.72rem;
    font-weight: 650;
    padding: 0.06rem 0.45rem;
    border-radius: 999px;
    background: var(--pp-panel-2);
    border: 1px solid var(--pp-border);
    color: var(--pp-muted);
  }
  .menu-item.active .nav-pill {
    background: var(--pp-accent-soft);
    border-color: var(--pp-accent-border);
    color: var(--pp-accent);
  }
  .nav-dot {
    margin-left: auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--pp-red);
    box-shadow: 0 0 0 3px var(--pp-red-soft);
  }
  .nav-dot[hidden] { display: none; }

  .sidebar-foot {
    margin-top: auto;
    border-top: 1px solid var(--pp-border);
    padding-top: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .user-chip {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.4rem;
  }
  .user-avatar {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--pp-panel-2);
    border: 1px solid var(--pp-border-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--pp-accent);
    flex: 0 0 auto;
    text-transform: uppercase;
  }
  .side-user {
    font-size: 0.85rem;
    font-weight: 550;
    color: var(--pp-text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .foot-actions { display: flex; gap: 0.45rem; }
  .foot-actions form { flex: 1 1 auto; display: flex; }
  .logout-btn { width: 100%; justify-content: center; }

  .main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.9rem 1.8rem;
    border-bottom: 1px solid var(--pp-border);
    background: var(--pp-topbar-bg);
    position: sticky;
    top: 0;
    z-index: 10;
    backdrop-filter: blur(10px);
  }
  .mobile-brand { display: none; align-items: center; gap: 0.55rem; font-weight: 750; }
  .page-title { font-size: 1.18rem; font-weight: 700; letter-spacing: -0.01em; margin-right: auto; }
  .topbar-actions { display: flex; align-items: center; gap: 0.5rem; }
  .topbar-user { color: var(--pp-muted); font-size: 0.84rem; padding-right: 0.3rem; }
  .mobile-only { display: none; }

  .content {
    padding: 1.5rem 1.8rem 2.8rem;
    max-width: 1280px;
    width: 100%;
    margin: 0 auto;
  }
  .view { display: none; }
  .view.active {
    display: block;
    animation: pp-fade-in 0.2s var(--pp-ease);
  }
  @keyframes pp-fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ---- Mobile Bottom Tab Bar ---- */
  .mobile-tabs { display: none; }

  /* ---- Cards, Banners & Skeletons ---- */
  .card {
    background: var(--pp-panel);
    border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius-lg);
    box-shadow: var(--pp-shadow-sm);
    padding: 1.25rem 1.35rem;
    margin-bottom: 1.15rem;
  }
  .card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-bottom: 0.7rem;
  }
  .card h2 { margin: 0; font-size: 1.04rem; font-weight: 700; letter-spacing: -0.01em; }
  .card h3 { margin: 0 0 0.5rem; font-size: 0.96rem; font-weight: 650; }
  .section-desc { margin: 0 0 0.95rem; color: var(--pp-muted); font-size: 0.86rem; line-height: 1.55; }

  .alert-stack { display: flex; flex-direction: column; gap: 0.65rem; margin-bottom: 1.15rem; }
  .alert-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.78rem 1rem;
    border-radius: var(--pp-radius);
    border: 1px solid var(--pp-amber-soft);
    background: var(--pp-amber-soft);
    color: var(--pp-text);
  }
  .alert-banner.is-error {
    border-color: rgba(248, 113, 113, 0.36);
    background: var(--pp-red-soft);
  }
  .alert-banner-icon { flex: 0 0 auto; color: var(--pp-amber); display: flex; }
  .alert-banner.is-error .alert-banner-icon { color: var(--pp-red); }
  .alert-banner-body { flex: 1 1 auto; min-width: 0; font-size: 0.88rem; }
  .alert-banner-body strong { font-weight: 650; margin-right: 0.35rem; }

  .skeleton {
    border-radius: var(--pp-radius-sm);
    background: linear-gradient(90deg, var(--pp-panel-2) 25%, var(--pp-panel-hover) 50%, var(--pp-panel-2) 75%);
    background-size: 200% 100%;
    animation: pp-shimmer 1.3s infinite linear;
  }
  @keyframes pp-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ---- Dashboard Stats ---- */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.95rem;
    margin-bottom: 1.2rem;
  }
  .stat-card {
    position: relative;
    background: var(--pp-panel);
    border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius-lg);
    padding: 1.05rem 1.15rem;
    text-align: left;
    cursor: pointer;
    transition: transform 0.16s var(--pp-ease), border-color 0.16s, background 0.16s;
  }
  .stat-card:hover {
    transform: translateY(-2px);
    border-color: var(--pp-border-strong);
    background: var(--pp-panel-2);
  }
  .stat-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .stat-label { color: var(--pp-muted); font-size: 0.83rem; font-weight: 550; }
  .stat-arrow { color: var(--pp-muted); opacity: 0; transition: opacity 0.16s, transform 0.16s; display: inline-flex; }
  .stat-card:hover .stat-arrow { opacity: 1; transform: translateX(2px); color: var(--pp-accent); }
  .stat-value { font-size: 1.95rem; font-weight: 750; letter-spacing: -0.02em; margin-top: 0.35rem; line-height: 1.1; }
  .stat-foot { font-size: 0.76rem; color: var(--pp-muted); margin-top: 0.45rem; }
  .stat-accent .stat-value { color: var(--pp-accent); }
  .stat-green .stat-value { color: var(--pp-green); }

  /* ---- Recent List ---- */
  .recent-row {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.65rem 0.55rem;
    margin: 0 -0.55rem;
    border-radius: var(--pp-radius-sm);
    border-bottom: 1px solid var(--pp-border);
    cursor: pointer;
    transition: background 0.13s;
  }
  .recent-row:last-child { border-bottom: none; }
  .recent-row:hover { background: var(--pp-panel-2); }
  .recent-row img, .recent-row .poster-ph {
    width: 42px;
    height: 62px;
    border-radius: 7px;
    object-fit: cover;
    font-size: 1rem;
    flex: 0 0 auto;
  }
  .recent-main { flex: 1 1 auto; min-width: 0; }
  .recent-title {
    font-weight: 620;
    font-size: 0.94rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .recent-sub { color: var(--pp-muted); font-size: 0.8rem; margin-top: 0.15rem; }
  .recent-prog {
    width: 96px;
    flex: 0 0 96px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.28rem;
  }
  .recent-prog .progress { width: 100%; height: 5px; }

  /* ---- Badges & Tags ---- */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 999px;
    padding: 0.16rem 0.6rem;
    white-space: nowrap;
  }
  .b-active { background: var(--pp-sky-soft); color: var(--pp-sky); }
  .b-partial { background: var(--pp-amber-soft); color: var(--pp-amber); }
  .b-done { background: var(--pp-green-soft); color: var(--pp-green); }
  .b-paused { background: var(--pp-gray-soft); color: var(--pp-gray); }
  .b-error { background: var(--pp-red-soft); color: var(--pp-red); }

  .tag-row { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.42rem 0 0.55rem; }
  .tag {
    font-size: 0.74rem;
    color: var(--pp-text-2);
    background: var(--pp-panel-2);
    border: 1px solid var(--pp-border);
    border-radius: 6px;
    padding: 0.1rem 0.48rem;
  }
  .tag-rate {
    color: var(--pp-accent);
    background: var(--pp-accent-soft);
    border-color: var(--pp-accent-border);
    font-weight: 650;
  }

  /* ---- Subscriptions View ---- */
  .sub-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 1.15rem;
  }
  .seg {
    display: inline-flex;
    gap: 0.2rem;
    background: var(--pp-bg-elevated);
    border: 1px solid var(--pp-border);
    border-radius: 10px;
    padding: 0.22rem;
  }
  .seg-btn {
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--pp-muted);
    font-size: 0.88rem;
    font-weight: 550;
    white-space: nowrap;
    padding: 0.4rem 0.85rem;
    border-radius: 8px;
    transition: background 0.14s, color 0.14s;
  }
  .seg-btn:hover { color: var(--pp-text); }
  .seg-btn.active {
    background: var(--pp-panel-2);
    color: var(--pp-text);
    font-weight: 650;
    box-shadow: var(--pp-shadow-sm);
  }
  .seg-btn .seg-count { opacity: 0.75; font-weight: 500; margin-left: 0.22rem; }
  .filter-pills { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .pill-btn {
    border: 1px solid var(--pp-border);
    background: transparent;
    color: var(--pp-muted);
    font-size: 0.8rem;
    padding: 0.32rem 0.7rem;
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.14s;
  }
  .pill-btn:hover { color: var(--pp-text); border-color: var(--pp-border-strong); }
  .pill-btn.active {
    background: var(--pp-accent-soft);
    border-color: var(--pp-accent-border);
    color: var(--pp-accent);
    font-weight: 600;
  }
  .sub-search-wrap {
    position: relative;
    flex: 1 1 210px;
    max-width: 320px;
    margin-left: auto;
  }
  .sub-search-wrap > svg {
    position: absolute;
    left: 0.75rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--pp-muted);
    pointer-events: none;
  }
  .sub-search { width: 100%; padding-left: 2.2rem; padding-right: 2rem; }
  .search-clear {
    position: absolute;
    right: 0.45rem;
    top: 50%;
    transform: translateY(-50%);
    border: none;
    background: transparent;
    color: var(--pp-muted);
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 6px;
    display: inline-flex;
  }
  .search-clear:hover { color: var(--pp-text); background: var(--pp-panel-2); }
  .search-clear[hidden] { display: none; }

  .sub-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 1rem;
    align-items: stretch;
  }
  .sub-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--pp-panel);
    border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius-lg);
    box-shadow: var(--pp-shadow-sm);
    overflow: hidden;
    transition: transform 0.16s var(--pp-ease), border-color 0.16s, box-shadow 0.16s;
  }
  .sub-card:hover {
    border-color: var(--pp-border-strong);
    box-shadow: var(--pp-shadow);
  }
  .sub-card.has-error { border-color: rgba(248, 113, 113, 0.38); }
  .sub-main {
    display: flex;
    gap: 0.9rem;
    padding: 0.95rem 1rem 0.85rem;
    flex: 1 1 auto;
    min-height: 0;
  }
  .poster-wrap {
    position: relative;
    flex: 0 0 84px;
    width: 84px;
    height: 126px;
    border-radius: 9px;
    overflow: hidden;
    cursor: pointer;
    background: var(--pp-panel-2);
  }
  .poster {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.25s var(--pp-ease);
  }
  .poster-wrap:hover .poster { transform: scale(1.04); }
  .poster-ph {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.85rem;
    font-weight: 750;
    color: var(--pp-muted);
    background: linear-gradient(155deg, var(--pp-panel-2), var(--pp-bg-elevated));
  }
  .poster-score {
    position: absolute;
    left: 5px;
    bottom: 5px;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.07rem 0.36rem;
    border-radius: 5px;
    background: rgba(9, 9, 11, 0.82);
    color: #f5b82e;
    backdrop-filter: blur(4px);
  }
  .sub-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .sub-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
  .sub-title {
    font-weight: 670;
    font-size: 0.99rem;
    line-height: 1.32;
    cursor: pointer;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .sub-title:hover { color: var(--pp-accent); }
  .sub-year { color: var(--pp-muted); font-weight: 500; font-size: 0.83rem; }
  .sub-attrs {
    margin-top: 0.32rem;
    font-size: 0.79rem;
    color: var(--pp-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub-progress-wrap { margin-top: auto; padding-top: 0.65rem; }

  .progress {
    height: 6px;
    border-radius: 999px;
    background: var(--pp-panel-2);
    overflow: hidden;
  }
  .progress-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--pp-accent), var(--pp-accent-hover));
    border-radius: 999px;
    transition: width 0.35s var(--pp-ease);
  }
  .progress-bar-done { background: var(--pp-green); }

  .sub-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.32rem;
    font-size: 0.81rem;
    color: var(--pp-text-2);
  }
  .sub-next { font-size: 0.75rem; color: var(--pp-muted); margin-top: 0.34rem; }
  .sub-err-note {
    margin-top: 0.35rem;
    padding: 0.28rem 0.5rem;
    border-radius: 6px;
    background: var(--pp-red-soft);
    color: var(--pp-red);
    font-size: 0.75rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub-footer {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 0.42rem;
    padding: 0.56rem 1rem;
    border-top: 1px solid var(--pp-border);
    background: var(--pp-footer-bg);
  }
  .sub-footer .spacer { flex: 1 1 auto; }
  .sub-del-btn { color: var(--pp-muted); border-color: transparent; }
  .sub-del-btn:hover:not(:disabled) {
    color: var(--pp-red);
    background: var(--pp-red-soft);
    border-color: rgba(248, 113, 113, 0.32);
  }

  /* ---- Custom Select & Floating Popover Menu ---- */
  .cs-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    max-width: 100%;
  }
  .field .cs-wrap { width: 100%; }
  .cs-native {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    width: 1px;
    height: 1px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .cs-trigger {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    background: var(--pp-bg-elevated);
    border: 1px solid var(--pp-border-strong);
    border-radius: var(--pp-radius-sm);
    padding: 0.54rem 0.76rem;
    font-size: 0.9rem;
    color: var(--pp-text);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition: border-color 0.15s var(--pp-ease), box-shadow 0.15s var(--pp-ease), background 0.15s;
  }
  .cs-trigger:hover:not(:disabled) {
    border-color: rgba(139, 146, 165, 0.45);
    background: var(--pp-panel-2);
  }
  .cs-trigger[aria-expanded="true"] {
    border-color: var(--pp-accent);
    box-shadow: 0 0 0 3px var(--pp-accent-soft);
  }
  .cs-trigger:disabled { opacity: 0.55; cursor: not-allowed; }
  .cs-wrap.is-sm .cs-trigger {
    padding: 0.34rem 0.6rem;
    font-size: 0.81rem;
    border-radius: 7px;
    gap: 0.36rem;
  }
  .cs-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cs-caret {
    flex: 0 0 auto;
    display: inline-flex;
    color: var(--pp-muted);
    transition: transform 0.16s var(--pp-ease), color 0.16s;
  }
  .cs-caret svg { transform: rotate(90deg); }
  .cs-trigger[aria-expanded="true"] .cs-caret { color: var(--pp-accent); }
  .cs-trigger[aria-expanded="true"] .cs-caret svg { transform: rotate(-90deg); }

  .pp-popover {
    position: fixed;
    z-index: 95;
    background: var(--pp-panel);
    border: 1px solid var(--pp-border-strong);
    border-radius: 10px;
    box-shadow: var(--pp-shadow-lg);
    padding: 0.3rem;
    max-height: 260px;
    overflow-y: auto;
    animation: pp-fade-in 0.12s var(--pp-ease);
  }
  .pp-popover[hidden] { display: none; }
  .pp-pop-opt {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    background: transparent;
    border: none;
    border-radius: 7px;
    padding: 0.48rem 0.65rem;
    font-size: 0.86rem;
    color: var(--pp-text-2);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition: background 0.1s, color 0.1s;
  }
  .pp-pop-opt:hover, .pp-pop-opt.is-focused {
    background: var(--pp-panel-2);
    color: var(--pp-text);
  }
  .pp-pop-opt.is-selected {
    background: var(--pp-accent-soft);
    color: var(--pp-accent);
    font-weight: 620;
  }
  .pp-pop-check { flex: 0 0 auto; display: inline-flex; opacity: 0; }
  .pp-pop-opt.is-selected .pp-pop-check { opacity: 1; }

  .empty-state {
    border: 1px dashed var(--pp-border-strong);
    border-radius: var(--pp-radius-lg);
    padding: 2.6rem 1.4rem;
    text-align: center;
    color: var(--pp-muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.65rem;
  }
  .empty-state[hidden] { display: none; }
  .empty-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: var(--pp-panel-2);
    color: var(--pp-muted);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .empty-state p { margin: 0; max-width: 420px; font-size: 0.9rem; }

  /* ---- Discover / TMDB ---- */
  .tmdb-search-bar { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  .tmdb-search-bar .input-with-icon { flex: 1 1 260px; }
  .tmdb-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(156px, 1fr));
    gap: 0.95rem;
    margin-top: 1.05rem;
  }
  .tmdb-card {
    position: relative;
    background: var(--pp-panel);
    border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius);
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.18s var(--pp-ease), border-color 0.18s, box-shadow 0.18s;
  }
  .tmdb-card:hover {
    transform: translateY(-3px);
    border-color: var(--pp-accent-border);
    box-shadow: var(--pp-shadow);
  }
  .tmdb-poster-box { position: relative; aspect-ratio: 2 / 3; background: var(--pp-panel-2); overflow: hidden; }
  .tmdb-poster-box img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s var(--pp-ease); }
  .tmdb-card:hover .tmdb-poster-box img { transform: scale(1.04); }
  .tmdb-type-badge {
    position: absolute;
    top: 7px;
    left: 7px;
    font-size: 0.69rem;
    font-weight: 650;
    padding: 0.12rem 0.42rem;
    border-radius: 5px;
    background: rgba(9, 9, 11, 0.78);
    color: #f3f4f6;
    backdrop-filter: blur(4px);
  }
  .tmdb-rate-badge {
    position: absolute;
    bottom: 7px;
    right: 7px;
    font-size: 0.71rem;
    font-weight: 700;
    padding: 0.12rem 0.42rem;
    border-radius: 5px;
    background: rgba(9, 9, 11, 0.82);
    color: #f5b82e;
  }
  .tmdb-info { padding: 0.6rem 0.72rem 0.72rem; }
  .tmdb-info .t {
    font-weight: 620;
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tmdb-info .m { color: var(--pp-muted); font-size: 0.77rem; margin-top: 0.18rem; }
  .guide-card {
    margin-top: 0.95rem;
    border: 1px solid var(--pp-accent-border);
    background: var(--pp-accent-soft);
    border-radius: var(--pp-radius);
    padding: 1rem 1.15rem;
  }
  .guide-card h3 { margin: 0 0 0.35rem; color: var(--pp-text); }

  /* ---- Explore (MoviePilot-inspired shelves & grids) ---- */
  .exp-topbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }
  .exp-panel { display: none; }
  .exp-panel.active { display: block; animation: pp-fade-in 0.18s var(--pp-ease); }

  .exp-shelf { margin-bottom: 1.65rem; }
  .exp-shelf-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  .exp-shelf-title-wrap { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  .exp-shelf-title { margin: 0; font-size: 1.06rem; font-weight: 700; letter-spacing: -0.01em; }
  .exp-src-tag {
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.1rem 0.45rem;
    border-radius: 5px;
    letter-spacing: 0.02em;
    flex: 0 0 auto;
  }
  .exp-src-tmdb { background: var(--pp-sky-soft); color: var(--pp-sky); }
  .exp-src-douban { background: var(--pp-green-soft); color: var(--pp-green); }

  .exp-track-wrap { position: relative; }
  .exp-track {
    display: flex;
    gap: 0.9rem;
    overflow-x: auto;
    scroll-behavior: smooth;
    scroll-snap-type: x proximity;
    padding: 0.15rem 0.05rem 0.4rem;
    scrollbar-width: none;
  }
  .exp-track::-webkit-scrollbar { display: none; }
  .exp-track .exp-card { flex: 0 0 158px; scroll-snap-align: start; }

  .exp-scroll-btn {
    position: absolute;
    top: 38%;
    transform: translateY(-50%);
    z-index: 4;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid var(--pp-border-strong);
    background: var(--pp-topbar-bg);
    backdrop-filter: blur(8px);
    color: var(--pp-text);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: var(--pp-shadow);
    opacity: 0;
    transition: opacity 0.16s, background 0.15s, border-color 0.15s;
  }
  .exp-track-wrap:hover .exp-scroll-btn { opacity: 1; }
  .exp-scroll-btn:hover { background: var(--pp-panel-2); border-color: var(--pp-accent); color: var(--pp-accent); }
  .exp-scroll-prev { left: 6px; }
  .exp-scroll-next { right: 6px; }

  .exp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
    gap: 1rem;
  }
  .exp-card {
    position: relative;
    background: var(--pp-panel);
    border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius);
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.18s var(--pp-ease), border-color 0.18s, box-shadow 0.18s;
  }
  .exp-card:hover {
    transform: translateY(-3px);
    border-color: var(--pp-accent-border);
    box-shadow: var(--pp-shadow);
  }
  .exp-card.is-loading { pointer-events: none; opacity: 0.65; }
  .exp-poster {
    position: relative;
    aspect-ratio: 2 / 3;
    background: var(--pp-panel-2);
    overflow: hidden;
  }
  .exp-poster img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.3s var(--pp-ease);
  }
  .exp-card:hover .exp-poster img { transform: scale(1.04); }
  .exp-sub-badge {
    position: absolute;
    top: 7px;
    right: 7px;
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.14rem 0.45rem;
    border-radius: 5px;
    background: rgba(13, 150, 104, 0.92);
    color: #fff;
    box-shadow: var(--pp-shadow-sm);
  }
  .exp-ep-badge {
    position: absolute;
    left: 7px;
    bottom: 7px;
    max-width: calc(100% - 62px);
    font-size: 0.68rem;
    font-weight: 600;
    padding: 0.12rem 0.42rem;
    border-radius: 5px;
    background: rgba(9, 9, 11, 0.78);
    color: #e5e7eb;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    backdrop-filter: blur(4px);
  }
  .exp-info { padding: 0.62rem 0.72rem 0.74rem; }
  .exp-title {
    font-weight: 630;
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .exp-meta {
    color: var(--pp-muted);
    font-size: 0.76rem;
    margin-top: 0.2rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .exp-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    padding: 0.85rem 1rem;
    background: var(--pp-panel);
    border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius);
    margin-bottom: 1.15rem;
  }
  .exp-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.42rem;
    margin-bottom: 1.15rem;
  }
  .exp-more-wrap { text-align: center; margin-top: 1.35rem; }

  /* ---- Logs View ---- */
  .logs-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    align-items: center;
    margin-bottom: 0.85rem;
  }
  .logs-toolbar select { max-width: 240px; }
  .logs-toolbar .btn { margin-left: auto; }
  .log-list { display: flex; flex-direction: column; gap: 0.45rem; }
  .log-row {
    display: flex;
    gap: 0.8rem;
    align-items: flex-start;
    padding: 0.68rem 0.85rem;
    background: var(--pp-bg-elevated);
    border: 1px solid var(--pp-border);
    border-left: 3px solid var(--pp-sky);
    border-radius: var(--pp-radius-sm);
    cursor: pointer;
    transition: background 0.13s, border-color 0.13s;
  }
  .log-row:hover { background: var(--pp-panel-2); }
  .log-row.lv-warn { border-left-color: var(--pp-amber); }
  .log-row.lv-error { border-left-color: var(--pp-red); }
  .log-time {
    flex: 0 0 9.4rem;
    color: var(--pp-muted);
    font-size: 0.79rem;
    font-family: var(--pp-mono);
    padding-top: 0.14rem;
    white-space: nowrap;
  }
  .log-badge { flex: 0 0 auto; text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.03em; }
  .log-main { flex: 1 1 auto; min-width: 0; }
  .log-sub {
    font-size: 0.8rem;
    color: var(--pp-muted);
    margin-bottom: 0.18rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .log-event { font-weight: 620; font-size: 0.89rem; color: var(--pp-text); }
  .log-msg {
    font-size: 0.85rem;
    line-height: 1.5;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .log-row.expanded .log-msg { display: block; overflow: visible; }
  .log-detail {
    color: var(--pp-muted);
    font-family: var(--pp-mono);
    font-size: 0.8rem;
    margin-left: 0.35rem;
  }
  .log-row.expanded .log-detail {
    display: block;
    margin: 0.45rem 0 0;
    padding: 0.55rem 0.7rem;
    border-radius: 6px;
    background: var(--pp-panel);
    border: 1px solid var(--pp-border);
    white-space: pre-wrap;
    color: var(--pp-text-2);
  }
  .log-caret {
    flex: 0 0 auto;
    color: var(--pp-muted);
    margin-top: 0.18rem;
    transition: transform 0.16s;
  }
  .log-row.expanded .log-caret { transform: rotate(90deg); color: var(--pp-accent); }
  .log-more-wrap { text-align: center; margin-top: 1rem; }

  /* ---- Settings View (v0.8 keep panels mounted!) ---- */
  .settings-tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1.15rem;
    border-bottom: 1px solid var(--pp-border);
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .settings-tabs::-webkit-scrollbar { display: none; }
  .settings-tab {
    position: relative;
    flex: 0 0 auto;
    white-space: nowrap;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--pp-muted);
    font-size: 0.92rem;
    font-weight: 550;
    padding: 0.65rem 1rem;
    margin-bottom: -1px;
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }
  .settings-tab:hover { color: var(--pp-text); }
  .settings-tab.active {
    color: var(--pp-text);
    font-weight: 650;
    border-bottom-color: var(--pp-accent);
  }
  .tab-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--pp-red);
    margin-left: 0.35rem;
    vertical-align: super;
  }
  .tab-dot[hidden] { display: none; }
  .settings-panel { display: none; }
  .settings-panel.active { display: block; animation: pp-fade-in 0.18s var(--pp-ease); }

  .status-pill-box {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.28rem 0.7rem;
    border-radius: 999px;
    background: var(--pp-bg-elevated);
    border: 1px solid var(--pp-border);
    font-size: 0.82rem;
  }
  .preview-terminal {
    margin-top: 0.9rem;
    padding: 0.85rem 1rem;
    border-radius: var(--pp-radius);
    background: var(--pp-terminal-bg);
    color: var(--pp-terminal-text);
    border: 1px solid var(--pp-border-strong);
    font-family: var(--pp-mono);
    font-size: 0.81rem;
    line-height: 1.7;
    overflow-x: auto;
  }
  .preview-line { display: flex; gap: 0.6rem; align-items: baseline; }
  .preview-tag { color: #f5b82e; flex: 0 0 4.8rem; font-weight: 600; }

  .once-vault {
    border: 1px solid var(--pp-accent-border);
    background: var(--pp-accent-soft);
    border-radius: var(--pp-radius);
    padding: 0.95rem 1.05rem;
    margin: 0.9rem 0;
  }
  .once-vault-title {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--pp-accent);
    font-weight: 700;
    font-size: 0.9rem;
    margin: 0 0 0.6rem;
  }
  .once-vault input { font-family: var(--pp-mono); font-size: 0.84rem; }

  .dk-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding: 0.72rem 0.85rem;
    border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius-sm);
    background: var(--pp-bg-elevated);
    margin-bottom: 0.5rem;
  }
  .dk-main { flex: 1 1 220px; min-width: 0; }
  .dk-name { font-weight: 630; font-size: 0.93rem; display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap; }
  .dk-sub { font-size: 0.79rem; color: var(--pp-muted); margin-top: 0.16rem; }
  .dk-actions { display: flex; align-items: center; gap: 0.4rem; }

  /* ---- Modal & Episode Matrix ---- */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--pp-backdrop);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 60;
    animation: pp-fade-in 0.16s var(--pp-ease);
  }
  .modal-backdrop[hidden] { display: none; }
  .modal {
    position: relative;
    background: var(--pp-panel);
    border: 1px solid var(--pp-border-strong);
    border-radius: var(--pp-radius-lg);
    box-shadow: var(--pp-shadow-lg);
    max-width: 680px;
    width: 100%;
    max-height: 90vh;
    overflow: auto;
    padding: 1.35rem;
  }
  .modal-sm { max-width: 440px; }
  .modal-close {
    position: absolute;
    top: 0.9rem;
    right: 0.9rem;
    z-index: 2;
  }
  .modal-hero {
    position: relative;
    display: flex;
    gap: 1.15rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--pp-border);
  }
  .modal-hero img, .modal-hero .poster-ph {
    width: 112px;
    height: 168px;
    border-radius: 10px;
    object-fit: cover;
    flex: 0 0 auto;
    box-shadow: var(--pp-shadow);
  }
  .modal-hero .poster-ph { font-size: 2.3rem; }
  .modal-title { font-size: 1.2rem; font-weight: 750; padding-right: 2rem; line-height: 1.3; }
  .modal-section { margin-top: 1rem; }
  .modal-section-title { font-size: 0.82rem; font-weight: 650; color: var(--pp-muted); margin-bottom: 0.48rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .modal-actions { display: flex; gap: 0.6rem; justify-content: flex-end; margin-top: 1.2rem; }
  .overview {
    color: var(--pp-text-2);
    font-size: 0.88rem;
    line-height: 1.65;
    margin: 0.45rem 0 0;
  }

  .ep-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(42px, 1fr));
    gap: 0.4rem;
  }
  .ep-cell {
    height: 34px;
    border-radius: 7px;
    border: 1px solid var(--pp-border);
    background: var(--pp-bg-elevated);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.78rem;
    font-weight: 650;
    color: var(--pp-muted);
    font-variant-numeric: tabular-nums;
  }
  .ep-stored { background: var(--pp-green-soft); border-color: rgba(45, 212, 160, 0.35); color: var(--pp-green); }
  .ep-transferring, .ep-found { background: var(--pp-sky-soft); border-color: rgba(56, 189, 248, 0.35); color: var(--pp-sky); }
  .ep-failed { background: var(--pp-red-soft); border-color: rgba(248, 113, 113, 0.4); color: var(--pp-red); }
  .ep-skipped { opacity: 0.55; text-decoration: line-through; }

  /* ---- Toast Stack ---- */
  .toast-stack {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    z-index: 90;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: min(380px, calc(100vw - 2rem));
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.72rem 0.95rem;
    border-radius: var(--pp-radius);
    background: var(--pp-panel);
    border: 1px solid var(--pp-border-strong);
    border-left: 3px solid var(--pp-accent);
    box-shadow: var(--pp-shadow-lg);
    font-size: 0.88rem;
    color: var(--pp-text);
    animation: pp-toast-in 0.2s var(--pp-ease);
  }
  .toast.t-success { border-left-color: var(--pp-green); }
  .toast.t-error { border-left-color: var(--pp-red); }
  .toast.t-warn { border-left-color: var(--pp-amber); }
  .toast-icon { flex: 0 0 auto; display: flex; }
  .toast.t-success .toast-icon { color: var(--pp-green); }
  .toast.t-error .toast-icon { color: var(--pp-red); }
  .toast.t-warn .toast-icon { color: var(--pp-amber); }
  .toast-text { flex: 1 1 auto; min-width: 0; word-break: break-word; }
  @keyframes pp-toast-in {
    from { opacity: 0; transform: translateY(10px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ---- Login Page ---- */
  .login-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    position: relative;
    background:
      radial-gradient(680px 380px at 50% 0%, var(--pp-accent-soft), transparent 65%),
      radial-gradient(520px 360px at 85% 90%, rgba(56, 189, 248, 0.08), transparent 60%),
      var(--pp-bg);
  }
  .login-theme-btn { position: fixed; top: 1rem; right: 1rem; }
  .login-card {
    width: 100%;
    max-width: 408px;
    background: var(--pp-panel);
    border: 1px solid var(--pp-border-strong);
    border-radius: 20px;
    box-shadow: var(--pp-shadow-lg);
    padding: 2.2rem 1.9rem 1.8rem;
  }
  .login-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.45rem;
    margin-bottom: 1.5rem;
    text-align: center;
  }
  .login-brand .brand-logo { width: 48px; height: 48px; border-radius: 13px; }
  .login-brand .brand-name { font-size: 1.35rem; }
  .login-card form { display: flex; flex-direction: column; gap: 0.9rem; }
  .login-card .btn-primary { padding: 0.7rem; margin-top: 0.25rem; font-size: 0.95rem; }
  .login-alert {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.62rem 0.8rem;
    border-radius: var(--pp-radius-sm);
    background: var(--pp-red-soft);
    border: 1px solid rgba(248, 113, 113, 0.35);
    color: var(--pp-red);
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }
  .login-foot { text-align: center; margin-top: 1.2rem; font-size: 0.79rem; }

  /* ---- Responsive (Mobile <= 880px) ---- */
  @media (max-width: 960px) {
    .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 880px) {
    .sidebar { display: none; }
    .mobile-brand { display: flex; }
    .mobile-only { display: inline-flex; }
    .topbar-user { display: none; }
    .topbar { padding: 0.75rem 1rem; }
    .page-title { font-size: 1.05rem; }
    .content { padding: 1rem 0.95rem calc(5.4rem + env(safe-area-inset-bottom, 0px)); }
    .sub-grid { grid-template-columns: 1fr; }
    .form-grid-2, .form-grid-3 { grid-template-columns: 1fr; }
    .sub-search-wrap { margin-left: 0; max-width: none; flex-basis: 100%; }
    .log-time { flex-basis: auto; font-size: 0.75rem; }
    .log-row { flex-wrap: wrap; gap: 0.4rem 0.6rem; }
    .modal-hero { flex-direction: column; align-items: flex-start; }
    .alert-banner { flex-wrap: wrap; }
    .toast-stack { right: 0.75rem; left: 0.75rem; bottom: calc(4.6rem + env(safe-area-inset-bottom, 0px)); max-width: none; }

    .mobile-tabs {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      background: var(--pp-topbar-bg);
      backdrop-filter: blur(12px);
      border-top: 1px solid var(--pp-border);
      padding: 0.35rem 0.15rem calc(0.35rem + env(safe-area-inset-bottom, 0px));
    }
    .mobile-tab {
      position: relative;
      border: none;
      background: transparent;
      color: var(--pp-muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.14rem;
      padding: 0.34rem 0.1rem;
      font-size: 0.66rem;
      font-weight: 550;
      cursor: pointer;
    }
    .exp-scroll-btn { display: none; }
    .exp-track .exp-card { flex: 0 0 138px; }
    .exp-grid { grid-template-columns: repeat(auto-fill, minmax(144px, 1fr)); gap: 0.78rem; }
    .mobile-tab.active { color: var(--pp-accent); font-weight: 650; }
    .mobile-tab .nav-dot {
      position: absolute;
      top: 4px;
      right: 26%;
      margin: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;
