/**
 * Unified inline SVG icon set (1.75px stroke, rounded caps/joins).
 * Zero external icon-font dependencies; inherits currentColor.
 */

const svg = (size: number, body: string): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON_BRAND = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="4" width="19" height="16" rx="3" stroke="currentColor" stroke-width="1.9"/><path d="M7 4v16M17 4v16M2.5 9.5H7M2.5 14.5H7M17 9.5h4.5M17 14.5h4.5" stroke="currentColor" stroke-width="1.6" opacity=".65"/><path d="M10.4 9.2l4.8 2.8-4.8 2.8V9.2z" fill="currentColor"/></svg>`;

export const ICON_DASH = svg(18, '<rect x="3" y="3" width="7.5" height="9" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.8"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.8"/><rect x="3" y="15" width="7.5" height="6" rx="1.8"/>');
export const ICON_SUBS = svg(18, '<rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M3 9.5h18M8.5 4v5.5"/>');
export const ICON_FIND = svg(18, '<circle cx="11" cy="11" r="7.5"/><path d="M20.5 20.5l-4.2-4.2"/>');
export const ICON_LOG = svg(18, '<path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14.5 3v4.5H19M8.5 12h7M8.5 16h5"/>');
export const ICON_GEAR = svg(18, '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>');

export const ICON_SEARCH = svg(16, '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.8-3.8"/>');
export const ICON_PLUS = svg(16, '<path d="M12 5v14M5 12h14"/>');
export const ICON_SUN = svg(16, '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>');
export const ICON_MOON = svg(16, '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>');
export const ICON_LOGOUT = svg(16, '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>');
export const ICON_REFRESH = svg(15, '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>');
export const ICON_PAUSE = svg(14, '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>');
export const ICON_PLAY = svg(14, '<polygon points="6 3 20 12 6 21 6 3"/>');
export const ICON_TRASH = svg(14, '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>');
export const ICON_INFO = svg(16, '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>');
export const ICON_CLOSE = svg(16, '<path d="M18 6L6 18M6 6l12 12"/>');
export const ICON_CHECK = svg(16, '<path d="M20 6L9 17l-5-5"/>');
export const ICON_ALERT = svg(16, '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>');
export const ICON_COPY = svg(15, '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
export const ICON_EYE = svg(16, '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>');
export const ICON_EYE_OFF = svg(16, '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>');
export const ICON_CHEVRON = svg(14, '<path d="M9 18l6-6-6-6"/>');
export const ICON_KEY = svg(16, '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>');
export const ICON_FOLDER = svg(16, '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>');
export const ICON_ARROW_RIGHT = svg(15, '<path d="M5 12h14M13 6l6 6-6 6"/>');
export const ICON_FILM = svg(28, '<rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M2 9.5h5M2 14.5h5M17 9.5h5M17 14.5h5M7 12h10"/>');
