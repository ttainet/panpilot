/**
 * Quality preference profile ("画质偏好") — PanPilot v1.0.
 *
 * A global profile lives in the `quality` settings key (JSON) and is edited
 * on the settings page （画质偏好 tab). It tells the Driver how to pick
 * between candidate sources for a subscription:
 *
 *   1. HARD FILTERS first — a candidate matching any enabled exclusion is
 *      dropped outright: REMUX / Blu-ray originals (exclude_remux),
 *      CAM/TS/TC camcorder rips (exclude_cam), any user exclude_keywords
 *      hit, a per-episode size above max_episode_gb (when > 0), and —
 *      when allow_fallback is false — any resolution other than the
 *      preferred one.
 *   2. SCORING next — preferred resolution ranks highest, fallbacks rank
 *      by distance; H.265/HEVC is weighted above H.264 when prefer_h265;
 *      source priority is fixed WEB-DL > BluRay (non-REMUX) > HDTV.
 *      A season that already has stored episodes keeps ITS spec: the
 *      already-stored spec outranks this profile (no mixing within a
 *      season — see the AI Driver guide §7 / §5.4).
 *
 * A subscription may override ONLY the preferred resolution (the
 * `subscriptions.quality` column: "2160p" | "1080p" | "720p", NULL =
 * follow the global profile). GET /api/driver/pending attaches the merged
 * effective profile as `quality_profile` to every subscription, and
 * GET /api/driver/config returns the global profile as `quality`, so a
 * Driver never has to merge anything itself.
 */

export interface QualityProfile {
  /** Preferred resolution: "2160p" | "1080p" | "720p" | "any". */
  preferred_resolution: string;
  /** When false, candidates at any other resolution are hard-filtered. */
  allow_fallback: boolean;
  /** Exclude REMUX / Blu-ray original-disc sources. */
  exclude_remux: boolean;
  /** Exclude CAM / TS / TC camcorder rips. */
  exclude_cam: boolean;
  /** At equal resolution, prefer H.265 / HEVC / x265 over H.264. */
  prefer_h265: boolean;
  /** Per-episode size cap in GB; 0 = no cap. Above-cap candidates are excluded. */
  max_episode_gb: number;
  /** Custom exclusion keywords; a hit in a candidate title/file name excludes it. */
  exclude_keywords: string[];
}

/** Resolutions a subscription-level override may take (NULL = follow global). */
export const QUALITY_OVERRIDE_RESOLUTIONS = ["2160p", "1080p", "720p"] as const;

/** All values `preferred_resolution` may take in the global profile. */
export const QUALITY_RESOLUTIONS = ["2160p", "1080p", "720p", "any"] as const;

export const DEFAULT_QUALITY: QualityProfile = {
  preferred_resolution: "1080p",
  allow_fallback: true,
  exclude_remux: true,
  exclude_cam: true,
  prefer_h265: true,
  max_episode_gb: 0,
  exclude_keywords: [],
};

const BOOL_FIELDS = ["allow_fallback", "exclude_remux", "exclude_cam", "prefer_h265"] as const;
const MAX_EPISODE_GB_LIMIT = 1024;
const MAX_EXCLUDE_KEYWORDS = 100;
const MAX_KEYWORD_LENGTH = 64;

function isValidResolution(v: unknown): v is string {
  return typeof v === "string" && (QUALITY_RESOLUTIONS as readonly string[]).includes(v);
}

function isValidMaxGb(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_EPISODE_GB_LIMIT;
}

function normalizeKeywords(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_EXCLUDE_KEYWORDS) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== "string") return null;
    const kw = item.trim();
    if (!kw || kw.length > MAX_KEYWORD_LENGTH) return null;
    const k = kw.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(kw);
  }
  return out;
}

/**
 * Validate a user-supplied quality profile for saving.
 * Returns the normalized object, or an error message. Fields missing from
 * the payload fall back to the defaults (same back-compat policy as
 * directories templates), so older clients never break on a new field.
 */
export function validateQuality(input: unknown): { value?: QualityProfile; error?: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { error: "quality 必须是 JSON 对象" };
  }
  const o = input as Record<string, unknown>;
  const out: QualityProfile = JSON.parse(JSON.stringify(DEFAULT_QUALITY)) as QualityProfile;
  if (o.preferred_resolution !== undefined) {
    if (!isValidResolution(o.preferred_resolution)) {
      return { error: `preferred_resolution 不合法：应为 ${QUALITY_RESOLUTIONS.join(" / ")} 之一` };
    }
    out.preferred_resolution = o.preferred_resolution;
  }
  for (const f of BOOL_FIELDS) {
    if (o[f] !== undefined) {
      if (typeof o[f] !== "boolean") return { error: `${f} 不合法：应为 true / false` };
      out[f] = o[f] as boolean;
    }
  }
  if (o.max_episode_gb !== undefined) {
    if (!isValidMaxGb(o.max_episode_gb)) {
      return { error: `max_episode_gb 不合法：应为 0（不限）到 ${MAX_EPISODE_GB_LIMIT} 之间的数字` };
    }
    out.max_episode_gb = o.max_episode_gb;
  }
  if (o.exclude_keywords !== undefined) {
    const kws = normalizeKeywords(o.exclude_keywords);
    if (!kws) {
      return { error: `exclude_keywords 不合法：应为字符串数组（最多 ${MAX_EXCLUDE_KEYWORDS} 条，每条 1–${MAX_KEYWORD_LENGTH} 字符）` };
    }
    out.exclude_keywords = kws;
  }
  return { value: out };
}

/**
 * Resolve the effective global profile: the stored JSON (when present and
 * field-valid) merged over the defaults, field by field. A malformed
 * stored value never breaks resolution — invalid fields fall back.
 */
export function resolveQuality(rawJson: string | null): QualityProfile {
  const out: QualityProfile = JSON.parse(JSON.stringify(DEFAULT_QUALITY)) as QualityProfile;
  if (!rawJson) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(rawJson); } catch { return out; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return out;
  const o = parsed as Record<string, unknown>;
  if (isValidResolution(o.preferred_resolution)) out.preferred_resolution = o.preferred_resolution;
  for (const f of BOOL_FIELDS) if (typeof o[f] === "boolean") out[f] = o[f] as boolean;
  if (isValidMaxGb(o.max_episode_gb)) out.max_episode_gb = o.max_episode_gb;
  const kws = o.exclude_keywords === undefined ? undefined : normalizeKeywords(o.exclude_keywords);
  if (kws) out.exclude_keywords = kws;
  return out;
}

/**
 * Validate a subscription-level resolution override. Returns the
 * normalized resolution, null for "follow the global profile" (absent /
 * null / empty string), or an error message for anything else.
 */
export function normalizeQualityOverride(v: unknown): { value?: string | null; error?: string } {
  if (v === undefined || v === null || v === "") return { value: null };
  if (typeof v === "string" && (QUALITY_OVERRIDE_RESOLUTIONS as readonly string[]).includes(v)) {
    return { value: v };
  }
  return { error: `quality 不合法：应为 ${QUALITY_OVERRIDE_RESOLUTIONS.join(" / ")} 之一，或留空表示跟随全局画质偏好` };
}

/**
 * The effective profile for one subscription: the global profile with the
 * subscription's resolution override applied (when set). Everything else —
 * including allow_fallback — always comes from the global profile.
 */
export function qualityProfileFor(global: QualityProfile, subQuality: string | null | undefined): QualityProfile {
  if (!subQuality || !(QUALITY_OVERRIDE_RESOLUTIONS as readonly string[]).includes(subQuality)) {
    return global;
  }
  return { ...global, preferred_resolution: subQuality };
}
