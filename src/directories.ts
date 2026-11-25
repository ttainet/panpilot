/**
 * Library directory settings ("入库目录") — PanPilot v0.7.
 *
 * The Driver files transferred media into the user's Quark library using
 * this layout. The defaults below mirror the owner's REAL Quark structure
 * (read back via the Quark API with their cookie and confirmed):
 *
 *   电影电视剧/            <- base_dir
 *     电视剧/              <- tv_dir
 *       国产剧/ 欧美剧/ 日韩剧/     (region folders; JP and KR are MERGED
 *       国漫/ 纪录片/ 综艺/          into 日韩剧, specials live under 电视剧)
 *       <剧名夹也可能直接放在电视剧层>
 *     电影/                <- movie_dir
 *       华语电影/ 外语电影/ 动画电影/
 *
 * Title folders are "{title} ({year})", TV gets a "Season {N}" layer,
 * episode files are "{title} - S{ss}E{ee} - 第 {e} 集.<ext>", movie files are
 * "{title} ({year})<ext>" (movie_name_template, no extension in the
 * template) and variety files use 第 {e} 期 (variety_name_template, v0.9).
 *
 * The whole object is user-editable on the settings page and stored as the
 * `directories` settings key (JSON). When the key is absent these defaults
 * apply. `GET /api/driver/config` always returns the EFFECTIVE object, and
 * region classification everywhere (including TMDB subscribe backfill)
 * follows these maps — see regionForMedia().
 */

export interface DirectorySettings {
  /** Library root folder in the drive, e.g. "电影电视剧". */
  base_dir: string;
  /** Folder under base_dir holding all TV-side content. */
  tv_dir: string;
  /** Folder under base_dir holding movies. */
  movie_dir: string;
  /** TMDB origin_country code (or "*") -> TV region folder under tv_dir. */
  tv_region_map: Record<string, string>;
  /** Special TV categories under tv_dir: animation_cn | documentary | variety. */
  tv_special_map: Record<string, string>;
  /** TMDB origin_country code, "animation", or "*" -> movie category folder under movie_dir. */
  movie_category_map: Record<string, string>;
  /** Title folder template; placeholders: {title} {year}. */
  title_template: string;
  /** Season folder template; placeholders: {season} {season:02}. */
  season_template: string;
  /** Episode file name template (without extension); placeholders:
   *  {title} {season} {season:02} {episode} {episode:02}. */
  episode_name_template: string;
  /** Movie file name template (without extension); the file lives directly
   *  in the title folder (no Season layer). Placeholders: {title} {year}.
   *  Added in v0.9; older stored settings without this key fall back to the
   *  default (see resolveDirectories). */
  movie_name_template: string;
  /** Variety file name template (without extension); like the episode
   *  template but the counter is a 期 (issue), not a 集.
   *  Placeholders: {title} {season} {season:02} {episode} {episode:02}.
   *  Added in v0.9; older stored settings fall back to the default. */
  variety_name_template: string;
}

export const DEFAULT_DIRECTORIES: DirectorySettings = {
  base_dir: "电影电视剧",
  tv_dir: "电视剧",
  movie_dir: "电影",
  tv_region_map: { CN: "国产剧", HK: "国产剧", TW: "国产剧", JP: "日韩剧", KR: "日韩剧", "*": "欧美剧" },
  tv_special_map: { animation_cn: "国漫", documentary: "纪录片", variety: "综艺" },
  movie_category_map: { CN: "华语电影", HK: "华语电影", TW: "华语电影", animation: "动画电影", "*": "外语电影" },
  title_template: "{title} ({year})",
  season_template: "Season {season}",
  episode_name_template: "{title} - S{season:02}E{episode:02} - 第 {episode} 集",
  movie_name_template: "{title} ({year})",
  variety_name_template: "{title} - S{season:02}E{episode:02} - 第 {episode} 期",
};

const PATH_FIELDS = ["base_dir", "tv_dir", "movie_dir"] as const;
const MAP_FIELDS = ["tv_region_map", "tv_special_map", "movie_category_map"] as const;
const TEMPLATE_FIELDS = [
  "title_template", "season_template", "episode_name_template",
  "movie_name_template", "variety_name_template",
] as const;

/** A single library path (may contain "/" separators, but no leading/trailing
 *  slash, no empty segments, no backslashes, no ".."). */
function isValidRelPath(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s || s.length > 200) return false;
  if (s.startsWith("/") || s.endsWith("/")) return false;
  if (s.includes("\\") || s.includes("//")) return false;
  return s.split("/").every((seg) => seg.trim() !== "" && seg !== "." && seg !== "..");
}

/** Map values are single folder names (one segment, non-empty). */
function isValidFolderName(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && v.length <= 100
    && !v.includes("/") && !v.includes("\\") && v.trim() !== "." && v.trim() !== "..";
}

function isValidMap(v: unknown): v is Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return false;
  return entries.every(([k, val]) =>
    k.trim() !== "" && k.length <= 32 && !/[\s/\\]/.test(k) && isValidFolderName(val));
}

function isValidTemplate(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && v.length <= 200
    && !v.includes("/") && !v.includes("\\");
}

/**
 * Validate a user-supplied directories object for saving.
 * Returns the normalized (trimmed) object, or an error message.
 */
export function validateDirectories(input: unknown): { value?: DirectorySettings; error?: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { error: "directories 必须是 JSON 对象" };
  }
  const o = input as Record<string, unknown>;
  const out = {} as DirectorySettings;
  for (const f of PATH_FIELDS) {
    if (!isValidRelPath(o[f])) {
      return { error: `${f} 不合法：应为非空相对路径，不含首尾斜杠、反斜杠或 ..` };
    }
    out[f] = (o[f] as string).trim();
  }
  for (const f of MAP_FIELDS) {
    if (!isValidMap(o[f])) {
      return { error: `${f} 不合法：应为非空对象，键为代码（如 CN / JP / * / animation），值为非空文件夹名` };
    }
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(o[f] as Record<string, string>)) m[k.trim()] = v.trim();
    out[f] = m;
  }
  for (const f of TEMPLATE_FIELDS) {
    // Backward compatibility: a template key added in a later version
    // (movie_name_template / variety_name_template, v0.9) may be absent
    // from an older client's payload — fill the default instead of 400.
    const raw = o[f] === undefined ? DEFAULT_DIRECTORIES[f] : o[f];
    if (!isValidTemplate(raw)) {
      return { error: `${f} 不合法：应为非空字符串且不含斜杠` };
    }
    out[f] = (raw as string).trim();
  }
  if (!out.title_template.includes("{title}")) return { error: "title_template 必须包含 {title}" };
  if (!out.season_template.includes("{season")) return { error: "season_template 必须包含 {season}" };
  if (!out.episode_name_template.includes("{episode")) {
    return { error: "episode_name_template 必须包含 {episode}" };
  }
  if (!out.movie_name_template.includes("{title}")) {
    return { error: "movie_name_template 必须包含 {title}" };
  }
  if (!out.variety_name_template.includes("{episode")) {
    return { error: "variety_name_template 必须包含 {episode}" };
  }
  return { value: out };
}

/**
 * Resolve the effective directory settings: the stored JSON (when present
 * and field-valid) merged over the defaults, field by field. A malformed
 * stored value never breaks resolution — invalid fields fall back.
 */
export function resolveDirectories(rawJson: string | null): DirectorySettings {
  const out: DirectorySettings = JSON.parse(JSON.stringify(DEFAULT_DIRECTORIES)) as DirectorySettings;
  if (!rawJson) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(rawJson); } catch { return out; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return out;
  const o = parsed as Record<string, unknown>;
  for (const f of PATH_FIELDS) if (isValidRelPath(o[f])) out[f] = (o[f] as string).trim();
  for (const f of MAP_FIELDS) if (isValidMap(o[f])) out[f] = o[f] as Record<string, string>;
  for (const f of TEMPLATE_FIELDS) if (isValidTemplate(o[f])) out[f] = (o[f] as string).trim();
  return out;
}

// TMDB genre ids used for the special categories.
const GENRE_ANIMATION = 16;
const GENRE_DOCUMENTARY = 99;
const GENRE_REALITY = 10764;
const GENRE_TALK = 10767;
const CN_FAMILY = new Set(["CN", "HK", "TW"]);

/**
 * Classify a TMDB title into the user's library category folder, following
 * the directories maps (NOT a hard-coded table):
 * - movie: animation genre wins (动画电影), else origin_country map, else "*".
 * - tv: Chinese animation -> tv_special_map.animation_cn (国漫);
 *   documentary genre -> 纪录片; reality/talk genre -> 综艺;
 *   else tv_region_map by origin_country (JP/KR -> 日韩剧 with defaults),
 *   else the "*" entry.
 * - variety (user-declared): the 综艺 special folder.
 * `country` is the first TMDB origin_country code; `genreIds` are TMDB
 * genre ids (from search results' genre_ids or details' genres[].id).
 */
export function regionForMedia(
  dirs: DirectorySettings,
  country: string | undefined,
  mediaType: "tv" | "movie" | "variety",
  genreIds: number[] = [],
): string {
  const c = (country ?? "").toUpperCase();
  if (mediaType === "movie") {
    if (genreIds.includes(GENRE_ANIMATION) && dirs.movie_category_map["animation"]) {
      return dirs.movie_category_map["animation"];
    }
    return dirs.movie_category_map[c] ?? dirs.movie_category_map["*"] ?? DEFAULT_DIRECTORIES.movie_category_map["*"];
  }
  if (mediaType === "variety" && dirs.tv_special_map["variety"]) {
    return dirs.tv_special_map["variety"];
  }
  if (genreIds.includes(GENRE_ANIMATION) && CN_FAMILY.has(c) && dirs.tv_special_map["animation_cn"]) {
    return dirs.tv_special_map["animation_cn"];
  }
  if (genreIds.includes(GENRE_DOCUMENTARY) && dirs.tv_special_map["documentary"]) {
    return dirs.tv_special_map["documentary"];
  }
  if ((genreIds.includes(GENRE_REALITY) || genreIds.includes(GENRE_TALK)) && dirs.tv_special_map["variety"]) {
    return dirs.tv_special_map["variety"];
  }
  return dirs.tv_region_map[c] ?? dirs.tv_region_map["*"] ?? DEFAULT_DIRECTORIES.tv_region_map["*"];
}

/** Render a template: {name} and zero-padded {name:02} placeholders. */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)(?::0(\d+))?\}/g, (_m, name: string, pad?: string) => {
    const v = vars[name];
    if (v === undefined) return `{${name}}`;
    if (pad && typeof v === "number") return String(v).padStart(Number(pad), "0");
    return String(v);
  });
}
