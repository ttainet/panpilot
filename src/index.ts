/**
 * PanPilot — subscription control plane (Cloudflare Workers)
 *
 * v0.4: MoviePilot-style dark SPA UI (own implementation, layout inspired by
 * MoviePilot — no GPL code/assets reused), poster-wall subscriptions,
 * dashboard stats, TMDB poster/overview/rating stored on subscriptions.
 *
 * v0.3: real implementation.
 * - Web UI protected by a simple username/password login
 *   (APP_USERNAME / APP_PASSWORD secrets, HMAC-signed session cookie).
 *   The settings page can override the login credentials: an override pair
 *   (auth_username / PBKDF2-hashed auth_password) in the settings table then
 *   takes precedence over the secrets, and changing credentials invalidates
 *   all previously issued sessions (credential fingerprint in the cookie).
 * - Storage: D1 when a DB binding exists (default), in-memory fallback
 *   otherwise; /api/health honestly reports which store is active.
 * - Driver API uses an independent Bearer token (DRIVER_TOKEN secret).
 * - Settings page stores the TMDB API key in the settings table (masked in
 *   the UI); TMDB search/detail endpoints power the subscribe flow.
 *
 * v0.5: at the owner's explicit request, the settings page can also store a
 * Quark cookie — but ONLY AES-GCM-encrypted (key from the COOKIE_ENC_SECRET
 * Worker secret; the feature is disabled when that secret is unset, there is
 * no plaintext fallback). The web API never returns the cookie (plaintext or
 * ciphertext); only the Driver API (GET /api/driver/config) may retrieve the
 * decrypted value, and the Driver reports validity back via
 * POST /api/driver/quark-status. TG channel lists are also configurable in
 * settings, defaulting to the verified seed lists in channels.ts.
 *
 * v0.6: Driver credentials are fully provisioned by PanPilot. The settings
 * page manages named Driver API keys (driver_keys table): each token is
 * "ppk_" + 32 random bytes (hex); the DB stores ONLY its SHA-256 hash plus
 * a display hint, and the plaintext is returned exactly once, by the
 * create/reset response. Keys can be reset (old row revoked, new key issued)
 * and revoked. Driver auth accepts a UI key first and falls back to the
 * DRIVER_TOKEN secret, which remains as an always-valid bootstrap key that
 * is not listed in the UI. GET /api/driver/config now also returns the
 * configured TMDB API key so a Driver needs no credentials of its own:
 * without a valid key, every Driver endpoint answers 401 and no data
 * (subscriptions, cookie, TMDB key, channels) can be read at all.
 *
 * v0.7: library directory layout becomes a first-class setting
 * (settings key `directories`, defaults in directories.ts mirroring the
 * owner's real Quark structure: 电视剧/电影 under 电影电视剧, JP+KR merged
 * into 日韩剧, 国漫/纪录片/综艺 under 电视剧, movies split 华语/外语/动画).
 * The settings page edits it, GET /api/driver/config returns the effective
 * value, and TMDB region classification follows the same maps (no more
 * hard-coded JP→日剧/KR→韩剧). This version also ships the AI Driver
 * operating guide in three synced places: docs/AI_DRIVER_GUIDE.md (source),
 * AGENTS.md (concise), and GET /api/driver/agent-guide (served from
 * guide.ts, generated from the doc by scripts/gen-guide.mjs).
 *
 * v0.8: settings page is split into per-area tabs （账号 / 媒体信息 / 网盘 /
 * 搜索源 / 入库目录 / Driver). Pure presentation change: panels are hidden
 * with display:none (never removed), so unsaved form edits survive tab
 * switches; the active tab is mirrored into the URL hash (#driver, ...) so
 * refreshes and deep links restore it; tabs that need attention (TMDB key
 * missing, Quark cookie missing/invalid) get a red dot on their label.
 * No API, field, or behavior changes.
 *
 * v0.9: the AI Driver guide's directory & naming rules are rewritten to be
 * executable without guessing (docs/AI_DRIVER_GUIDE.md §5: target-path
 * decision order — inventory first and reuse an existing title folder,
 * never create a second home; season/episode parsing rules; exact naming
 * templates with positive/negative examples; subtitle following; quality
 * consistency within a season; stop-don't-guess). Companion change:
 * `directories` gains two naming templates — movie_name_template
 * ("{title} ({year})") and variety_name_template (…第 {episode} 期) —
 * editable on the settings page, returned by GET /api/driver/config, and
 * backfilled from defaults when an older stored settings object lacks
 * them (no error).
 *
 * v1.0: quality preference system. A global profile (settings key
 * `quality`, defaults in quality.ts: preferred resolution 1080p,
 * fallback allowed, REMUX + CAM excluded, H.265 preferred, optional
 * per-episode size cap and custom exclude keywords) is edited on a new
 * 画质偏好 settings tab and shipped to Drivers via GET /api/driver/config.
 * A subscription may override ONLY the preferred resolution (migration
 * 0004 adds `subscriptions.quality`: 2160p/1080p/720p, NULL = follow the
 * global profile); GET /api/driver/pending attaches the merged effective
 * profile as `quality_profile` to each subscription so Drivers never
 * merge themselves. The guide's candidate selection becomes two-stage:
 * hard filters from the profile, then scoring (already-stored season
 * spec still outranks the profile — no mixing within a season).
 *
 * v1.0.1: guide-only update — five field rules from the second real
 * Driver run （现在就出发 S4) folded into docs/AI_DRIVER_GUIDE.md and
 * AGENTS.md: unaired episodes are not this round's missing set; variety
 * episode mapping follows TMDB's season structure, not literal 期号；
 * variety derivatives （先导/加更/纯享/会员版/特辑） join the
 * do-not-transfer list; shares already logged candidate_dead are
 * skipped without re-opening; single-source whole-season coverage is
 * preferred and a size anomaly disqualifies only that episode, not
 * the whole source. No functional changes.
 *
 * v1.0.2: guide-only update — two rules from the third real Driver run
 * （两京十五日 inventory run): when a season's stored episodes already
 * mix specs, fill-in spec follows the majority spec (ties: the spec of
 * the run ending at the highest episode number), noted in progress,
 * stored episodes are never replaced; episodes aired within 48h with
 * no source anywhere are marked 待源 (pending-source) — no error, no
 * candidate downgrade — and retried next round. No functional changes.
 *
 * v1.1: subscriptions page is split into 订阅中 / 已完成 groups
 * (finished = completed | ended; everything else, including paused and
 * error, stays in 订阅中), with per-group counts, group-scoped search,
 * and tidier cards (two-line title clamp, progress percentage, green
 * bar when complete). Dashboard "following" now counts exactly the
 * 订阅中 group so the numbers agree. New 日志 page: GET /api/logs
 * (web session) pages through the logs table (level / subscription
 * filters, newest first, subscription titles joined); the Driver log
 * endpoint validates levels (info | warn | error, default info) and
 * migration 0005 adds the logs indexes the pagination relies on.
 *
 * v1.2: unified batch scheduling. A subscription's next_check_at used
 * to be "its own last-processed time + check interval", which staggered
 * every subscription onto its own clock. Now all scheduling goes
 * through nextBatchCheckAt(): batch points are 00:00 / 06:00 / 12:00 /
 * 18:00 Beijing time (fixed UTC+8 offset math, no local-timezone
 * reliance), and a processed subscription's next check is the first
 * batch point not earlier than (processed time + check interval), so
 * the effective interval lands between 6h and 12h at the default 6h
 * minimum. New subscriptions are still due immediately and only join
 * the batch rhythm after their first processing; finished
 * (ended/completed) subscriptions are untouched.
 */

import {
  regionForMedia,
  resolveDirectories,
  validateDirectories,
  type DirectorySettings,
} from "./directories";
import {
  normalizeQualityOverride,
  qualityProfileFor,
  resolveQuality,
  validateQuality,
  type QualityProfile,
} from "./quality";
import { AI_DRIVER_GUIDE_MD } from "./guide";

import { DEFAULT_TG_CHANNELS, PRIORITY_TG_CHANNELS } from "./channels";
import { loginHtml } from "./ui/login";
import { appHtml } from "./ui/app";
import {
  buildWecomOAuthUrl,
  clearWecomTokenCache,
  exchangeWecomOAuthCode,
  extractXmlTag,
  maskSecret,
  resolveWecomConfig,
  sendWecomNews,
  sendWecomText,
  syncWecomMenu,
  validateWecomConfig,
  verifyWecomSignature,
  wecomDecrypt,
  type WecomPublicConfig,
  type WecomSecrets,
} from "./wecom";
import {
  cleanMediaTitle,
  fetchDoubanExplore,
  fetchTmdbExplore,
  handleExploreImg,
  pickBestTmdbMatch,
  type ExploreMediaType,
} from "./explore";

export interface Env {
  DB?: D1Database;
  /**
   * Bootstrap Driver API key — set via `wrangler secret put DRIVER_TOKEN`.
   * Always valid and not listed in the settings UI; named per-Driver keys
   * are managed in the driver_keys table instead (v0.6). Remove/change this
   * secret to disable the bootstrap key.
   */
  DRIVER_TOKEN?: string;
  /** Web login username — set via `wrangler secret put APP_USERNAME`. */
  APP_USERNAME?: string;
  /** Web login password — set via `wrangler secret put APP_PASSWORD`. */
  APP_PASSWORD?: string;
  /** Optional dedicated session-signing secret; falls back to APP_PASSWORD. */
  SESSION_SECRET?: string;
  /**
   * AES-GCM key for the stored Quark cookie: 32 random bytes as hex
   * (64 hex chars), set via `wrangler secret put COOKIE_ENC_SECRET`.
   * When unset/invalid, the cookie feature is disabled — cookies are
   * never stored in plaintext as a fallback.
   */
  COOKIE_ENC_SECRET?: string;
  /** Hours between Driver rounds (default 6). */
  CHECK_INTERVAL_HOURS?: string;
}

const VERSION = "1.4.0";
const SESSION_COOKIE = "panpilot_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

// ---------------------------------------------------------------------------
// Domain types (mirror DESIGN.md §4)
// ---------------------------------------------------------------------------

export type MediaType = "tv" | "movie" | "variety";
export type SubMode = "manual" | "auto";
export type SubStatus =
  | "subscribed" | "pending_search" | "searching" | "candidates_ready"
  | "awaiting_confirm" | "transferring" | "verifying" | "partial_stored"
  | "completed" | "ended" | "paused" | "error";

export interface Subscription {
  id: string;
  title: string;
  original_title?: string;
  year?: number;
  tmdb_id?: number;
  media_type: MediaType;
  region?: string;
  season?: number;
  total_episodes?: number;
  quality_pref?: string;
  /** v1.0: per-subscription preferred-resolution override
   *  ("2160p" | "1080p" | "720p"); absent/null = follow the global
   *  quality profile. Distinct from the legacy free-form quality_pref. */
  quality?: string | null;
  /** v1.3: per-subscription check interval in hours; absent/null = follow
   *  the global unified batch schedule (CHECK_INTERVAL_HOURS minimum +
   *  Beijing 00/06/12/18 batch points). When set, the next check is
   *  scheduled exactly this many hours after the last processing,
   *  without batch alignment. */
  check_interval_hours?: number | null;
  /** Raw TMDB poster path (e.g. /abc.jpg); UI prefixes the image CDN host. */
  poster_path?: string;
  overview?: string;
  /** TMDB vote average at subscribe time. */
  rating?: number;
  mode: SubMode;
  status: SubStatus;
  target_dir?: string;
  next_check_at?: number;
  last_checked_at?: number;
  last_error?: string;
  created_at: number;
  updated_at: number;
}

export type EpisodeStatus = "missing" | "found" | "transferring" | "stored" | "failed" | "skipped";

export interface EpisodeProgressInput {
  season: number;
  episode: number;
  status: EpisodeStatus;
  source_share_code?: string;
  source_channel?: string;
  quark_fid?: string;
  file_name?: string;
  file_size?: number;
}

export interface EpisodeRecord extends EpisodeProgressInput {
  subscription_id: string;
}

export interface CandidateInput {
  share_url: string;
  share_code: string;
  channel?: string;
  post_url?: string;
  title_raw?: string;
  episodes_covered?: number[];
  quality_label?: string;
  total_size?: number;
  score?: number;
  anomaly_note?: string;
}

export interface DriverTask {
  id: string;
  subscription_id: string;
  driver_id: string;
  lease_expires_at: number;
  heartbeat_at?: number;
  status: "claimed" | "running" | "done" | "failed" | "expired";
  attempt: number;
  created_at: number;
  updated_at: number;
}

export type ClaimResult = { task: DriverTask } | { conflict: true };

/** A UI-managed Driver API key, as exposed to the web UI (never the hash). */
export interface DriverKey {
  id: string;
  name: string;
  /** Display hint only, e.g. "ppk_…ab12" — safe to show, useless as a credential. */
  token_hint: string;
  created_at: number;
  last_used_at?: number;
  revoked_at?: number;
}

/** Stored form of a DriverKey: adds the SHA-256 hash of the token. */
export interface DriverKeyRecord extends DriverKey {
  token_hash: string;
}

/** Log levels accepted from Drivers and used by the web log page (v1.1). */
export const LOG_LEVELS = ["info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** One row of the logs table, as returned by GET /api/logs (v1.1). */
export interface LogEntry {
  id: string;
  subscription_id?: string | null;
  /** Title of the subscription at read time (null when unlinked/deleted). */
  subscription_title?: string | null;
  driver_id?: string | null;
  level: string;
  event: string;
  detail?: string | null;
  created_at: number;
  /** Monotonic insertion order (D1 rowid / memory sequence). Only used
   *  to build pagination cursors; not displayed. */
  seq?: number;
}

export interface ListLogsOptions {
  level?: string;
  subscriptionId?: string;
  /** Keyset cursor: rows strictly older than (sec, seq). seq is null
   *  for a plain epoch-second cursor (then only created_at < sec). */
  before?: { sec: number; seq: number | null };
  limit: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const now = () => Math.floor(Date.now() / 1000);
const uid = () => crypto.randomUUID();

function checkIntervalSeconds(env: Env): number {
  const h = Number(env.CHECK_INTERVAL_HOURS ?? "6");
  return (Number.isFinite(h) && h > 0 ? h : 6) * 3600;
}

/**
 * v1.4: the effective global check interval in seconds. A value saved
 * from the settings page (D1 settings key `check_interval_hours`) wins;
 * the CHECK_INTERVAL_HOURS Worker variable is only the fallback
 * default. Malformed stored values fall through to the env default.
 */
async function effectiveCheckIntervalSeconds(store: Store, env: Env): Promise<number> {
  const raw = await store.getSetting(SETTING_CHECK_INTERVAL_HOURS);
  if (raw) {
    try {
      const h = Number(JSON.parse(raw));
      if (Number.isFinite(h) && h >= 0.5 && h <= 168) return Math.round(h * 3600);
    } catch { /* malformed override — fall through to env */ }
  }
  return checkIntervalSeconds(env);
}

/**
 * v1.3: validate a per-subscription check interval (hours). null / "" /
 * absent clears the override back to "follow the global batch schedule";
 * a number must lie within [0.5, 168]. Anything else is a 400.
 */
function normalizeCheckInterval(v: unknown): { value: number | null; error?: string } {
  if (v === null || v === undefined || v === "") return { value: null };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0.5 || n > 168) {
    return { value: null, error: "check_interval_hours must be a number of hours between 0.5 and 168" };
  }
  return { value: n };
}

/**
 * v1.3: the next check time for a subscription after it was processed.
 * A per-subscription interval schedules exactly that many hours from
 * now (no batch alignment); otherwise the unified batch rhythm (v1.2)
 * applies.
 */
function nextCheckAtFor(sub: Subscription | null, globalIntervalSec: number): number {
  const own = sub?.check_interval_hours;
  if (own != null && own > 0) return now() + Math.round(own * 3600);
  return nextBatchCheckAt(now(), globalIntervalSec);
}

/**
 * v1.2 unified batch scheduling: batch points are 00:00 / 06:00 / 12:00 /
 * 18:00 Beijing time. Computed with a fixed UTC+8 offset — Workers code
 * must never rely on the runtime's local timezone. Returns the first
 * batch point that is not earlier than (fromSec + minIntervalSec), so
 * with the default 6h minimum the effective interval lands in [6h, 12h].
 */
const BATCH_OFFSET_SEC = 8 * 3600; // Beijing = UTC+8, fixed offset
const BATCH_STEP_SEC = 6 * 3600; // four batch points per day

function nextBatchCheckAt(fromSec: number, minIntervalSec: number): number {
  const target = fromSec + Math.max(0, minIntervalSec);
  // Shift into "Beijing wall-clock" epoch space, where batch points are
  // the day start plus k * BATCH_STEP_SEC (k = 0..3, plus next-day 00:00).
  const local = target + BATCH_OFFSET_SEC;
  const dayStart = Math.floor(local / 86400) * 86400;
  for (let k = 0; k <= 4; k++) {
    const pointLocal = dayStart + k * BATCH_STEP_SEC;
    if (pointLocal >= local) return pointLocal - BATCH_OFFSET_SEC;
  }
  // Unreachable: k = 4 is the next day's 00:00, always >= local.
  return dayStart + 86400 - BATCH_OFFSET_SEC;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function err(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}
async function body<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}

/** Constant-time comparison via SHA-256 digests (length-independent). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeToString(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Web session auth (username/password + HMAC-signed cookie)
// ---------------------------------------------------------------------------

function sessionSecret(env: Env): string | null {
  return env.SESSION_SECRET || env.APP_PASSWORD || null;
}

async function signPayload(payloadB64: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return b64urlEncode(new Uint8Array(sig));
}

// ---------------------------------------------------------------------------
// Effective login credentials: settings override wins over secrets
// ---------------------------------------------------------------------------

const SETTING_CHECK_INTERVAL_HOURS = "check_interval_hours";
const SETTING_AUTH_USERNAME = "auth_username";
const SETTING_AUTH_PASSWORD = "auth_password";
const PBKDF2_ITERATIONS = 100_000;

interface StoredPassword {
  salt: string;       // base64, 16 random bytes
  iterations: number; // PBKDF2 iterations
  hash: string;       // base64, 32-byte PBKDF2-SHA256 output
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derivePasswordBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" }, key, 256,
  );
  return new Uint8Array(bits);
}

async function hashPassword(password: string): Promise<StoredPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derivePasswordBits(password, salt, PBKDF2_ITERATIONS);
  return { salt: bytesToB64(salt), iterations: PBKDF2_ITERATIONS, hash: bytesToB64(bits) };
}

async function verifyStoredPassword(password: string, stored: StoredPassword): Promise<boolean> {
  const bits = await derivePasswordBits(password, b64ToBytes(stored.salt), stored.iterations);
  return safeEqual(bytesToB64(bits), stored.hash);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface EffectiveAuth {
  username: string;
  source: "settings" | "secret";
  /** Fingerprint of the current credential material; embedded in sessions so
   *  that changing the username/password invalidates all older cookies. */
  fingerprint: string;
  verify(password: string): Promise<boolean>;
}

/**
 * Resolve the credentials that actually govern web login.
 * A complete override pair in the settings table (written by the settings
 * page) wins; otherwise the APP_USERNAME / APP_PASSWORD secrets apply.
 * Returns null when neither is configured (web auth disabled, local dev).
 */
async function getEffectiveAuth(env: Env, store: Store): Promise<EffectiveAuth | null> {
  const rawUser = await store.getSetting(SETTING_AUTH_USERNAME);
  const rawPass = await store.getSetting(SETTING_AUTH_PASSWORD);
  if (rawUser && rawPass) {
    try {
      const username = JSON.parse(rawUser) as unknown;
      const stored = JSON.parse(rawPass) as StoredPassword;
      if (
        typeof username === "string" && username &&
        typeof stored?.salt === "string" && typeof stored?.hash === "string" &&
        typeof stored?.iterations === "number" && stored.iterations > 0
      ) {
        return {
          username,
          source: "settings",
          fingerprint: await sha256Hex(`settings:${stored.salt}:${stored.hash}`),
          verify: (pw) => verifyStoredPassword(pw, stored),
        };
      }
    } catch { /* malformed override — fall through to secrets */ }
  }
  if (env.APP_USERNAME && env.APP_PASSWORD) {
    const password = env.APP_PASSWORD;
    return {
      username: env.APP_USERNAME,
      source: "secret",
      fingerprint: await sha256Hex(`secret:${password}`),
      verify: (pw) => safeEqual(pw, password),
    };
  }
  return null;
}

async function makeSessionCookie(env: Env, username: string, fingerprint: string): Promise<string> {
  const secret = sessionSecret(env)!;
  const payload = b64urlEncode(new TextEncoder().encode(
    JSON.stringify({ u: username, fp: fingerprint, exp: now() + SESSION_TTL_SECONDS }),
  ));
  const sig = await signPayload(payload, secret);
  return `${payload}.${sig}`;
}

async function verifySession(req: Request, env: Env, auth: EffectiveAuth): Promise<boolean> {
  const secret = sessionSecret(env);
  if (!secret) return false;
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) return false;
  const [payload, sig] = decodeURIComponent(m[1]).split(".");
  if (!payload || !sig) return false;
  const expected = await signPayload(payload, secret);
  if (!(await safeEqual(sig, expected))) return false;
  try {
    const data = JSON.parse(b64urlDecodeToString(payload)) as { u?: string; fp?: string; exp?: number };
    return data.u === auth.username && data.fp === auth.fingerprint
      && typeof data.exp === "number" && data.exp > now();
  } catch {
    return false;
  }
}

/**
 * Gate for web pages & web API. Returns null when access is allowed.
 * When no credentials are configured at all (neither settings override nor
 * APP_USERNAME/APP_PASSWORD secrets), web auth is disabled (local-dev
 * convenience) and /api/health reports web_auth: "disabled".
 */
async function webAuth(req: Request, env: Env, url: URL, store: Store): Promise<Response | null> {
  const auth = await getEffectiveAuth(env, store);
  if (!auth) return null;
  if (await verifySession(req, env, auth)) return null;
  if (url.pathname.startsWith("/api/")) {
    return err("unauthorized", "login required", 401);
  }
  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, { status: 302, headers: { location: `/login?next=${next}` } });
}

/** How long between last_used_at writes for a UI Driver key (seconds). */
const DRIVER_KEY_TOUCH_SECONDS = 300;

/**
 * Driver auth (v0.6): the caller must present a valid API key —
 *   1. a UI-managed key from the driver_keys table (looked up by SHA-256
 *      hash; revoked rows never match), or
 *   2. the DRIVER_TOKEN Worker secret (bootstrap key, always valid, not
 *      listed in the UI; disable it by changing/removing the secret).
 * No key (or a wrong one) → 401 and no data at all. A successful UI-key
 * auth touches last_used_at, throttled to one write per
 * DRIVER_KEY_TOUCH_SECONDS so a busy Driver does not hammer D1.
 */
async function driverAuth(req: Request, env: Env, store: Store): Promise<Response | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return err("unauthorized", "driver API key required (Authorization: Bearer <key>)", 401);
  }
  const hash = await sha256Hex(token);
  const rec = await store.getDriverKeyByHash(hash);
  if (rec && !rec.revoked_at) {
    const t = now();
    if (rec.last_used_at == null || t - rec.last_used_at > DRIVER_KEY_TOUCH_SECONDS) {
      await store.touchDriverKey(rec.id, t);
    }
    return null;
  }
  if (env.DRIVER_TOKEN && (await safeEqual(token, env.DRIVER_TOKEN))) {
    return null;
  }
  return err("unauthorized", "invalid driver API key", 401);
}

// Simple per-isolate login rate limiting (best effort; isolates are ephemeral).
const loginFailures = new Map<string, { count: number; window_start: number }>();
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_SECONDS = 600;

function loginRateLimited(key: string): boolean {
  const rec = loginFailures.get(key);
  if (!rec) return false;
  if (now() - rec.window_start > LOGIN_WINDOW_SECONDS) {
    loginFailures.delete(key);
    return false;
  }
  return rec.count >= LOGIN_MAX_FAILURES;
}
function recordLoginFailure(key: string): void {
  const rec = loginFailures.get(key);
  if (!rec || now() - rec.window_start > LOGIN_WINDOW_SECONDS) {
    loginFailures.set(key, { count: 1, window_start: now() });
  } else {
    rec.count += 1;
  }
}

async function handleLogin(req: Request, env: Env, url: URL, store: Store): Promise<Response> {
  const auth = await getEffectiveAuth(env, store);
  if (!auth) {
    return new Response("Web auth is not configured (APP_USERNAME / APP_PASSWORD secrets are unset).", {
      status: 503, headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (req.method === "GET") {
    if (await verifySession(req, env, auth)) {
      return new Response(null, { status: 302, headers: { location: "/" } });
    }
    const failed = url.searchParams.get("error") === "1";
    return new Response(loginHtml(failed), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (req.method !== "POST") return err("method_not_allowed", "method not allowed", 405);

  let username = "";
  let password = "";
  let next = "/";
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const b = await body<{ username?: string; password?: string; next?: string }>(req);
    username = b?.username ?? "";
    password = b?.password ?? "";
    next = b?.next ?? "/";
  } else {
    const form = await req.formData();
    username = String(form.get("username") ?? "");
    password = String(form.get("password") ?? "");
    next = String(form.get("next") ?? "/");
  }
  if (!next.startsWith("/") || next.startsWith("//")) next = "/";

  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const rateKey = `${ip}:${username}`;
  if (loginRateLimited(rateKey)) {
    return err("rate_limited", "too many failed login attempts, try again later", 429);
  }
  const userOk = await safeEqual(username, auth.username);
  const passOk = await auth.verify(password);
  if (!userOk || !passOk) {
    recordLoginFailure(rateKey);
    if (ct.includes("application/json")) return err("unauthorized", "invalid username or password", 401);
    return new Response(null, {
      status: 302,
      headers: { location: `/login?error=1&next=${encodeURIComponent(next)}` },
    });
  }
  loginFailures.delete(rateKey);
  const value = await makeSessionCookie(env, auth.username, auth.fingerprint);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 302,
    headers: {
      location: next,
      "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
    },
  });
}

function handleLogout(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: "/login",
      "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}

// ---------------------------------------------------------------------------
// Store abstraction
// ---------------------------------------------------------------------------

export interface Store {
  readonly kind: "memory" | "d1";
  listSubscriptions(): Promise<Subscription[]>;
  getSubscription(id: string): Promise<Subscription | null>;
  createSubscription(sub: Subscription): Promise<void>;
  updateSubscription(id: string, patch: Partial<Subscription>): Promise<Subscription | null>;
  deleteSubscription(id: string): Promise<boolean>;
  /** Due (next_check_at reached), not finished/paused, not under a live lease. */
  listPendingSubscriptions(limit: number): Promise<Subscription[]>;
  /** Atomically claim a subscription under a lease. */
  claimTask(subscriptionId: string, driverId: string, leaseSeconds: number): Promise<ClaimResult>;
  getTask(id: string): Promise<DriverTask | null>;
  updateTask(id: string, patch: Partial<DriverTask>): Promise<DriverTask | null>;
  addCandidates(subscriptionId: string, candidates: CandidateInput[]): Promise<number>;
  upsertEpisodes(subscriptionId: string, episodes: EpisodeProgressInput[]): Promise<void>;
  getEpisodes(subscriptionId: string): Promise<EpisodeRecord[]>;
  /** Stored-episode counts grouped by subscription and season (for stats / progress bars). */
  getStoredCounts(): Promise<{ subscription_id: string; season: number; count: number }[]>;
  addLog(entry: { subscription_id?: string; driver_id?: string; level: string; event: string; detail?: string }): Promise<void>;
  /** Newest-first log page for the web 日志 page (v1.1). */
  listLogs(opts: ListLogsOptions): Promise<LogEntry[]>;
  /** UI-managed Driver API keys (v0.6), newest first, hashes included only where noted. */
  listDriverKeys(): Promise<DriverKey[]>;
  getDriverKey(id: string): Promise<DriverKeyRecord | null>;
  getDriverKeyByHash(tokenHash: string): Promise<DriverKeyRecord | null>;
  createDriverKey(rec: DriverKeyRecord): Promise<void>;
  touchDriverKey(id: string, at: number): Promise<void>;
  /** Mark a key revoked. Returns false when the id does not exist. */
  revokeDriverKey(id: string, at: number): Promise<boolean>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  deleteSetting(key: string): Promise<void>;
}

const TERMINAL_OR_PAUSED: SubStatus[] = ["completed", "ended", "paused"];

function isLiveLease(task: DriverTask, t: number): boolean {
  return (task.status === "claimed" || task.status === "running") && task.lease_expires_at > t;
}

/** In-memory store for local dev without a D1 binding. NOT persistent. */
class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private subs = new Map<string, Subscription>();
  private tasks = new Map<string, DriverTask>();
  private candidates: (CandidateInput & { subscription_id: string })[] = [];
  private episodes = new Map<string, EpisodeRecord>();
  private logs: LogEntry[] = [];
  private logSeq = 0;
  private settings = new Map<string, string>();
  private driverKeys = new Map<string, DriverKeyRecord>();

  async listSubscriptions() { return [...this.subs.values()]; }
  async getSubscription(id: string) { return this.subs.get(id) ?? null; }
  async createSubscription(sub: Subscription) { this.subs.set(sub.id, sub); }
  async updateSubscription(id: string, patch: Partial<Subscription>) {
    const cur = this.subs.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updated_at: now() };
    this.subs.set(id, next);
    return next;
  }
  async deleteSubscription(id: string) { return this.subs.delete(id); }

  async listPendingSubscriptions(limit: number) {
    const t = now();
    const claimed = new Set(
      [...this.tasks.values()].filter((x) => isLiveLease(x, t)).map((x) => x.subscription_id),
    );
    return [...this.subs.values()]
      .filter((s) => !TERMINAL_OR_PAUSED.includes(s.status))
      .filter((s) => (s.next_check_at ?? 0) <= t)
      .filter((s) => !claimed.has(s.id))
      .sort((a, b) => (a.next_check_at ?? 0) - (b.next_check_at ?? 0))
      .slice(0, limit);
  }

  async claimTask(subscriptionId: string, driverId: string, leaseSeconds: number): Promise<ClaimResult> {
    const t = now();
    const conflict = [...this.tasks.values()].some(
      (x) => x.subscription_id === subscriptionId && isLiveLease(x, t),
    );
    if (conflict) return { conflict: true };
    const attempt = [...this.tasks.values()].filter((x) => x.subscription_id === subscriptionId).length + 1;
    const task: DriverTask = {
      id: uid(), subscription_id: subscriptionId, driver_id: driverId,
      lease_expires_at: t + leaseSeconds, status: "claimed", attempt,
      created_at: t, updated_at: t,
    };
    this.tasks.set(task.id, task);
    return { task };
  }

  async getTask(id: string) { return this.tasks.get(id) ?? null; }
  async updateTask(id: string, patch: Partial<DriverTask>) {
    const cur = this.tasks.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, updated_at: now() };
    this.tasks.set(id, next);
    return next;
  }
  async addCandidates(subscriptionId: string, candidates: CandidateInput[]) {
    for (const c of candidates) this.candidates.push({ ...c, subscription_id: subscriptionId });
    return candidates.length;
  }
  async upsertEpisodes(subscriptionId: string, episodes: EpisodeProgressInput[]) {
    for (const e of episodes) {
      this.episodes.set(`${subscriptionId}:${e.season}:${e.episode}`, { ...e, subscription_id: subscriptionId });
    }
  }
  async getEpisodes(subscriptionId: string) {
    return [...this.episodes.values()].filter((e) => e.subscription_id === subscriptionId);
  }
  async getStoredCounts() {
    const out = new Map<string, { subscription_id: string; season: number; count: number }>();
    for (const e of this.episodes.values()) {
      if (e.status !== "stored") continue;
      const key = `${e.subscription_id}:${e.season}`;
      const rec = out.get(key) ?? { subscription_id: e.subscription_id, season: e.season, count: 0 };
      rec.count += 1;
      out.set(key, rec);
    }
    return [...out.values()];
  }
  async addLog(entry: { subscription_id?: string; driver_id?: string; level: string; event: string; detail?: string }) {
    this.logs.push({
      id: uid(),
      subscription_id: entry.subscription_id ?? null,
      driver_id: entry.driver_id ?? null,
      level: entry.level,
      event: entry.event,
      detail: entry.detail ?? null,
      created_at: now(),
      seq: ++this.logSeq,
    });
  }
  async listLogs(opts: ListLogsOptions): Promise<LogEntry[]> {
    return this.logs
      .filter((l) => !opts.level || l.level === opts.level)
      .filter((l) => !opts.subscriptionId || l.subscription_id === opts.subscriptionId)
      .filter((l) => {
        if (!opts.before) return true;
        if (l.created_at < opts.before.sec) return true;
        return opts.before.seq != null
          && l.created_at === opts.before.sec
          && (l.seq ?? 0) < opts.before.seq;
      })
      .slice()
      .sort((a, b) => (b.created_at - a.created_at) || ((b.seq ?? 0) - (a.seq ?? 0)))
      .slice(0, opts.limit)
      .map((l) => ({
        ...l,
        subscription_title: l.subscription_id ? (this.subs.get(l.subscription_id)?.title ?? null) : null,
      }));
  }
  async listDriverKeys(): Promise<DriverKey[]> {
    return [...this.driverKeys.values()]
      .sort((a, b) => b.created_at - a.created_at)
      .map(({ token_hash: _hash, ...pub }) => pub);
  }
  async getDriverKey(id: string) { return this.driverKeys.get(id) ?? null; }
  async getDriverKeyByHash(tokenHash: string) {
    for (const rec of this.driverKeys.values()) if (rec.token_hash === tokenHash) return rec;
    return null;
  }
  async createDriverKey(rec: DriverKeyRecord) { this.driverKeys.set(rec.id, { ...rec }); }
  async touchDriverKey(id: string, at: number) {
    const rec = this.driverKeys.get(id);
    if (rec) rec.last_used_at = at;
  }
  async revokeDriverKey(id: string, at: number) {
    const rec = this.driverKeys.get(id);
    if (!rec) return false;
    if (!rec.revoked_at) rec.revoked_at = at;
    return true;
  }
  async getSetting(key: string) { return this.settings.get(key) ?? null; }
  async setSetting(key: string, value: string) { this.settings.set(key, value); }
  async deleteSetting(key: string) { this.settings.delete(key); }
}

// ---------------------------------------------------------------------------
// D1 store (schema: migrations/0001_init.sql)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function rowToSub(r: Row): Subscription {
  const sub: Subscription = {
    id: String(r.id),
    title: String(r.title),
    media_type: String(r.media_type) as MediaType,
    mode: String(r.mode) as SubMode,
    status: String(r.status) as SubStatus,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
  if (r.original_title != null) sub.original_title = String(r.original_title);
  if (r.year != null) sub.year = Number(r.year);
  if (r.tmdb_id != null) sub.tmdb_id = Number(r.tmdb_id);
  if (r.region != null) sub.region = String(r.region);
  if (r.season != null) sub.season = Number(r.season);
  if (r.total_episodes != null) sub.total_episodes = Number(r.total_episodes);
  if (r.quality_pref != null) sub.quality_pref = String(r.quality_pref);
  if (r.quality != null) sub.quality = String(r.quality);
  if (r.poster_path != null) sub.poster_path = String(r.poster_path);
  if (r.overview != null) sub.overview = String(r.overview);
  if (r.rating != null) sub.rating = Number(r.rating);
  if (r.target_dir != null) sub.target_dir = String(r.target_dir);
  if (r.next_check_at != null) sub.next_check_at = Number(r.next_check_at);
  if (r.last_checked_at != null) sub.last_checked_at = Number(r.last_checked_at);
  if (r.last_error != null) sub.last_error = String(r.last_error);
  if (r.check_interval_hours != null) sub.check_interval_hours = Number(r.check_interval_hours);
  return sub;
}

function rowToTask(r: Row): DriverTask {
  const task: DriverTask = {
    id: String(r.id),
    subscription_id: String(r.subscription_id),
    driver_id: String(r.driver_id),
    lease_expires_at: Number(r.lease_expires_at),
    status: String(r.status) as DriverTask["status"],
    attempt: Number(r.attempt),
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  };
  if (r.heartbeat_at != null) task.heartbeat_at = Number(r.heartbeat_at);
  return task;
}

function rowToDriverKey(r: Row, withHash: boolean): DriverKey | DriverKeyRecord {
  const key: DriverKey = {
    id: String(r.id),
    name: String(r.name),
    token_hint: String(r.token_hint),
    created_at: Number(r.created_at),
  };
  if (r.last_used_at != null) key.last_used_at = Number(r.last_used_at);
  if (r.revoked_at != null) key.revoked_at = Number(r.revoked_at);
  if (withHash) (key as DriverKeyRecord).token_hash = String(r.token_hash);
  return key;
}

const SUB_COLUMNS = [
  "id", "title", "original_title", "year", "tmdb_id", "media_type", "region",
  "season", "total_episodes", "quality_pref", "quality", "poster_path", "overview", "rating",
  "mode", "status", "target_dir",
  "next_check_at", "last_checked_at", "last_error", "check_interval_hours", "created_at", "updated_at",
] as const;

function subValues(s: Subscription): unknown[] {
  return [
    s.id, s.title, s.original_title ?? null, s.year ?? null, s.tmdb_id ?? null,
    s.media_type, s.region ?? null, s.season ?? null, s.total_episodes ?? null,
    s.quality_pref ?? null, s.quality ?? null, s.poster_path ?? null, s.overview ?? null, s.rating ?? null,
    s.mode, s.status, s.target_dir ?? null,
    s.next_check_at ?? null, s.last_checked_at ?? null, s.last_error ?? null, s.check_interval_hours ?? null,
    s.created_at, s.updated_at,
  ];
}

class D1Store implements Store {
  readonly kind = "d1" as const;
  constructor(private db: D1Database) {}

  async listSubscriptions(): Promise<Subscription[]> {
    const res = await this.db.prepare("SELECT * FROM subscriptions ORDER BY created_at DESC").all<Row>();
    return res.results.map(rowToSub);
  }
  async getSubscription(id: string): Promise<Subscription | null> {
    const row = await this.db.prepare("SELECT * FROM subscriptions WHERE id = ?").bind(id).first<Row>();
    return row ? rowToSub(row) : null;
  }
  async createSubscription(sub: Subscription): Promise<void> {
    const placeholders = SUB_COLUMNS.map(() => "?").join(", ");
    await this.db
      .prepare(`INSERT INTO subscriptions (${SUB_COLUMNS.join(", ")}) VALUES (${placeholders})`)
      .bind(...subValues(sub))
      .run();
  }
  async updateSubscription(id: string, patch: Partial<Subscription>): Promise<Subscription | null> {
    const cur = await this.getSubscription(id);
    if (!cur) return null;
    const next: Subscription = { ...cur, ...patch, id: cur.id, created_at: cur.created_at, updated_at: now() };
    const sets = SUB_COLUMNS.filter((c) => c !== "id").map((c) => `${c} = ?`).join(", ");
    const values = subValues(next);
    await this.db
      .prepare(`UPDATE subscriptions SET ${sets} WHERE id = ?`)
      .bind(...values.slice(1), id)
      .run();
    return next;
  }
  async deleteSubscription(id: string): Promise<boolean> {
    const res = await this.db.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
    return (res.meta.changes ?? 0) > 0;
  }

  async listPendingSubscriptions(limit: number): Promise<Subscription[]> {
    const t = now();
    const res = await this.db
      .prepare(
        `SELECT * FROM subscriptions
         WHERE status NOT IN ('completed', 'ended', 'paused')
           AND (next_check_at IS NULL OR next_check_at <= ?)
           AND NOT EXISTS (
             SELECT 1 FROM driver_tasks
             WHERE subscription_id = subscriptions.id
               AND status IN ('claimed', 'running')
               AND lease_expires_at > ?
           )
         ORDER BY next_check_at ASC
         LIMIT ?`,
      )
      .bind(t, t, limit)
      .all<Row>();
    return res.results.map(rowToSub);
  }

  /**
   * Atomic claim: a single INSERT … SELECT … WHERE NOT EXISTS(live lease).
   * Either the row is inserted (changes = 1, we hold the lease) or it is not
   * (changes = 0, someone else holds a live lease). No check-then-act race.
   */
  async claimTask(subscriptionId: string, driverId: string, leaseSeconds: number): Promise<ClaimResult> {
    const t = now();
    const taskId = uid();
    const leaseExpiresAt = t + leaseSeconds;
    const res = await this.db
      .prepare(
        `INSERT INTO driver_tasks
           (id, subscription_id, driver_id, lease_expires_at, heartbeat_at, status, attempt, created_at, updated_at)
         SELECT ?, ?, ?, ?, NULL, 'claimed',
                (SELECT COUNT(*) FROM driver_tasks WHERE subscription_id = ?) + 1,
                ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM driver_tasks
           WHERE subscription_id = ?
             AND status IN ('claimed', 'running')
             AND lease_expires_at > ?
         )`,
      )
      .bind(taskId, subscriptionId, driverId, leaseExpiresAt, subscriptionId, t, t, subscriptionId, t)
      .run();
    if ((res.meta.changes ?? 0) === 0) return { conflict: true };
    const task = await this.getTask(taskId);
    if (!task) return { conflict: true };
    return { task };
  }

  async getTask(id: string): Promise<DriverTask | null> {
    const row = await this.db.prepare("SELECT * FROM driver_tasks WHERE id = ?").bind(id).first<Row>();
    return row ? rowToTask(row) : null;
  }
  async updateTask(id: string, patch: Partial<DriverTask>): Promise<DriverTask | null> {
    const cur = await this.getTask(id);
    if (!cur) return null;
    const next: DriverTask = { ...cur, ...patch, id: cur.id, created_at: cur.created_at, updated_at: now() };
    await this.db
      .prepare(
        `UPDATE driver_tasks SET subscription_id = ?, driver_id = ?, lease_expires_at = ?,
           heartbeat_at = ?, status = ?, attempt = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(next.subscription_id, next.driver_id, next.lease_expires_at, next.heartbeat_at ?? null,
        next.status, next.attempt, next.updated_at, id)
      .run();
    return next;
  }

  async addCandidates(subscriptionId: string, candidates: CandidateInput[]): Promise<number> {
    const t = now();
    const stmt = this.db.prepare(
      `INSERT INTO candidates
         (id, subscription_id, share_url, share_code, channel, post_url, title_raw,
          episodes_covered, quality_label, total_size, score, anomaly_note, status, found_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    );
    const batch = candidates.map((c) =>
      stmt.bind(
        uid(), subscriptionId, c.share_url, c.share_code, c.channel ?? null, c.post_url ?? null,
        c.title_raw ?? null, c.episodes_covered ? JSON.stringify(c.episodes_covered) : null,
        c.quality_label ?? null, c.total_size ?? null, c.score ?? null, c.anomaly_note ?? null, t,
      ),
    );
    if (batch.length) await this.db.batch(batch);
    return candidates.length;
  }

  async upsertEpisodes(subscriptionId: string, episodes: EpisodeProgressInput[]): Promise<void> {
    const t = now();
    const stmt = this.db.prepare(
      `INSERT INTO episodes
         (id, subscription_id, season, episode, status, source_share_code, source_channel,
          quark_fid, file_name, file_size, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (subscription_id, season, episode) DO UPDATE SET
         status = excluded.status,
         source_share_code = excluded.source_share_code,
         source_channel = excluded.source_channel,
         quark_fid = excluded.quark_fid,
         file_name = excluded.file_name,
         file_size = excluded.file_size,
         updated_at = excluded.updated_at`,
    );
    const batch = episodes.map((e) =>
      stmt.bind(
        uid(), subscriptionId, e.season, e.episode, e.status, e.source_share_code ?? null,
        e.source_channel ?? null, e.quark_fid ?? null, e.file_name ?? null, e.file_size ?? null, t,
      ),
    );
    if (batch.length) await this.db.batch(batch);
  }

  async getEpisodes(subscriptionId: string): Promise<EpisodeRecord[]> {
    const res = await this.db
      .prepare("SELECT * FROM episodes WHERE subscription_id = ? ORDER BY season, episode")
      .bind(subscriptionId)
      .all<Row>();
    return res.results.map((r) => {
      const rec: EpisodeRecord = {
        subscription_id: String(r.subscription_id),
        season: Number(r.season),
        episode: Number(r.episode),
        status: String(r.status) as EpisodeStatus,
      };
      if (r.source_share_code != null) rec.source_share_code = String(r.source_share_code);
      if (r.source_channel != null) rec.source_channel = String(r.source_channel);
      if (r.quark_fid != null) rec.quark_fid = String(r.quark_fid);
      if (r.file_name != null) rec.file_name = String(r.file_name);
      if (r.file_size != null) rec.file_size = Number(r.file_size);
      return rec;
    });
  }

  async getStoredCounts(): Promise<{ subscription_id: string; season: number; count: number }[]> {
    const res = await this.db
      .prepare(
        `SELECT subscription_id, season, COUNT(*) AS n FROM episodes
         WHERE status = 'stored' GROUP BY subscription_id, season`,
      )
      .all<Row>();
    return res.results.map((r) => ({
      subscription_id: String(r.subscription_id),
      season: Number(r.season),
      count: Number(r.n),
    }));
  }

  async addLog(entry: { subscription_id?: string; driver_id?: string; level: string; event: string; detail?: string }): Promise<void> {
    await this.db
      .prepare("INSERT INTO logs (id, subscription_id, driver_id, level, event, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(uid(), entry.subscription_id ?? null, entry.driver_id ?? null, entry.level, entry.event, entry.detail ?? null, now())
      .run();
  }

  async listLogs(opts: ListLogsOptions): Promise<LogEntry[]> {
    // Keyset pagination on (created_at, rowid): a plain epoch cursor
    // (?4 = -1) keeps only created_at < ?3; a composite cursor also
    // keeps same-second rows with a smaller rowid, so bursts of logs
    // written within one second are never skipped between pages.
    const res = await this.db
      .prepare(
        `SELECT l.id, l.subscription_id, l.driver_id, l.level, l.event, l.detail, l.created_at,
                l.rowid AS seq, s.title AS subscription_title
           FROM logs l
           LEFT JOIN subscriptions s ON s.id = l.subscription_id
          WHERE (?1 IS NULL OR l.level = ?1)
            AND (?2 IS NULL OR l.subscription_id = ?2)
            AND (?3 IS NULL OR l.created_at < ?3 OR (l.created_at = ?3 AND l.rowid < ?4))
          ORDER BY l.created_at DESC, l.rowid DESC
          LIMIT ?5`,
      )
      .bind(
        opts.level ?? null,
        opts.subscriptionId ?? null,
        opts.before?.sec ?? null,
        opts.before ? (opts.before.seq ?? -1) : 0,
        opts.limit,
      )
      .all<Row>();
    return res.results.map((r) => ({
      id: String(r.id),
      subscription_id: r.subscription_id == null ? null : String(r.subscription_id),
      subscription_title: r.subscription_title == null ? null : String(r.subscription_title),
      driver_id: r.driver_id == null ? null : String(r.driver_id),
      level: String(r.level ?? "info"),
      event: String(r.event),
      detail: r.detail == null ? null : String(r.detail),
      created_at: Number(r.created_at),
      seq: Number(r.seq),
    }));
  }

  async listDriverKeys(): Promise<DriverKey[]> {
    const res = await this.db
      .prepare("SELECT id, name, token_hint, created_at, last_used_at, revoked_at FROM driver_keys ORDER BY created_at DESC")
      .all<Row>();
    return res.results.map((r) => rowToDriverKey(r, false));
  }
  async getDriverKey(id: string): Promise<DriverKeyRecord | null> {
    const row = await this.db.prepare("SELECT * FROM driver_keys WHERE id = ?").bind(id).first<Row>();
    return row ? (rowToDriverKey(row, true) as DriverKeyRecord) : null;
  }
  async getDriverKeyByHash(tokenHash: string): Promise<DriverKeyRecord | null> {
    const row = await this.db.prepare("SELECT * FROM driver_keys WHERE token_hash = ?").bind(tokenHash).first<Row>();
    return row ? (rowToDriverKey(row, true) as DriverKeyRecord) : null;
  }
  async createDriverKey(rec: DriverKeyRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO driver_keys (id, name, token_hash, token_hint, created_at, last_used_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(rec.id, rec.name, rec.token_hash, rec.token_hint, rec.created_at,
        rec.last_used_at ?? null, rec.revoked_at ?? null)
      .run();
  }
  async touchDriverKey(id: string, at: number): Promise<void> {
    await this.db.prepare("UPDATE driver_keys SET last_used_at = ? WHERE id = ?").bind(at, id).run();
  }
  async revokeDriverKey(id: string, at: number): Promise<boolean> {
    const res = await this.db
      .prepare("UPDATE driver_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(at, id)
      .run();
    if ((res.meta.changes ?? 0) > 0) return true;
    // Already revoked still counts as "exists" for idempotent revoke.
    const row = await this.db.prepare("SELECT id FROM driver_keys WHERE id = ?").bind(id).first<Row>();
    return !!row;
  }

  async getSetting(key: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<Row>();
    return row ? String(row.value) : null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(key, value, now())
      .run();
  }
  async deleteSetting(key: string): Promise<void> {
    await this.db.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
  }
}

// Module-level memory store (survives within a single Worker isolate only).
const memoryStore = new MemoryStore();

function getStore(env: Env): Store {
  // Default: D1 whenever a binding exists; memory only as a local fallback.
  if (env.DB) return new D1Store(env.DB);
  return memoryStore;
}

// ---------------------------------------------------------------------------
// Subscription handlers (web API)
// ---------------------------------------------------------------------------

async function handleListSubs(store: Store, env: Env): Promise<Response> {
  // v1.3: also return the global check interval (hours) so the UI can
  // label subscriptions that follow the global batch schedule.
  return json({
    subscriptions: await store.listSubscriptions(),
    check_interval_hours: (await effectiveCheckIntervalSeconds(store, env)) / 3600,
  });
}

async function handleCreateSub(req: Request, store: Store): Promise<Response> {
  const input = await body<Partial<Subscription>>(req);
  if (!input?.title) return err("bad_request", "title is required", 400);
  // v1.0: the optional resolution override must be a known value;
  // absent/empty means "follow the global quality profile".
  const q = normalizeQualityOverride(input.quality);
  if (q.error) return err("bad_request", q.error, 400);
  // v1.3: optional per-subscription check interval (hours);
  // absent/empty means "follow the global batch schedule".
  const ci = normalizeCheckInterval(input.check_interval_hours);
  if (ci.error) return err("bad_request", ci.error, 400);
  const t = now();
  const sub: Subscription = {
    id: uid(),
    title: input.title,
    original_title: input.original_title,
    year: input.year,
    tmdb_id: input.tmdb_id,
    media_type: input.media_type ?? "tv",
    region: input.region,
    season: input.season,
    total_episodes: input.total_episodes,
    quality_pref: input.quality_pref,
    quality: q.value,
    check_interval_hours: ci.value,
    poster_path: typeof input.poster_path === "string" && input.poster_path ? input.poster_path : undefined,
    overview: typeof input.overview === "string" && input.overview ? input.overview : undefined,
    rating: typeof input.rating === "number" && Number.isFinite(input.rating) ? input.rating : undefined,
    mode: input.mode ?? "auto",
    status: "pending_search",
    target_dir: input.target_dir, // TODO: derive from §3 directory rules when absent
    next_check_at: t, // due immediately; the Driver picks it up on its next round
    created_at: t,
    updated_at: t,
  };
  await store.createSubscription(sub);
  return json({ subscription: sub }, 201);
}

async function handleGetSub(store: Store, id: string): Promise<Response> {
  const sub = await store.getSubscription(id);
  if (!sub) return err("not_found", "subscription not found", 404);
  const episodes = await store.getEpisodes(id);
  return json({ subscription: sub, episodes });
}

async function handlePatchSub(req: Request, store: Store, env: Env, id: string): Promise<Response> {
  const patch = await body<Partial<Subscription>>(req);
  if (!patch) return err("bad_request", "invalid JSON body", 400);
  // Whitelist mutable fields so clients cannot rewrite ids/timestamps.
  const { status, mode, quality_pref, region, season, total_episodes, target_dir, next_check_at, tmdb_id, year, poster_path, overview, rating } = patch;
  const clean: Partial<Subscription> = { status, mode, quality_pref, region, season, total_episodes, target_dir, next_check_at, tmdb_id, year, poster_path, overview, rating };
  // v1.0: quality override — a resolution sets it, null/"" clears it back
  // to "follow the global profile"; anything else is a 400.
  if (patch.quality !== undefined) {
    const q = normalizeQualityOverride(patch.quality);
    if (q.error) return err("bad_request", q.error, 400);
    clean.quality = q.value;
  }
  // v1.3: per-subscription check interval — a number of hours sets it,
  // null/"" clears it back to "follow the global batch schedule";
  // anything outside [0.5, 168] is a 400. Changing it takes effect
  // immediately: the next check is rescheduled from now (unless the
  // caller also pinned next_check_at explicitly, and unless the
  // subscription is finished or paused — those are not scheduled).
  if (patch.check_interval_hours !== undefined) {
    const ci = normalizeCheckInterval(patch.check_interval_hours);
    if (ci.error) return err("bad_request", ci.error, 400);
    clean.check_interval_hours = ci.value;
    if (patch.next_check_at === undefined) {
      const cur = await store.getSubscription(id);
      if (cur && !FINISHED_STATUSES.includes(cur.status) && cur.status !== "paused") {
        clean.next_check_at = ci.value != null
          ? now() + Math.round(ci.value * 3600)
          : nextBatchCheckAt(now(), await effectiveCheckIntervalSeconds(store, env));
      }
    }
  }
  for (const k of Object.keys(clean) as (keyof typeof clean)[]) if (clean[k] === undefined) delete clean[k];
  const sub = await store.updateSubscription(id, clean);
  return sub ? json({ subscription: sub }) : err("not_found", "subscription not found", 404);
}

async function handleDeleteSub(store: Store, id: string): Promise<Response> {
  return (await store.deleteSubscription(id))
    ? json({ deleted: true })
    : err("not_found", "subscription not found", 404);
}

const FINISHED_STATUSES: SubStatus[] = ["completed", "ended"];
const ACTIVE_STATUSES: SubStatus[] = [
  "subscribed", "pending_search", "searching", "candidates_ready",
  "awaiting_confirm", "transferring", "verifying", "partial_stored", "error",
];

/** Stored count for one subscription: its tracked season when set, else all seasons. */
function storedForSub(
  counts: { subscription_id: string; season: number; count: number }[],
  sub: Subscription,
): number {
  return counts
    .filter((c) => c.subscription_id === sub.id && (sub.season == null || c.season === sub.season))
    .reduce((sum, c) => sum + c.count, 0);
}

/** GET /api/stats — dashboard aggregates + per-subscription stored counts. */
async function handleStats(store: Store): Promise<Response> {
  const subs = await store.listSubscriptions();
  const counts = await store.getStoredCounts();
  const storedBySubscription: Record<string, number> = {};
  let storedEpisodes = 0;
  for (const sub of subs) {
    const n = storedForSub(counts, sub);
    storedBySubscription[sub.id] = n;
    storedEpisodes += n;
  }
  return json({
    stats: {
      total_subscriptions: subs.length,
      // 订阅中 group (v1.1): everything not finished — the active
      // statuses plus paused — so this always equals total - finished
      // and matches the subscriptions page grouping.
      following: subs.filter((s) => ACTIVE_STATUSES.includes(s.status) || s.status === "paused").length,
      finished: subs.filter((s) => FINISHED_STATUSES.includes(s.status)).length,
      paused: subs.filter((s) => s.status === "paused").length,
      stored_episodes: storedEpisodes,
      stored_by_subscription: storedBySubscription,
    },
  });
}

// ---------------------------------------------------------------------------
// Driver handlers (DESIGN.md §6)
// ---------------------------------------------------------------------------

function clampLease(seconds: number | undefined): number {
  return Math.min(Math.max(seconds ?? 1800, 60), 6 * 3600);
}

/** GET /api/driver/pending — due, incomplete, unclaimed subscriptions + missing episodes. */
async function handleDriverPending(url: URL, store: Store): Promise<Response> {
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);
  const due = await store.listPendingSubscriptions(limit);
  // v1.0: attach each subscription's EFFECTIVE quality profile (global
  // profile with the subscription's resolution override merged in), so
  // the Driver applies it as-is and never merges anything itself.
  const globalQuality = await getEffectiveQuality(store);
  const out = [];
  for (const sub of due) {
    const episodes = await store.getEpisodes(sub.id);
    const season = sub.season ?? 1;
    const stored = episodes
      .filter((e) => e.season === season && e.status === "stored")
      .map((e) => e.episode)
      .sort((a, b) => a - b);
    let missing: number[] | undefined;
    if (sub.total_episodes && sub.total_episodes > 0) {
      const storedSet = new Set(stored);
      missing = [];
      for (let ep = 1; ep <= sub.total_episodes; ep++) if (!storedSet.has(ep)) missing.push(ep);
    }
    out.push({
      ...sub,
      stored_episodes: stored,
      missing_episodes: missing,
      quality_profile: qualityProfileFor(globalQuality, sub.quality),
    });
  }
  return json({ subscriptions: out });
}

/** POST /api/driver/claim — atomically create a leased task (see D1Store.claimTask). */
async function handleDriverClaim(req: Request, store: Store): Promise<Response> {
  const input = await body<{ subscription_id?: string; driver_id?: string; lease_seconds?: number }>(req);
  if (!input?.subscription_id || !input?.driver_id) {
    return err("bad_request", "subscription_id and driver_id are required", 400);
  }
  const sub = await store.getSubscription(input.subscription_id);
  if (!sub) return err("not_found", "subscription not found", 404);
  const result = await store.claimTask(sub.id, input.driver_id, clampLease(input.lease_seconds));
  if ("conflict" in result) {
    return err("claim_conflict", "subscription already claimed with a live lease", 409);
  }
  const t = now();
  await store.updateSubscription(sub.id, { status: "searching", last_checked_at: t });
  await store.addLog({
    subscription_id: sub.id, driver_id: input.driver_id, level: "info",
    event: "task_claimed", detail: JSON.stringify({ task_id: result.task.id, attempt: result.task.attempt }),
  });
  return json({ task_id: result.task.id, lease_expires_at: result.task.lease_expires_at, attempt: result.task.attempt }, 201);
}

/** POST /api/driver/candidates — report candidate sources. */
async function handleDriverCandidates(req: Request, store: Store): Promise<Response> {
  const input = await body<{ task_id?: string; candidates?: CandidateInput[] }>(req);
  if (!input?.task_id || !Array.isArray(input.candidates)) {
    return err("bad_request", "task_id and candidates[] are required", 400);
  }
  const task = await store.getTask(input.task_id);
  if (!task) return err("not_found", "task not found", 404);
  const accepted = await store.addCandidates(task.subscription_id, input.candidates);
  const sub = await store.getSubscription(task.subscription_id);
  if (sub?.mode === "manual") {
    await store.updateSubscription(sub.id, { status: "awaiting_confirm" });
  } else if (sub) {
    await store.updateSubscription(sub.id, { status: "candidates_ready" });
  }
  return json({ accepted });
}

/** POST /api/driver/progress — write back episode progress / subscription status. */
async function handleDriverProgress(req: Request, store: Store, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const input = await body<{
    task_id?: string;
    episodes?: EpisodeProgressInput[];
    subscription_status?: SubStatus;
    next_check_at?: number;
    note?: string;
  }>(req);
  if (!input?.task_id) return err("bad_request", "task_id is required", 400);
  const task = await store.getTask(input.task_id);
  if (!task) return err("not_found", "task not found", 404);
  if (input.episodes?.length) await store.upsertEpisodes(task.subscription_id, input.episodes);
  const patch: Partial<Subscription> = {};
  if (input.subscription_status) patch.status = input.subscription_status;
  if (input.next_check_at) {
    patch.next_check_at = input.next_check_at;
  } else if (input.subscription_status === "partial_stored") {
    // Still following this show: schedule the next check. A
    // per-subscription interval (v1.3) schedules exactly that many
    // hours from now; otherwise the unified batch rhythm (v1.2)
    // applies — the first Beijing 00/06/12/18 batch point that is at
    // least the global check interval (default 6h) from now.
    const cur = await store.getSubscription(task.subscription_id);
    patch.next_check_at = nextCheckAtFor(cur, await effectiveCheckIntervalSeconds(store, env));
  }
  if (input.note) patch.last_error = input.note;
  if (Object.keys(patch).length) await store.updateSubscription(task.subscription_id, patch);
  if (input.note) {
    await store.addLog({
      subscription_id: task.subscription_id, driver_id: task.driver_id, level: "info",
      event: "progress_note", detail: input.note,
    });
  }
  // A progress report that reaches a terminal subscription state closes the task.
  if (input.subscription_status && ["partial_stored", "completed", "ended", "error"].includes(input.subscription_status)) {
    await store.updateTask(task.id, { status: input.subscription_status === "error" ? "failed" : "done" });
  }
  const storedEps = (input.episodes ?? []).filter((e) => e.status === "stored");
  const importantStatus = input.subscription_status === "completed"
    || input.subscription_status === "ended"
    || input.subscription_status === "error";
  if (storedEps.length > 0 || importantStatus) {
    runBg(ctx, notifyWecomProgress(store, env, task.subscription_id, storedEps, input.subscription_status, input.note));
  }
  return json({ ok: true });
}

/** POST /api/driver/heartbeat — extend lease, report driver liveness. */
async function handleDriverHeartbeat(req: Request, store: Store): Promise<Response> {
  const input = await body<{ task_id?: string; driver_id?: string; lease_seconds?: number; driver_status?: unknown }>(req);
  if (!input?.task_id) return err("bad_request", "task_id is required", 400);
  const task = await store.getTask(input.task_id);
  if (!task) return err("not_found", "task not found", 404);
  const t = now();
  const updated = await store.updateTask(task.id, {
    heartbeat_at: t, lease_expires_at: t + clampLease(input.lease_seconds), status: "running",
  });
  if (input.driver_status !== undefined) {
    await store.addLog({
      subscription_id: task.subscription_id, driver_id: input.driver_id ?? task.driver_id,
      level: "info", event: "driver_heartbeat", detail: JSON.stringify(input.driver_status),
    });
  }
  return json({ lease_expires_at: updated?.lease_expires_at });
}

/** POST /api/driver/logs — batch-report execution logs. */
async function handleDriverLogs(req: Request, store: Store): Promise<Response> {
  const input = await body<{
    task_id?: string;
    subscription_id?: string;
    logs?: { level?: string; event?: string; detail?: string; subscription_id?: string }[];
  }>(req);
  if (!input || !Array.isArray(input.logs)) return err("bad_request", "logs[] is required", 400);
  let subscriptionId: string | undefined = input.subscription_id;
  let driverId: string | undefined;
  if (input.task_id) {
    const task = await store.getTask(input.task_id);
    if (!task) return err("not_found", "task not found", 404);
    subscriptionId = task.subscription_id;
    driverId = task.driver_id;
  }
  let accepted = 0;
  for (const l of input.logs) {
    if (!l.event) continue;
    // Levels are a fixed set (v1.1): anything else is stored as info so
    // the web log page's level filter stays exhaustive.
    const level = (LOG_LEVELS as readonly string[]).includes(l.level ?? "")
      ? (l.level as string)
      : "info";
    await store.addLog({
      subscription_id: l.subscription_id ?? subscriptionId, driver_id: driverId,
      level, event: l.event, detail: l.detail,
    });
    accepted++;
  }
  return json({ accepted });
}

/**
 * GET /api/logs — web log page feed (v1.1). Newest first; filters:
 * level (info|warn|error), subscription_id; pagination via limit
 * (default 50, max 200) and before. The cursor is opaque: either a
 * plain epoch second (only rows with created_at < before) or the
 * composite "<created_at>:<seq>" returned as next_before, which also
 * disambiguates same-second rows so paged bursts lose nothing.
 * Fetches one extra row to report has_more.
 */
async function handleListLogs(url: URL, store: Store): Promise<Response> {
  const levelParam = url.searchParams.get("level");
  const level = levelParam && (LOG_LEVELS as readonly string[]).includes(levelParam)
    ? levelParam
    : undefined;
  const subscriptionId = url.searchParams.get("subscription_id") || undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50;
  let before: ListLogsOptions["before"];
  const beforeRaw = url.searchParams.get("before") ?? "";
  const m = beforeRaw.match(/^(\d+)(?::(\d+))?$/);
  if (m) {
    before = { sec: Number(m[1]), seq: m[2] != null ? Number(m[2]) : null };
    if (!(before.sec > 0)) before = undefined;
  }
  const rows = await store.listLogs({ level, subscriptionId, before, limit: limit + 1 });
  const hasMore = rows.length > limit;
  const logs = hasMore ? rows.slice(0, limit) : rows;
  const last = logs[logs.length - 1];
  return json({
    logs,
    has_more: hasMore,
    next_before: hasMore && last ? `${last.created_at}:${last.seq ?? 0}` : null,
  });
}

// ---------------------------------------------------------------------------
// Driver API keys (web API, v0.6) — named keys managed from the settings page.
// Only SHA-256 hashes are used for auth lookup; when COOKIE_ENC_SECRET is set,
// we also archive an AES-256-GCM encrypted copy in `settings` so logged-in web
// users can one-click copy the key or AI prompt anytime without re-creating.
// ---------------------------------------------------------------------------

const DRIVER_KEY_ENC_PREFIX = "driver_key_enc:";

async function saveEncryptedDriverKey(store: Store, env: Env, id: string, token: string): Promise<boolean> {
  const key = await cookieEncKey(env);
  if (!key) return false;
  const enc = await encryptText(key, token);
  await store.setSetting(DRIVER_KEY_ENC_PREFIX + id, JSON.stringify(enc));
  return true;
}

async function loadEncryptedDriverKey(store: Store, env: Env, id: string): Promise<string | null> {
  const key = await cookieEncKey(env);
  if (!key) return null;
  const raw = await store.getSetting(DRIVER_KEY_ENC_PREFIX + id);
  if (!raw) return null;
  try {
    return await decryptText(key, JSON.parse(raw) as { iv: string; ct: string });
  } catch {
    return null;
  }
}

async function deleteEncryptedDriverKey(store: Store, id: string): Promise<void> {
  await store.deleteSetting(DRIVER_KEY_ENC_PREFIX + id);
}

/** Generate a fresh Driver key: "ppk_" + 32 random bytes as hex. */
function generateDriverKeyMaterial(): { token: string; hint: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const token = `ppk_${hex}`;
  return { token, hint: `${token.slice(0, 4)}…${token.slice(-4)}` };
}

function publicDriverKey(rec: DriverKeyRecord): DriverKey {
  const { token_hash: _hash, ...pub } = rec;
  return pub;
}

async function insertDriverKey(store: Store, name: string): Promise<{ record: DriverKeyRecord; token: string }> {
  const { token, hint } = generateDriverKeyMaterial();
  const record: DriverKeyRecord = {
    id: uid(),
    name,
    token_hash: await sha256Hex(token),
    token_hint: hint,
    created_at: now(),
  };
  await store.createDriverKey(record);
  return { record, token };
}

/** GET /api/settings/driver-keys — list UI keys (hints + can_copy flag) + bootstrap status. */
async function handleListDriverKeys(store: Store, env: Env): Promise<Response> {
  const encConfigured = !!(await cookieEncKey(env));
  const keys = await store.listDriverKeys();
  const enriched = await Promise.all(
    keys.map(async (k) => ({
      ...k,
      can_copy: !k.revoked_at && encConfigured && !!(await store.getSetting(DRIVER_KEY_ENC_PREFIX + k.id)),
    })),
  );
  return json({
    driver_keys: enriched,
    enc_configured: encConfigured,
    // The DRIVER_TOKEN secret is the bootstrap key: always valid, managed
    // via Worker secrets, intentionally not part of this list.
    bootstrap_key: { configured: !!env.DRIVER_TOKEN },
  });
}

/** POST /api/settings/driver-keys {name} → 201 with the plaintext key (+ encrypted archival if available). */
async function handleCreateDriverKey(req: Request, store: Store, env: Env): Promise<Response> {
  const input = await body<{ name?: unknown }>(req);
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
    return err("bad_request", "name is required (1–64 chars, no control characters)", 400);
  }
  const { record, token } = await insertDriverKey(store, name);
  const storedEncrypted = await saveEncryptedDriverKey(store, env, record.id, token);
  await store.addLog({
    level: "info", event: "driver_key_created",
    detail: JSON.stringify({ id: record.id, name: record.name, hint: record.token_hint }),
  });
  return json({
    key: token,
    driver_key: { ...publicDriverKey(record), can_copy: storedEncrypted },
    stored_encrypted: storedEncrypted,
  }, 201);
}

/**
 * POST /api/settings/driver-keys/:id/reset — revoke the old row and issue a
 * new key under the same name, archiving its encrypted copy when configured.
 */
async function handleResetDriverKey(store: Store, env: Env, id: string): Promise<Response> {
  const old = await store.getDriverKey(id);
  if (!old) return err("not_found", "driver key not found", 404);
  if (!old.revoked_at) await store.revokeDriverKey(id, now());
  await deleteEncryptedDriverKey(store, old.id);
  const { record, token } = await insertDriverKey(store, old.name);
  const storedEncrypted = await saveEncryptedDriverKey(store, env, record.id, token);
  await store.addLog({
    level: "info", event: "driver_key_reset",
    detail: JSON.stringify({ old_id: old.id, new_id: record.id, name: record.name, hint: record.token_hint }),
  });
  return json({
    key: token,
    driver_key: { ...publicDriverKey(record), can_copy: storedEncrypted },
    stored_encrypted: storedEncrypted,
  }, 201);
}

/** POST /api/settings/driver-keys/:id/revoke — idempotent. */
async function handleRevokeDriverKey(store: Store, id: string): Promise<Response> {
  const rec = await store.getDriverKey(id);
  if (!rec) return err("not_found", "driver key not found", 404);
  if (rec.revoked_at) return json({ ok: true, already_revoked: true });
  await store.revokeDriverKey(id, now());
  await deleteEncryptedDriverKey(store, id);
  await store.addLog({
    level: "info", event: "driver_key_revoked",
    detail: JSON.stringify({ id: rec.id, name: rec.name, hint: rec.token_hint }),
  });
  return json({ ok: true });
}

/** GET /api/settings/driver-keys/:id/reveal — decrypt archived key for web UI one-click copy. */
async function handleRevealDriverKey(store: Store, env: Env, id: string): Promise<Response> {
  const rec = await store.getDriverKey(id);
  if (!rec) return err("not_found", "driver key not found", 404);
  if (rec.revoked_at) return err("key_revoked", "该 Key 已吊销，无法复制。", 400);
  const token = await loadEncryptedDriverKey(store, env, id);
  if (!token) {
    return err(
      "key_not_recoverable",
      "该 Key 创建于加密存档之前，服务端未保存明文；请点击「重置」生成可随时复制的新 Key。",
      404,
    );
  }
  return json({ key: token, name: rec.name, driver_key: publicDriverKey(rec) });
}

// ---------------------------------------------------------------------------
// Settings (web API) — TMDB key lives in the settings table, masked on read
// ---------------------------------------------------------------------------

const SETTING_TMDB_API_KEY = "tmdb_api_key";

async function getTmdbApiKey(store: Store): Promise<string | null> {
  const raw = await store.getSetting(SETTING_TMDB_API_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "string" && parsed ? parsed : null;
  } catch {
    return raw || null;
  }
}

function maskKey(key: string): string {
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}

async function handleGetSettings(store: Store, env: Env): Promise<Response> {
  const key = await getTmdbApiKey(store);
  const auth = await getEffectiveAuth(env, store);
  const cookieMeta = await getQuarkCookieMeta(store, env);
  const eff = await getEffectiveChannels(store);
  const directories = await getEffectiveDirectories(store);
  const directoriesCustom = (await store.getSetting(SETTING_DIRECTORIES)) != null;
  const quality = await getEffectiveQuality(store);
  const qualityCustom = (await store.getSetting(SETTING_QUALITY)) != null;
  const wecom = await getWecomSettingsView(store, env);
  return json({
    settings: {
      tmdb_api_key: { configured: !!key, masked: key ? maskKey(key) : null },
      check_interval_hours: (await effectiveCheckIntervalSeconds(store, env)) / 3600,
      check_interval_custom: (await store.getSetting(SETTING_CHECK_INTERVAL_HOURS)) != null,
      account: auth ? { username: auth.username, source: auth.source } : null,
      // Cookie: status metadata only — never the value (nor its ciphertext).
      quark_cookie: {
        enc_configured: !!(await cookieEncKey(env)),
        configured: cookieMeta.configured,
        updated_at: cookieMeta.updated_at ?? null,
        length: cookieMeta.length ?? null,
        driver_status: cookieMeta.driver_status ?? null,
        driver_checked_at: cookieMeta.driver_checked_at ?? null,
      },
      tg_channels: {
        custom: eff.custom != null,
        count: eff.channels.length,
        base_count: (eff.custom ?? DEFAULT_TG_CHANNELS).length,
        priority_only: eff.priority_only,
        priority_fallback: eff.priority_fallback,
        default_count: DEFAULT_TG_CHANNELS.length,
        priority_count: PRIORITY_TG_CHANNELS.length,
        // The effective list is what the settings textarea shows/edits.
        effective: eff.channels,
      },
      // v0.7: effective library directory layout (defaults when not customised).
      directories,
      directories_custom: directoriesCustom,
      // v1.0: effective global quality profile (defaults when not customised).
      quality,
      quality_custom: qualityCustom,
      // Enterprise WeChat (WeCom) integration settings (secrets masked only).
      wecom,
    },
  });
}

/**
 * PUT /api/account — change the web login username/password from the
 * settings page. The caller must prove knowledge of the CURRENT password.
 * The new pair is stored as a settings override (password as a PBKDF2 hash);
 * when only the username changes, the just-verified current password is
 * hashed and stored alongside it, so the override pair is always complete.
 * Changing credentials rotates the session fingerprint, which invalidates
 * every previously issued cookie; this response issues a fresh one so the
 * current browser stays signed in.
 */
async function handleChangeAccount(req: Request, env: Env, store: Store): Promise<Response> {
  const auth = await getEffectiveAuth(env, store);
  if (!auth) {
    return err("auth_not_configured", "网页登录未配置（APP_USERNAME / APP_PASSWORD 未设置），无法修改账号", 503);
  }
  const input = await body<{
    current_password?: string;
    new_username?: string;
    new_password?: string;
  }>(req);
  if (!input || typeof input.current_password !== "string" || !input.current_password) {
    return err("bad_request", "current_password is required", 400);
  }
  if (!(await auth.verify(input.current_password))) {
    return err("forbidden", "当前密码不正确", 403);
  }
  const newUsername = typeof input.new_username === "string" ? input.new_username.trim() : undefined;
  const newPassword = typeof input.new_password === "string" && input.new_password ? input.new_password : undefined;
  if (newUsername === undefined && newPassword === undefined) {
    return err("bad_request", "没有要修改的内容：请填写新用户名或新密码", 400);
  }
  if (newUsername !== undefined && (newUsername.length < 1 || newUsername.length > 64 || /\s/.test(newUsername))) {
    return err("bad_request", "新用户名需为 1–64 个字符且不含空白", 400);
  }
  if (newPassword !== undefined && newPassword.length < 6) {
    return err("bad_request", "新密码至少 6 个字符", 400);
  }
  const finalUsername = newUsername ?? auth.username;
  const finalPassword = newPassword ?? input.current_password;
  const stored = await hashPassword(finalPassword);
  await store.setSetting(SETTING_AUTH_USERNAME, JSON.stringify(finalUsername));
  await store.setSetting(SETTING_AUTH_PASSWORD, JSON.stringify(stored));
  await store.addLog({
    level: "info", event: "account_credentials_changed",
    detail: JSON.stringify({ username: finalUsername, source: "settings" }),
  });
  const newAuth = await getEffectiveAuth(env, store);
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
  if (newAuth) {
    const value = await makeSessionCookie(env, newAuth.username, newAuth.fingerprint);
    const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
    headers["set-cookie"] =
      `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
  }
  return new Response(
    JSON.stringify({ ok: true, username: finalUsername, note: "已保存，其他设备上的旧登录已失效" }),
    { status: 200, headers },
  );
}

async function handleUpdateSettings(req: Request, store: Store, env: Env): Promise<Response> {
  const input = await body<{
    tmdb_api_key?: string;
    clear_tmdb_api_key?: boolean;
    quark_cookie?: string;
    clear_quark_cookie?: boolean;
    tg_channels?: unknown;
    reset_tg_channels?: boolean;
    tg_channels_priority_only?: boolean;
    directories?: unknown;
    reset_directories?: boolean;
    quality?: unknown;
    reset_quality?: boolean;
    check_interval_hours?: unknown;
    reset_check_interval?: boolean;
    wecom?: unknown;
    clear_wecom_secrets?: boolean;
  }>(req);
  if (!input) return err("bad_request", "invalid JSON body", 400);
  let changed = false;

  // --- Library directories (v0.7): validate up-front so a bad object
  // cannot leave the other settings half-applied. ---
  let directoriesToSave: DirectorySettings | null = null;
  if (input.directories !== undefined) {
    const v = validateDirectories(input.directories);
    if (!v.value) return err("bad_request", `入库目录设置不合法：${v.error ?? "unknown error"}`, 400);
    directoriesToSave = v.value;
  }

  // --- Quality profile (v1.0): same up-front validation pattern. ---
  let qualityToSave: QualityProfile | null = null;
  if (input.quality !== undefined) {
    const v = validateQuality(input.quality);
    if (!v.value) return err("bad_request", `画质偏好不合法：${v.error ?? "unknown error"}`, 400);
    qualityToSave = v.value;
  }

  // --- WeCom config & encrypted secrets: validate up-front. ---
  let wecomCfgToSave: WecomPublicConfig | null = null;
  let wecomSecretsInput: { secret?: string; token?: string; encoding_aes_key?: string } | null = null;
  if (input.wecom !== undefined) {
    if (!input.wecom || typeof input.wecom !== "object") {
      return err("bad_request", "企业微信配置格式不正确", 400);
    }
    const wObj = input.wecom as Record<string, unknown>;
    const v = validateWecomConfig(wObj);
    if (!v.value) return err("bad_request", `企业微信设置不合法：${v.error ?? "unknown error"}`, 400);
    wecomCfgToSave = v.value;
    const sec = typeof wObj.secret === "string" ? wObj.secret.trim() : "";
    const tok = typeof wObj.token === "string" ? wObj.token.trim() : "";
    const aes = typeof wObj.encoding_aes_key === "string" ? wObj.encoding_aes_key.trim() : "";
    if (aes && !/^[A-Za-z0-9+/]{43}$/.test(aes)) {
      return err("bad_request", "EncodingAESKey 必须为 43 位 Base64 字符", 400);
    }
    if (sec || tok || aes) {
      wecomSecretsInput = {};
      if (sec) wecomSecretsInput.secret = sec;
      if (tok) wecomSecretsInput.token = tok;
      if (aes) wecomSecretsInput.encoding_aes_key = aes;
    }
  }

  if (input.clear_tmdb_api_key) {
    await store.deleteSetting(SETTING_TMDB_API_KEY);
    changed = true;
  } else if (typeof input.tmdb_api_key === "string") {
    const key = input.tmdb_api_key.trim();
    if (!key) return err("bad_request", "tmdb_api_key must not be empty (use clear_tmdb_api_key to remove)", 400);
    await store.setSetting(SETTING_TMDB_API_KEY, JSON.stringify(key));
    changed = true;
  }

  // --- Quark cookie: AES-GCM encrypted at rest; no plaintext fallback. ---
  if (input.clear_quark_cookie) {
    await store.deleteSetting(SETTING_QUARK_COOKIE_ENC);
    await store.deleteSetting(SETTING_QUARK_COOKIE_UPDATED_AT);
    await store.deleteSetting(SETTING_QUARK_COOKIE_STATUS);
    await store.deleteSetting(SETTING_QUARK_COOKIE_CHECKED_AT);
    await store.addLog({ level: "info", event: "quark_cookie_cleared" });
    changed = true;
  } else if (typeof input.quark_cookie === "string") {
    const cookie = input.quark_cookie.trim();
    if (!cookie) return err("bad_request", "quark_cookie must not be empty (use clear_quark_cookie to remove)", 400);
    if (cookie.length > 20000) return err("bad_request", "quark_cookie is unreasonably long", 400);
    const key = await cookieEncKey(env);
    if (!key) {
      return err(
        "cookie_enc_not_configured",
        "服务端未配置 COOKIE_ENC_SECRET，Cookie 加密存储功能已禁用；为安全起见不会明文保存。请先为 Worker 设置该 Secret。",
        400,
      );
    }
    const enc = await encryptText(key, cookie);
    await store.setSetting(SETTING_QUARK_COOKIE_ENC, JSON.stringify(enc));
    await store.setSetting(SETTING_QUARK_COOKIE_UPDATED_AT, JSON.stringify(now()));
    // A fresh cookie has no Driver verdict yet.
    await store.deleteSetting(SETTING_QUARK_COOKIE_STATUS);
    await store.deleteSetting(SETTING_QUARK_COOKIE_CHECKED_AT);
    await store.addLog({ level: "info", event: "quark_cookie_saved", detail: JSON.stringify({ length: cookie.length }) });
    changed = true;
  }

  // --- TG channels: custom list / reset to defaults / priority-only flag. ---
  if (input.reset_tg_channels) {
    await store.deleteSetting(SETTING_TG_CHANNELS);
    await store.addLog({ level: "info", event: "tg_channels_reset" });
    changed = true;
  } else if (input.tg_channels !== undefined) {
    const norm = normalizeChannels(input.tg_channels);
    if (norm.invalid) {
      return err("bad_request", `频道名格式不合法（仅允许字母/数字/下划线，3–64 字符）：${norm.invalid.slice(0, 5).join(", ")}`, 400);
    }
    if (!norm.channels || norm.channels.length === 0) {
      return err("bad_request", "频道列表为空；如需恢复默认请使用「恢复默认」", 400);
    }
    await store.setSetting(SETTING_TG_CHANNELS, JSON.stringify(norm.channels));
    await store.addLog({ level: "info", event: "tg_channels_saved", detail: JSON.stringify({ count: norm.channels.length }) });
    changed = true;
  }
  if (typeof input.tg_channels_priority_only === "boolean") {
    await store.setSetting(SETTING_TG_PRIORITY_ONLY, JSON.stringify(input.tg_channels_priority_only));
    changed = true;
  }

  // --- Global check interval (v1.4): settings-page override of the
  // CHECK_INTERVAL_HOURS default, validated like a per-subscription
  // interval. Applies to future scheduling computations only; already
  // scheduled next_check_at values are left untouched. ---
  if (input.reset_check_interval) {
    await store.deleteSetting(SETTING_CHECK_INTERVAL_HOURS);
    await store.addLog({ level: "info", event: "check_interval_reset" });
    changed = true;
  } else if (input.check_interval_hours !== undefined) {
    const ci = normalizeCheckInterval(input.check_interval_hours);
    if (ci.error || ci.value == null) {
      return err("bad_request", "check_interval_hours must be a number of hours between 0.5 and 168", 400);
    }
    await store.setSetting(SETTING_CHECK_INTERVAL_HOURS, JSON.stringify(ci.value));
    await store.addLog({
      level: "info", event: "check_interval_saved",
      detail: JSON.stringify({ hours: ci.value }),
    });
    changed = true;
  }

  // --- Library directories (v0.7): save the validated object / reset. ---
  if (input.reset_directories) {
    await store.deleteSetting(SETTING_DIRECTORIES);
    await store.addLog({ level: "info", event: "directories_reset" });
    changed = true;
  } else if (directoriesToSave) {
    await store.setSetting(SETTING_DIRECTORIES, JSON.stringify(directoriesToSave));
    await store.addLog({
      level: "info", event: "directories_saved",
      detail: JSON.stringify({ base_dir: directoriesToSave.base_dir }),
    });
    changed = true;
  }

  // --- Quality profile (v1.0): save the validated object / reset. ---
  if (input.reset_quality) {
    await store.deleteSetting(SETTING_QUALITY);
    await store.addLog({ level: "info", event: "quality_reset" });
    changed = true;
  } else if (qualityToSave) {
    await store.setSetting(SETTING_QUALITY, JSON.stringify(qualityToSave));
    await store.addLog({
      level: "info", event: "quality_saved",
      detail: JSON.stringify({ preferred_resolution: qualityToSave.preferred_resolution }),
    });
    changed = true;
  }

  // --- WeCom config & encrypted secrets ---
  if (input.clear_wecom_secrets) {
    await store.deleteSetting(SETTING_WECOM_SECRETS_ENC);
    await clearWecomTokenCache(store);
    await store.addLog({ level: "info", event: "wecom_secrets_cleared" });
    changed = true;
  }
  if (wecomCfgToSave) {
    if (wecomSecretsInput) {
      const key = await cookieEncKey(env);
      if (!key) {
        return err(
          "cookie_enc_not_configured",
          "服务端未配置 COOKIE_ENC_SECRET，无法加密保存企业微信密钥。",
          400,
        );
      }
      const existing = await getWecomSecretsPlain(store, env);
      const merged: WecomSecrets = { ...existing, ...wecomSecretsInput };
      const enc = await encryptText(key, JSON.stringify(merged));
      await store.setSetting(SETTING_WECOM_SECRETS_ENC, JSON.stringify(enc));
    }
    await store.setSetting(SETTING_WECOM_CONFIG, JSON.stringify(wecomCfgToSave));
    await clearWecomTokenCache(store);
    await store.addLog({
      level: "info", event: "wecom_config_saved",
      detail: JSON.stringify({ enabled: wecomCfgToSave.enabled, has_secrets_update: !!wecomSecretsInput }),
    });
    changed = true;
  }

  if (!changed) {
    return err("bad_request", "nothing to update: provide tmdb_api_key / quark_cookie / tg_channels / tg_channels_priority_only / directories / quality / wecom (or clear/reset flags)", 400);
  }
  return handleGetSettings(store, env);
}

// ---------------------------------------------------------------------------
// v0.5: encrypted Quark cookie + configurable TG channel lists (settings)
// ---------------------------------------------------------------------------

const SETTING_QUARK_COOKIE_ENC = "quark_cookie_enc";       // JSON {iv, ct} — AES-GCM ciphertext only
const SETTING_QUARK_COOKIE_UPDATED_AT = "quark_cookie_updated_at";
const SETTING_QUARK_COOKIE_STATUS = "quark_cookie_status"; // last Driver report: "ok" | "invalid"
const SETTING_QUARK_COOKIE_CHECKED_AT = "quark_cookie_checked_at";
const SETTING_TG_CHANNELS = "tg_channels";                 // JSON string[] — custom list; absent = defaults
const SETTING_TG_PRIORITY_ONLY = "tg_channels_priority_only"; // JSON boolean

/** Parse the COOKIE_ENC_SECRET (64 hex chars = 32 bytes) into an AES-GCM key. */
async function cookieEncKey(env: Env): Promise<CryptoKey | null> {
  const hex = (env.COOKIE_ENC_SECRET ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  try {
    return await crypto.subtle.importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  } catch {
    return null;
  }
}

async function encryptText(key: CryptoKey, plaintext: string): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(plaintext),
  );
  return { iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
}

async function decryptText(key: CryptoKey, payload: { iv: string; ct: string }): Promise<string | null> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(payload.iv) as BufferSource }, key, b64ToBytes(payload.ct) as BufferSource,
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null; // wrong key or corrupted ciphertext
  }
}

interface QuarkCookieMeta {
  configured: boolean;
  updated_at?: number;
  /** Plaintext length (metadata only — the value itself never leaves the server via web APIs). */
  length?: number;
  /** Last status reported by a Driver via /api/driver/quark-status. */
  driver_status?: string;
  driver_checked_at?: number;
}

async function getQuarkCookieMeta(store: Store, env: Env): Promise<QuarkCookieMeta> {
  const raw = await store.getSetting(SETTING_QUARK_COOKIE_ENC);
  if (!raw) return { configured: false };
  const meta: QuarkCookieMeta = { configured: true };
  const upd = await store.getSetting(SETTING_QUARK_COOKIE_UPDATED_AT);
  if (upd) { const n = Number(JSON.parse(upd)); if (Number.isFinite(n)) meta.updated_at = n; }
  const st = await store.getSetting(SETTING_QUARK_COOKIE_STATUS);
  if (st) { try { const s = JSON.parse(st); if (typeof s === "string") meta.driver_status = s; } catch { /* ignore */ } }
  const chk = await store.getSetting(SETTING_QUARK_COOKIE_CHECKED_AT);
  if (chk) { const n = Number(JSON.parse(chk)); if (Number.isFinite(n)) meta.driver_checked_at = n; }
  // Length is computed server-side from the decrypted value; only the number is exposed.
  const key = await cookieEncKey(env);
  if (key) {
    try {
      const plain = await decryptText(key, JSON.parse(raw) as { iv: string; ct: string });
      if (plain != null) meta.length = plain.length;
    } catch { /* malformed record — length stays unknown */ }
  }
  return meta;
}

/** Decrypt the stored Quark cookie. Driver API only — never call from web handlers. */
async function getQuarkCookiePlaintext(store: Store, env: Env): Promise<string | null> {
  const raw = await store.getSetting(SETTING_QUARK_COOKIE_ENC);
  if (!raw) return null;
  const key = await cookieEncKey(env);
  if (!key) return null;
  try {
    return await decryptText(key, JSON.parse(raw) as { iv: string; ct: string });
  } catch {
    return null;
  }
}

const CHANNEL_NAME_RE = /^[A-Za-z0-9_]{3,64}$/;

/** Trim, drop "@" prefixes/empties, dedupe (case-insensitive), validate format. */
function normalizeChannels(input: unknown): { channels?: string[]; invalid?: string[] } {
  const rawList: string[] = [];
  if (Array.isArray(input)) {
    for (const v of input) if (typeof v === "string") rawList.push(v);
  } else if (typeof input === "string") {
    rawList.push(...input.split(/[\n,]+/));
  } else {
    return { invalid: ["(not a string or string[])"] };
  }
  const seen = new Set<string>();
  const channels: string[] = [];
  const invalid: string[] = [];
  for (const raw of rawList) {
    const name = raw.trim().replace(/^@+/, "");
    if (!name) continue;
    if (!CHANNEL_NAME_RE.test(name)) { invalid.push(name); continue; }
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    channels.push(name);
  }
  return invalid.length ? { invalid } : { channels };
}

interface EffectiveChannels {
  channels: string[];
  /** The list the user saved in settings (before any priority filtering), or null when using defaults. */
  custom: string[] | null;
  priority_only: boolean;
  /**
   * When priority_only is on: with a custom list, the result is the
   * intersection of the custom list and the verified priority set; if that
   * intersection is empty we fall back to the full custom list and this flag
   * is true (the Driver config surfaces it so the behaviour is explicit).
   */
  priority_fallback: boolean;
}

async function getEffectiveChannels(store: Store): Promise<EffectiveChannels> {
  let custom: string[] | null = null;
  const raw = await store.getSetting(SETTING_TG_CHANNELS);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const norm = normalizeChannels(parsed);
        if (norm.channels && norm.channels.length) custom = norm.channels;
      }
    } catch { /* malformed — treat as unset */ }
  }
  let priorityOnly = false;
  const rawFlag = await store.getSetting(SETTING_TG_PRIORITY_ONLY);
  if (rawFlag) { try { priorityOnly = JSON.parse(rawFlag) === true; } catch { /* ignore */ } }

  const base = custom ?? DEFAULT_TG_CHANNELS;
  if (!priorityOnly) return { channels: base, custom, priority_only: false, priority_fallback: false };
  if (!custom) return { channels: [...PRIORITY_TG_CHANNELS], custom: null, priority_only: true, priority_fallback: false };
  const prioSet = new Set(PRIORITY_TG_CHANNELS.map((c) => c.toLowerCase()));
  const inter = base.filter((c) => prioSet.has(c.toLowerCase()));
  if (inter.length) return { channels: inter, custom, priority_only: true, priority_fallback: false };
  return { channels: base, custom, priority_only: true, priority_fallback: true };
}

const SETTING_DIRECTORIES = "directories"; // JSON DirectorySettings; absent = DEFAULT_DIRECTORIES (v0.7)

/** Effective library directory settings: stored JSON merged over the defaults. */
async function getEffectiveDirectories(store: Store): Promise<DirectorySettings> {
  return resolveDirectories(await store.getSetting(SETTING_DIRECTORIES));
}

const SETTING_QUALITY = "quality"; // JSON QualityProfile; absent = DEFAULT_QUALITY (v1.0)

/** Effective global quality profile: stored JSON merged over the defaults. */
async function getEffectiveQuality(store: Store): Promise<QualityProfile> {
  return resolveQuality(await store.getSetting(SETTING_QUALITY));
}

/** GET /api/driver/config — everything a Driver needs for a round. No-store. */
async function handleDriverConfig(store: Store, env: Env): Promise<Response> {
  const cookie = await getQuarkCookiePlaintext(store, env);
  // v0.6: the TMDB key is provisioned from PanPilot too, so a Driver needs
  // no credentials of its own beyond its PanPilot API key.
  const tmdbKey = await getTmdbApiKey(store);
  const eff = await getEffectiveChannels(store);
  // v0.7: the effective library directory layout ships with the config so
  // the Driver files into the user's real Quark structure (see guide §5).
  const directories = await getEffectiveDirectories(store);
  // v1.0: the global quality profile ships too; per-subscription pending
  // entries carry their merged `quality_profile` (see guide §7).
  const quality = await getEffectiveQuality(store);
  await store.addLog({
    level: "info", event: "driver_config_fetched",
    detail: JSON.stringify({
      cookie: cookie != null, tmdb_key: tmdbKey != null,
      channels: eff.channels.length, priority_only: eff.priority_only,
    }),
  });
  return new Response(
    JSON.stringify({
      quark_cookie: cookie,
      tmdb_api_key: tmdbKey,
      tg_channels: eff.channels,
      tg_channels_priority_only: eff.priority_only,
      tg_channels_priority_fallback: eff.priority_fallback,
      check_interval_hours: (await effectiveCheckIntervalSeconds(store, env)) / 3600,
      directories,
      quality,
    }),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } },
  );
}

/**
 * GET /api/driver/agent-guide — the AI Driver operating guide as Markdown.
 * The text is generated from docs/AI_DRIVER_GUIDE.md into guide.ts (see
 * scripts/gen-guide.mjs); AGENTS.md at the repo root is its concise twin.
 */
function handleDriverAgentGuide(): Response {
  return new Response(AI_DRIVER_GUIDE_MD, {
    status: 200,
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" },
  });
}

/** POST /api/driver/quark-status — Driver reports whether the cookie still works. */
async function handleDriverQuarkStatus(req: Request, store: Store, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const input = await body<{ status?: string; note?: string; driver_id?: string }>(req);
  if (!input || (input.status !== "ok" && input.status !== "invalid")) {
    return err("bad_request", 'status must be "ok" or "invalid"', 400);
  }
  await store.setSetting(SETTING_QUARK_COOKIE_STATUS, JSON.stringify(input.status));
  await store.setSetting(SETTING_QUARK_COOKIE_CHECKED_AT, JSON.stringify(now()));
  await store.addLog({
    driver_id: typeof input.driver_id === "string" ? input.driver_id : undefined,
    level: input.status === "ok" ? "info" : "warn",
    event: "quark_cookie_status",
    detail: JSON.stringify({ status: input.status, note: typeof input.note === "string" ? input.note.slice(0, 200) : undefined }),
  });
  if (input.status === "invalid") {
    const noteText = typeof input.note === "string" && input.note.trim() ? `\n原因：${input.note.trim().slice(0, 120)}` : "";
    runBg(ctx, notifyWecomText(store, env, `⚠️ PanPilot 夸克 Cookie 已失效${noteText}\n请打开控制台「设置 → 网盘」粘贴最新 Cookie。`));
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// TMDB (web API) — MoviePilot-style: subscriptions bind to a TMDB id
// ---------------------------------------------------------------------------

/**
 * Map a TMDB title to the user's library category folder. Since v0.7 this
 * follows the `directories` settings maps (regionForMedia in directories.ts),
 * NOT a hard-coded table: with the defaults, JP/KR both map to 日韩剧,
 * CN/HK/TW to 国产剧, Chinese animation to 国漫, documentaries to 纪录片,
 * reality/talk to 综艺, movies to 华语电影/动画电影/外语电影 — matching the
 * owner's real Quark layout. Classification is therefore user-editable on
 * the settings page ("分类以 directories 设置为准").
 */

interface TmdbFetchResult { data?: unknown; errorResponse?: Response }

async function tmdbFetch(store: Store, path: string): Promise<TmdbFetchResult> {
  const key = await getTmdbApiKey(store);
  if (!key) {
    return {
      errorResponse: err(
        "tmdb_not_configured",
        "TMDB API Key 未配置：请先到「设置」页保存 TMDB API Key，或手动填写订阅信息。",
        400,
      ),
    };
  }
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.themoviedb.org/3${path}${sep}api_key=${encodeURIComponent(key)}&language=zh-CN`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (e) {
    return { errorResponse: err("tmdb_upstream_error", `TMDB request failed: ${e instanceof Error ? e.message : String(e)}`, 502) };
  }
  if (!res.ok) {
    return { errorResponse: err("tmdb_upstream_error", `TMDB returned HTTP ${res.status}`, 502) };
  }
  return { data: await res.json() };
}

const tmdbPoster = (p: unknown): string | undefined =>
  typeof p === "string" && p ? `https://image.tmdb.org/t/p/w342${p}` : undefined;

interface TmdbSearchItem {
  tmdb_id: number;
  media_type: MediaType;
  title: string;
  original_title: string;
  year?: number;
  origin_country: string[];
  region?: string;
  poster_url?: string;
  poster_path?: string;
  rating?: number;
  overview?: string;
}

interface TmdbSeasonInfo {
  season: number;
  episode_count: number;
  name?: string;
  air_date?: string;
}

interface TmdbCastMember {
  id?: number;
  name: string;
  character?: string;
  profile_path?: string;
}

interface TmdbEpisodeBrief {
  season: number;
  episode: number;
  name?: string;
  air_date?: string;
}

interface TmdbDetailItem extends TmdbSearchItem {
  genres: string[];
  status?: string;
  backdrop_path?: string;
  tagline?: string;
  vote_count?: number;
  release_date?: string;
  last_air_date?: string;
  original_language?: string;
  production_countries?: string[];
  networks?: string[];
  episode_run_time?: number;
  last_episode?: TmdbEpisodeBrief;
  next_episode?: TmdbEpisodeBrief;
  directors?: string[];
  writers?: string[];
  cast?: TmdbCastMember[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: TmdbSeasonInfo[];
  runtime?: number;
}

async function searchTmdbItems(
  store: Store,
  q: string,
): Promise<{ results?: TmdbSearchItem[]; errorCode?: string; errorMessage?: string; errorResponse?: Response }> {
  const { data, errorResponse } = await tmdbFetch(store, `/search/multi?query=${encodeURIComponent(q)}&include_adult=false&page=1`);
  if (errorResponse) {
    const cloned = errorResponse.clone();
    const errJson = (await cloned.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    return {
      errorResponse,
      errorCode: errJson?.error?.code,
      errorMessage: errJson?.error?.message,
    };
  }
  const dirs = await getEffectiveDirectories(store);
  const results: TmdbSearchItem[] = ((data as { results?: unknown[] }).results ?? [])
    .filter((r): r is Row => typeof r === "object" && r !== null && (r as Row).media_type !== "person"
      && ((r as Row).media_type === "tv" || (r as Row).media_type === "movie"))
    .map((r) => {
      const mediaType = String(r.media_type) as MediaType;
      const dateStr = String((mediaType === "tv" ? r.first_air_date : r.release_date) ?? "");
      const countries = Array.isArray(r.origin_country) ? (r.origin_country as unknown[]).map(String) : [];
      const genreIds = Array.isArray(r.genre_ids) ? (r.genre_ids as unknown[]).map(Number).filter(Number.isFinite) : [];
      return {
        tmdb_id: Number(r.id),
        media_type: mediaType,
        title: String((mediaType === "tv" ? r.name : r.title) ?? ""),
        original_title: String((mediaType === "tv" ? r.original_name : r.original_title) ?? ""),
        year: dateStr ? Number(dateStr.slice(0, 4)) : undefined,
        origin_country: countries,
        region: regionForMedia(dirs, countries[0], mediaType, genreIds),
        poster_url: tmdbPoster(r.poster_path),
        poster_path: typeof r.poster_path === "string" && r.poster_path ? r.poster_path : undefined,
        rating: typeof r.vote_average === "number" ? r.vote_average : undefined,
        overview: typeof r.overview === "string" ? r.overview : undefined,
      };
    });
  return { results };
}

function extractEpisodeBrief(raw: unknown): TmdbEpisodeBrief | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Row;
  const season = Number(e.season_number);
  const episode = Number(e.episode_number);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return undefined;
  return {
    season,
    episode,
    name: typeof e.name === "string" && e.name ? e.name : undefined,
    air_date: typeof e.air_date === "string" && e.air_date ? e.air_date : undefined,
  };
}

function dedupeNames(names: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const s = n.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

async function getTmdbItemDetails(
  store: Store,
  type: "tv" | "movie",
  id: string,
): Promise<{ details?: TmdbDetailItem; errorMessage?: string; errorResponse?: Response }> {
  const append = type === "tv" ? "credits,aggregate_credits" : "credits";
  const { data, errorResponse } = await tmdbFetch(store, `/${type}/${id}?append_to_response=${append}`);
  if (errorResponse) {
    const cloned = errorResponse.clone();
    const errJson = (await cloned.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { errorResponse, errorMessage: errJson?.error?.message };
  }
  const r = data as Row;
  const countries = Array.isArray(r.origin_country) ? (r.origin_country as unknown[]).map(String) : [];
  const prodCountriesRaw = Array.isArray(r.production_countries)
    ? (r.production_countries as Row[]).map((c) => String(c.iso_3166_1 || c.name || "")).filter(Boolean)
    : [];
  const productionCountries = dedupeNames(prodCountriesRaw.length ? prodCountriesRaw : countries, 5);
  const dateStr = String((type === "tv" ? r.first_air_date : r.release_date) ?? "");
  const genreRows = Array.isArray(r.genres) ? (r.genres as Row[]) : [];
  const genres = genreRows.map((g) => String(g.name)).filter(Boolean);
  const genreIds = genreRows.map((g) => Number(g.id)).filter(Number.isFinite);
  const dirs = await getEffectiveDirectories(store);

  const credits = r.credits && typeof r.credits === "object" ? (r.credits as Row) : {};
  const crew = Array.isArray(credits.crew) ? (credits.crew as Row[]) : [];
  const createdByNames = type === "tv" && Array.isArray(r.created_by)
    ? (r.created_by as Row[]).map((p) => String(p.name ?? "")).filter(Boolean)
    : [];
  const dirCrewNames = crew
    .filter((c) => c.job === "Director" || (type === "tv" && c.job === "Series Director"))
    .map((c) => String(c.name ?? ""));
  const directors = dedupeNames(createdByNames.length ? createdByNames : dirCrewNames, 4);

  const writerNames = crew
    .filter((c) => c.department === "Writing" || c.job === "Writer" || c.job === "Screenplay" || c.job === "Story")
    .map((c) => String(c.name ?? ""));
  const writers = dedupeNames(writerNames, 4);

  const rawCast = Array.isArray(credits.cast) ? ([...(credits.cast as Row[])]) : [];
  rawCast.sort((a, b) => Number(a.order ?? 999) - Number(b.order ?? 999));
  let cast: TmdbCastMember[] = rawCast
    .filter((c) => typeof c.name === "string" && c.name.trim())
    .slice(0, 12)
    .map((c) => ({
      id: typeof c.id === "number" ? c.id : undefined,
      name: String(c.name).trim(),
      character: typeof c.character === "string" && c.character.trim() ? c.character.trim() : undefined,
      profile_path: typeof c.profile_path === "string" && c.profile_path ? c.profile_path : undefined,
    }));

  if (type === "tv" && cast.length === 0 && r.aggregate_credits && typeof r.aggregate_credits === "object") {
    const aggCast = Array.isArray((r.aggregate_credits as Row).cast)
      ? ((r.aggregate_credits as Row).cast as Row[])
      : [];
    cast = aggCast
      .filter((c) => typeof c.name === "string" && c.name.trim())
      .slice(0, 12)
      .map((c) => {
        const roles = Array.isArray(c.roles) ? (c.roles as Row[]) : [];
        const charName = roles.length && typeof roles[0].character === "string" ? roles[0].character.trim() : undefined;
        return {
          id: typeof c.id === "number" ? c.id : undefined,
          name: String(c.name).trim(),
          character: charName || undefined,
          profile_path: typeof c.profile_path === "string" && c.profile_path ? c.profile_path : undefined,
        };
      });
  }

  const base = {
    tmdb_id: Number(r.id),
    media_type: type as MediaType,
    title: String((type === "tv" ? r.name : r.title) ?? ""),
    original_title: String((type === "tv" ? r.original_name : r.original_title) ?? ""),
    year: dateStr ? Number(dateStr.slice(0, 4)) : undefined,
    origin_country: countries,
    production_countries: productionCountries.length ? productionCountries : undefined,
    original_language: typeof r.original_language === "string" && r.original_language ? r.original_language : undefined,
    region: regionForMedia(dirs, countries[0], type as MediaType, genreIds),
    genres,
    poster_url: tmdbPoster(r.poster_path),
    poster_path: typeof r.poster_path === "string" && r.poster_path ? r.poster_path : undefined,
    backdrop_path: typeof r.backdrop_path === "string" && r.backdrop_path ? r.backdrop_path : undefined,
    tagline: typeof r.tagline === "string" && r.tagline.trim() ? r.tagline.trim() : undefined,
    rating: typeof r.vote_average === "number" ? r.vote_average : undefined,
    vote_count: typeof r.vote_count === "number" && r.vote_count > 0 ? r.vote_count : undefined,
    release_date: dateStr || undefined,
    overview: typeof r.overview === "string" ? r.overview : undefined,
    status: typeof r.status === "string" ? r.status : undefined,
    directors: directors.length ? directors : undefined,
    writers: writers.length ? writers : undefined,
    cast: cast.length ? cast : undefined,
  };
  if (type === "tv") {
    const seasons: TmdbSeasonInfo[] = (Array.isArray(r.seasons) ? (r.seasons as Row[]) : []).map((s) => ({
      season: Number(s.season_number),
      episode_count: Number(s.episode_count),
      name: typeof s.name === "string" ? s.name : undefined,
      air_date: typeof s.air_date === "string" && s.air_date ? s.air_date : undefined,
    }));
    const networks = Array.isArray(r.networks)
      ? dedupeNames((r.networks as Row[]).map((n) => String(n.name ?? "")), 4)
      : [];
    const runTimes = Array.isArray(r.episode_run_time)
      ? (r.episode_run_time as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    return {
      details: {
        ...base,
        last_air_date: typeof r.last_air_date === "string" && r.last_air_date ? r.last_air_date : undefined,
        networks: networks.length ? networks : undefined,
        episode_run_time: runTimes[0],
        last_episode: extractEpisodeBrief(r.last_episode_to_air),
        next_episode: extractEpisodeBrief(r.next_episode_to_air),
        number_of_seasons: typeof r.number_of_seasons === "number" ? r.number_of_seasons : undefined,
        number_of_episodes: typeof r.number_of_episodes === "number" ? r.number_of_episodes : undefined,
        seasons,
      },
    };
  }
  return {
    details: {
      ...base,
      runtime: typeof r.runtime === "number" && r.runtime > 0 ? r.runtime : undefined,
    },
  };
}

/** GET /api/tmdb/search?q=... — multi search (tv + movie), zh-CN. */
async function handleTmdbSearch(url: URL, store: Store): Promise<Response> {
  const q = url.searchParams.get("q")?.trim();
  if (!q) return err("bad_request", "q is required", 400);
  const { results, errorResponse } = await searchTmdbItems(store, q);
  if (errorResponse) return errorResponse;
  return json({ results });
}

/** GET /api/tmdb/details?type=tv|movie&id=... — seasons/episodes for tv. */
async function handleTmdbDetails(url: URL, store: Store): Promise<Response> {
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");
  if ((type !== "tv" && type !== "movie") || !id || !/^\d+$/.test(id)) {
    return err("bad_request", "type (tv|movie) and numeric id are required", 400);
  }
  const { details, errorResponse } = await getTmdbItemDetails(store, type, id);
  if (errorResponse) return errorResponse;
  return json({ details });
}

// ---------------------------------------------------------------------------
// Enterprise WeChat (WeCom / 企业微信自建应用) Integration
// ---------------------------------------------------------------------------

const SETTING_WECOM_CONFIG = "wecom_config";
const SETTING_WECOM_SECRETS_ENC = "wecom_secrets_enc";
const SETTING_WECOM_DEDUP = "wecom_dedup";
const WECOM_SESSION_PREFIX = "wecom_session:";
const WECOM_SESSION_TTL = 600;

const WECOM_STATUS_ZH: Record<SubStatus, string> = {
  subscribed: "已订阅",
  pending_search: "待搜索",
  searching: "搜索中",
  candidates_ready: "已找到候选",
  awaiting_confirm: "待确认",
  transferring: "转存中",
  verifying: "复核中",
  partial_stored: "部分入库",
  completed: "已集齐",
  ended: "已完结",
  paused: "已暂停",
  error: "出错",
};

function runBg(ctx: ExecutionContext | undefined, promise: Promise<unknown>): void {
  const safe = promise.catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(safe);
  }
}

async function getWecomConfig(store: Store): Promise<WecomPublicConfig> {
  return resolveWecomConfig(await store.getSetting(SETTING_WECOM_CONFIG));
}

async function getWecomSecretsPlain(store: Store, env: Env): Promise<WecomSecrets> {
  const raw = await store.getSetting(SETTING_WECOM_SECRETS_ENC);
  if (!raw) return {};
  const key = await cookieEncKey(env);
  if (!key) return {};
  try {
    const pt = await decryptText(key, JSON.parse(raw) as { iv: string; ct: string });
    if (!pt) return {};
    const parsed = JSON.parse(pt) as WecomSecrets;
    return {
      secret: typeof parsed.secret === "string" ? parsed.secret : undefined,
      token: typeof parsed.token === "string" ? parsed.token : undefined,
      encoding_aes_key: typeof parsed.encoding_aes_key === "string" ? parsed.encoding_aes_key : undefined,
    };
  } catch {
    return {};
  }
}

async function getWecomSettingsView(store: Store, env: Env) {
  const cfg = await getWecomConfig(store);
  const sec = await getWecomSecretsPlain(store, env);
  return {
    ...cfg,
    enc_configured: !!(await cookieEncKey(env)),
    has_secret: !!sec.secret,
    secret_masked: maskSecret(sec.secret),
    has_token: !!sec.token,
    token_masked: maskSecret(sec.token),
    has_aes_key: !!sec.encoding_aes_key,
    aes_key_masked: maskSecret(sec.encoding_aes_key),
  };
}

function wecomNotifyTarget(cfg: WecomPublicConfig): string {
  return cfg.allowed_users.length > 0 ? cfg.allowed_users.join("|") : "@all";
}

async function notifyWecomText(store: Store, env: Env, text: string): Promise<void> {
  try {
    const cfg = await getWecomConfig(store);
    if (!cfg.enabled || !cfg.notify_enabled || !cfg.corp_id || !cfg.agent_id) return;
    const secrets = await getWecomSecretsPlain(store, env);
    if (!secrets.secret) return;
    await sendWecomText(store, cfg, secrets, wecomNotifyTarget(cfg), text);
  } catch (e) {
    await store.addLog({
      level: "warn",
      event: "wecom_notify_failed",
      detail: e instanceof Error ? e.message.slice(0, 300) : String(e),
    });
  }
}

async function notifyWecomProgress(
  store: Store,
  env: Env,
  subscriptionId: string,
  storedEps: EpisodeProgressInput[],
  subStatus?: SubStatus,
  note?: string,
): Promise<void> {
  const sub = await store.getSubscription(subscriptionId);
  if (!sub) return;
  const seasonLabel = sub.season != null && sub.media_type !== "movie" ? ` 第 ${sub.season} 季` : "";
  const statusText = subStatus ? (WECOM_STATUS_ZH[subStatus] ?? subStatus) : (WECOM_STATUS_ZH[sub.status] ?? sub.status);
  if (subStatus === "error") {
    const reason = note ? `\n原因：${note.slice(0, 160)}` : "";
    await notifyWecomText(store, env, `❌ 订阅异常：《${sub.title}》${seasonLabel}${reason}`);
    return;
  }
  const epNums = storedEps.map((e) => e.episode).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const epDesc = epNums.length > 0
    ? (epNums.length === 1 ? `第 ${epNums[0]} 集` : `第 ${epNums[0]}–${epNums[epNums.length - 1]} 集（共 ${epNums.length} 集）`)
    : "";
  if (subStatus === "completed" || subStatus === "ended") {
    const extra = epDesc ? `\n本次入库：${epDesc}` : "";
    await notifyWecomText(store, env, `🎉 订阅${statusText}：《${sub.title}》${seasonLabel}${extra}`);
    return;
  }
  if (epDesc) {
    await notifyWecomText(store, env, `✅ 新集入库：《${sub.title}》${seasonLabel}\n本次入库：${epDesc}\n当前状态：${statusText}`);
  }
}

async function isDuplicateWecomMsg(store: Store, msgId: string): Promise<boolean> {
  if (!msgId) return false;
  const t = now();
  let entries: [string, number][] = [];
  const raw = await store.getSetting(SETTING_WECOM_DEDUP);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        entries = parsed.filter(
          (x): x is [string, number] => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "number" && t - x[1] < 300,
        );
      }
    } catch { /* ignore */ }
  }
  if (entries.some(([id]) => id === msgId)) return true;
  entries.push([msgId, t]);
  if (entries.length > 50) entries = entries.slice(-50);
  await store.setSetting(SETTING_WECOM_DEDUP, JSON.stringify(entries));
  return false;
}

interface WecomDialogSession {
  step: "pick_media" | "pick_season";
  expires_at: number;
  items?: TmdbSearchItem[];
  item?: TmdbDetailItem;
}

async function loadWecomSession(store: Store, userId: string): Promise<WecomDialogSession | null> {
  const raw = await store.getSetting(`${WECOM_SESSION_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as WecomDialogSession;
    if (!s || typeof s.expires_at !== "number" || s.expires_at < now()) {
      await store.deleteSetting(`${WECOM_SESSION_PREFIX}${userId}`);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

async function saveWecomSession(store: Store, userId: string, session: WecomDialogSession): Promise<void> {
  await store.setSetting(`${WECOM_SESSION_PREFIX}${userId}`, JSON.stringify(session));
}

async function clearWecomSession(store: Store, userId: string): Promise<void> {
  await store.deleteSetting(`${WECOM_SESSION_PREFIX}${userId}`);
}

async function formatWecomSubsReply(store: Store, group: "active" | "finished"): Promise<string> {
  const subs = await store.listSubscriptions();
  const counts = await store.getStoredCounts();
  const filtered = subs.filter((s) => group === "finished" ? FINISHED_STATUSES.includes(s.status) : !FINISHED_STATUSES.includes(s.status));
  if (!filtered.length) {
    return group === "finished" ? "暂无已完成的订阅。" : "暂无追更中的订阅，直接发送剧名即可搜索添加。";
  }
  const lines = filtered.slice(0, 12).map((s, idx) => {
    const stored = storedForSub(counts, s);
    const prog = s.media_type === "movie"
      ? (stored > 0 ? "已入库" : "未入库")
      : `${stored}/${s.total_episodes ?? "?"}集`;
    const season = s.season != null && s.media_type !== "movie" ? ` S${String(s.season).padStart(2, "0")}` : "";
    return `${idx + 1}. 《${s.title}》${season} · ${prog} · ${WECOM_STATUS_ZH[s.status] ?? s.status}`;
  });
  const header = group === "finished" ? `✅ 已完成订阅（共 ${filtered.length} 部）：` : `📺 追更中订阅（共 ${filtered.length} 部）：`;
  const tail = filtered.length > 12 ? `\n…仅展示前 12 条，更多请在菜单「打开控制台」查看` : "";
  return `${header}\n${lines.join("\n")}${tail}`;
}

async function formatWecomStatusReply(store: Store, env: Env): Promise<string> {
  const subs = await store.listSubscriptions();
  const counts = await store.getStoredCounts();
  let storedTotal = 0;
  for (const s of subs) storedTotal += storedForSub(counts, s);
  const finished = subs.filter((s) => FINISHED_STATUSES.includes(s.status)).length;
  const following = subs.length - finished;
  const errCount = subs.filter((s) => s.status === "error").length;
  const tmdbOk = !!(await getTmdbApiKey(store));
  const encOk = !!(await cookieEncKey(env));
  const cookie = await getQuarkCookieMeta(store, env);
  const cookieText = !encOk
    ? "未启用加密"
    : !cookie.configured
      ? "未配置"
      : cookie.driver_status === "invalid"
        ? "已失效 ⚠️"
        : cookie.driver_status === "ok"
          ? "有效 ✅"
          : "已配置（待验证）";
  return [
    "📊 PanPilot 运行概览",
    `• 订阅总数：${subs.length}（追更中 ${following} / 已完成 ${finished}${errCount ? ` / 异常 ${errCount}` : ""}）`,
    `• 累计入库：${storedTotal} 集`,
    `• TMDB 搜索：${tmdbOk ? "已配置 ✅" : "未配置 ⚠️"}`,
    `• 夸克 Cookie：${cookieText}`,
  ].join("\n");
}

async function formatWecomLogsReply(store: Store): Promise<string> {
  const logs = await store.listLogs({ limit: 6 });
  if (!logs.length) return "暂无操作日志。";
  const lines = logs.map((l) => {
    const title = l.subscription_title ? `《${l.subscription_title}》` : "系统";
    const lv = l.level === "error" ? "❌" : (l.level === "warn" ? "⚠️" : "ℹ️");
    return `${lv} ${title} · ${l.event}`;
  });
  return `🧾 最近操作日志：\n${lines.join("\n")}`;
}

async function subscribeFromWecom(
  store: Store,
  cfg: WecomPublicConfig,
  secrets: WecomSecrets,
  fromUser: string,
  originUrl: string,
  details: TmdbDetailItem,
  season?: number,
  totalEpisodes?: number,
): Promise<void> {
  const existing = (await store.listSubscriptions()).find((s) =>
    s.tmdb_id === details.tmdb_id
    && s.media_type === details.media_type
    && (details.media_type === "movie" || s.season === season),
  );
  if (existing) {
    const seasonText = season != null && details.media_type !== "movie" ? ` 第 ${season} 季` : "";
    await sendWecomText(
      store, cfg, secrets, fromUser,
      `ℹ️ 《${details.title}》${seasonText}已在订阅列表中（当前状态：${WECOM_STATUS_ZH[existing.status] ?? existing.status}）。`,
    );
    return;
  }
  const t = now();
  const sub: Subscription = {
    id: uid(),
    title: details.title,
    original_title: details.original_title || undefined,
    year: details.year,
    tmdb_id: details.tmdb_id,
    media_type: details.media_type,
    region: details.region || undefined,
    season: details.media_type === "movie" ? undefined : season,
    total_episodes: details.media_type === "movie" ? undefined : totalEpisodes,
    poster_path: details.poster_path,
    overview: details.overview,
    rating: details.rating,
    mode: "auto",
    status: "pending_search",
    next_check_at: t,
    created_at: t,
    updated_at: t,
  };
  await store.createSubscription(sub);
  await store.addLog({
    subscription_id: sub.id,
    level: "info",
    event: "wecom_subscribed",
    detail: JSON.stringify({ user: fromUser, title: sub.title, season: sub.season, mode: sub.mode }),
  });

  const seasonLabel = sub.season != null && sub.media_type !== "movie"
    ? `第 ${sub.season} 季${sub.total_episodes ? `（共 ${sub.total_episodes} 集）` : ""}`
    : (sub.media_type === "movie" ? "电影" : "剧集");
  const descParts = [
    sub.year ? String(sub.year) : "",
    sub.region || "",
    seasonLabel,
    sub.rating ? `★${sub.rating.toFixed(1)}` : "",
    "模式：自动转存",
  ].filter(Boolean);
  const cardUrl = buildWecomOAuthUrl(cfg, originUrl, "/subscriptions");
  try {
    await sendWecomNews(store, cfg, secrets, fromUser, [{
      title: `已订阅：《${sub.title}》`,
      description: descParts.join(" · ") + (sub.overview ? `\n${sub.overview.slice(0, 72)}…` : ""),
      url: cardUrl,
      picurl: details.poster_url,
    }]);
  } catch {
    await sendWecomText(store, cfg, secrets, fromUser, `✅ 已添加订阅：《${sub.title}》\n${descParts.join(" · ")}\nDriver 将在下一轮自动检索并转存。`);
  }
}

async function processWecomMessage(
  store: Store,
  env: Env,
  cfg: WecomPublicConfig,
  secrets: WecomSecrets,
  xml: string,
  originUrl: string,
): Promise<void> {
  const fromUser = extractXmlTag(xml, "FromUserName") ?? "";
  const msgType = extractXmlTag(xml, "MsgType") ?? "";
  if (!fromUser) return;
  if (cfg.allowed_users.length > 0 && !cfg.allowed_users.includes(fromUser)) {
    await store.addLog({
      level: "warn",
      event: "wecom_unauthorized_user",
      detail: JSON.stringify({ user: fromUser, msgType }),
    });
    return;
  }

  try {
    if (msgType === "event") {
      const ev = (extractXmlTag(xml, "Event") ?? "").toUpperCase();
      const key = extractXmlTag(xml, "EventKey") ?? "";
      if (ev === "CLICK") {
        if (key === "SEARCH_HELP") {
          await sendWecomText(
            store, cfg, secrets, fromUser,
            "🔍 直接发送电影或剧名即可搜索订阅，例如：`谷雨`、`仙逆`\n\n快捷指令：\n• 发送 `订阅` 查看追更中进度\n• 发送 `已完成` 查看已完结列表\n• 发送 `状态` 查看系统概览\n• 发送 `日志` 查看最近记录\n• 发送 `0` 或 `取消` 退出当前选剧会话",
          );
        } else if (key === "SUBS_ACTIVE") {
          await sendWecomText(store, cfg, secrets, fromUser, await formatWecomSubsReply(store, "active"));
        } else if (key === "SUBS_FINISHED") {
          await sendWecomText(store, cfg, secrets, fromUser, await formatWecomSubsReply(store, "finished"));
        } else if (key === "SYS_STATUS") {
          await sendWecomText(store, cfg, secrets, fromUser, await formatWecomStatusReply(store, env));
        } else if (key === "RECENT_LOGS") {
          await sendWecomText(store, cfg, secrets, fromUser, await formatWecomLogsReply(store));
        }
      }
      return;
    }

    if (msgType !== "text") {
      await sendWecomText(store, cfg, secrets, fromUser, "暂仅支持发送文字片名搜剧或快捷指令（发送「帮助」查看说明）。");
      return;
    }

    const content = (extractXmlTag(xml, "Content") ?? "").trim();
    if (!content) return;
    const lower = content.toLowerCase();

    if (content === "0" || content === "取消" || content === "退出") {
      await clearWecomSession(store, fromUser);
      await sendWecomText(store, cfg, secrets, fromUser, "已取消当前操作。直接发送片名可重新搜索。");
      return;
    }
    if (content === "帮助" || lower === "help" || content === "?" || content === "？") {
      await sendWecomText(
        store, cfg, secrets, fromUser,
        "🔍 PanPilot 企业微信助手\n• 直接发送片名：搜索 TMDB 并回复序号订阅（默认自动转存）\n• 快捷指令：`订阅` / `已完成` / `状态` / `日志` / `取消`",
      );
      return;
    }
    if (content === "订阅" || content === "追更") {
      await sendWecomText(store, cfg, secrets, fromUser, await formatWecomSubsReply(store, "active"));
      return;
    }
    if (content === "已完成" || content === "完结") {
      await sendWecomText(store, cfg, secrets, fromUser, await formatWecomSubsReply(store, "finished"));
      return;
    }
    if (content === "状态") {
      await sendWecomText(store, cfg, secrets, fromUser, await formatWecomStatusReply(store, env));
      return;
    }
    if (content === "日志") {
      await sendWecomText(store, cfg, secrets, fromUser, await formatWecomLogsReply(store));
      return;
    }

    const session = await loadWecomSession(store, fromUser);
    if (session && /^\d+$/.test(content)) {
      const idx = Number(content) - 1;
      if (session.step === "pick_media" && session.items) {
        if (idx < 0 || idx >= session.items.length) {
          await sendWecomText(store, cfg, secrets, fromUser, `序号超出范围，请回复 1–${session.items.length}，或回复 0 取消。`);
          return;
        }
        const picked = session.items[idx];
        const { details, errorMessage } = await getTmdbItemDetails(
          store,
          picked.media_type === "movie" ? "movie" : "tv",
          String(picked.tmdb_id),
        );
        if (!details) {
          await sendWecomText(store, cfg, secrets, fromUser, `获取详情失败：${errorMessage ?? "请稍后重试"}`);
          return;
        }
        if (details.media_type === "movie") {
          await clearWecomSession(store, fromUser);
          await subscribeFromWecom(store, cfg, secrets, fromUser, originUrl, details);
          return;
        }
        const regularSeasons = (details.seasons ?? []).filter((s) => s.season >= 1);
        if (regularSeasons.length <= 1) {
          const only = regularSeasons[0];
          await clearWecomSession(store, fromUser);
          await subscribeFromWecom(
            store, cfg, secrets, fromUser, originUrl, details,
            only ? only.season : 1, only?.episode_count,
          );
          return;
        }
        await saveWecomSession(store, fromUser, {
          step: "pick_season",
          expires_at: now() + WECOM_SESSION_TTL,
          item: { ...details, seasons: regularSeasons },
        });
        const sLines = regularSeasons.slice(0, 15).map((s, si) =>
          `${si + 1}. 第 ${s.season} 季${s.episode_count ? `（${s.episode_count} 集）` : ""}${s.name ? ` · ${s.name}` : ""}`,
        );
        await sendWecomText(
          store, cfg, secrets, fromUser,
          `📺 《${details.title}》共 ${regularSeasons.length} 季，请回复序号选择要订阅的季（回复 0 取消）：\n${sLines.join("\n")}`,
        );
        return;
      }

      if (session.step === "pick_season" && session.item && session.item.seasons) {
        const seasons = session.item.seasons;
        if (idx < 0 || idx >= seasons.length) {
          await sendWecomText(store, cfg, secrets, fromUser, `序号超出范围，请回复 1–${seasons.length}，或回复 0 取消。`);
          return;
        }
        const chosenSeason = seasons[idx];
        await clearWecomSession(store, fromUser);
        await subscribeFromWecom(
          store, cfg, secrets, fromUser, originUrl, session.item,
          chosenSeason.season, chosenSeason.episode_count,
        );
        return;
      }
    }

    // Start a fresh TMDB search.
    const { results, errorCode, errorMessage } = await searchTmdbItems(store, content);
    if (!results) {
      if (errorCode === "tmdb_not_configured") {
        await sendWecomText(store, cfg, secrets, fromUser, "⚠️ TMDB API Key 尚未配置，请先在 PanPilot 网页「设置 → 媒体信息」保存 Key。");
      } else {
        await sendWecomText(store, cfg, secrets, fromUser, `搜索 TMDB 失败：${errorMessage ?? "请稍后重试"}`);
      }
      return;
    }
    if (!results.length) {
      await sendWecomText(store, cfg, secrets, fromUser, `未在 TMDB 找到「${content}」相关影视，请换个关键词重试。`);
      return;
    }

    const top = results.slice(0, 8);
    await saveWecomSession(store, fromUser, {
      step: "pick_media",
      expires_at: now() + WECOM_SESSION_TTL,
      items: top,
    });
    const lines = top.map((it, i) => {
      const parts = [
        it.year ? String(it.year) : "",
        it.media_type === "movie" ? "电影" : "剧集",
        it.region || "",
        it.rating ? `★${it.rating.toFixed(1)}` : "",
      ].filter(Boolean);
      return `${i + 1}. ${it.title}${parts.length ? ` (${parts.join(" · ")})` : ""}`;
    });
    await sendWecomText(
      store, cfg, secrets, fromUser,
      `🔍 搜索「${content}」结果，回复序号即可订阅（默认自动转存，回复 0 取消）：\n${lines.join("\n")}`,
    );
  } catch (e) {
    await store.addLog({
      level: "error",
      event: "wecom_message_error",
      detail: e instanceof Error ? e.message.slice(0, 300) : String(e),
    });
  }
}

async function handleWecomVerifyFile(pathname: string, store: Store): Promise<Response | null> {
  const name = pathname.slice(1);
  if (!/^WW_verify_[A-Za-z0-9._-]+\.txt$/.test(name)) return null;
  const cfg = await getWecomConfig(store);
  if (cfg.verify_file_name === name && cfg.verify_file_content) {
    return new Response(cfg.verify_file_content, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return null;
}

async function handleWecomCallback(
  req: Request,
  url: URL,
  store: Store,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const cfg = await getWecomConfig(store);
  const secrets = await getWecomSecretsPlain(store, env);
  if (!secrets.token || !secrets.encoding_aes_key) {
    return new Response("WeCom callback not configured", { status: 503 });
  }
  const msgSig = url.searchParams.get("msg_signature") ?? "";
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";

  if (req.method === "GET") {
    const echostr = url.searchParams.get("echostr") ?? "";
    if (!(await verifyWecomSignature(secrets.token, timestamp, nonce, echostr, msgSig))) {
      return new Response("invalid signature", { status: 403 });
    }
    try {
      const { message } = await wecomDecrypt(secrets.encoding_aes_key, echostr, cfg.corp_id || undefined);
      return new Response(message, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
    } catch (e) {
      return new Response(`decrypt failed: ${e instanceof Error ? e.message : String(e)}`, { status: 400 });
    }
  }

  if (req.method !== "POST") return err("method_not_allowed", "method not allowed", 405);
  const rawXml = await req.text();
  const encrypt = extractXmlTag(rawXml, "Encrypt") ?? "";
  if (!encrypt || !(await verifyWecomSignature(secrets.token, timestamp, nonce, encrypt, msgSig))) {
    return new Response("invalid signature", { status: 403 });
  }
  let xml = "";
  try {
    const dec = await wecomDecrypt(secrets.encoding_aes_key, encrypt, cfg.corp_id || undefined);
    xml = dec.message;
  } catch (e) {
    return new Response(`decrypt failed: ${e instanceof Error ? e.message : String(e)}`, { status: 400 });
  }

  if (!cfg.enabled) {
    return new Response("", { status: 200 });
  }
  const msgId = extractXmlTag(xml, "MsgId") ?? "";
  if (msgId && (await isDuplicateWecomMsg(store, msgId))) {
    return new Response("", { status: 200 });
  }
  runBg(ctx, processWecomMessage(store, env, cfg, secrets, xml, url.origin));
  return new Response("", { status: 200 });
}

function htmlNotice(title: string, bodyText: string, status: number): Response {
  const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title>`
    + `<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;color:#f3f4f6;font-family:system-ui,sans-serif;padding:1.5rem}`
    + `.box{max-width:420px;background:#15171d;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:1.5rem;line-height:1.6}`
    + `h2{margin:0 0 .5rem;font-size:1.1rem;color:#e5a00d}p{margin:0;color:#c9cdd8;font-size:.92rem}</style></head>`
    + `<body><div class="box"><h2>${escHtml(title)}</h2><p>${escHtml(bodyText)}</p></div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function handleWecomOAuth(url: URL, store: Store, env: Env): Promise<Response> {
  const cfg = await getWecomConfig(store);
  const secrets = await getWecomSecretsPlain(store, env);
  if (!cfg.enabled || !cfg.oauth_enabled || !cfg.corp_id || !secrets.secret) {
    return htmlNotice("企微免密登录未启用", "请先在 PanPilot「设置 → 企业微信」启用应用并开启 OAuth2 免密登录。", 403);
  }
  const code = url.searchParams.get("code")?.trim() ?? "";
  let next = url.searchParams.get("next") ?? "/";
  if (!next.startsWith("/") || next.startsWith("//")) next = "/";
  if (!code) {
    return new Response(null, { status: 302, headers: { location: buildWecomOAuthUrl(cfg, url.origin, next) } });
  }
  if (!cfg.allowed_users.length) {
    return htmlNotice(
      "未配置允许的 UserID 白名单",
      "为保障安全，免密登录要求先在「设置 → 企业微信」填写允许访问的 UserID 白名单。",
      403,
    );
  }
  try {
    const info = await exchangeWecomOAuthCode(store, cfg, secrets, code);
    if (!info.userid || !cfg.allowed_users.includes(info.userid)) {
      await store.addLog({
        level: "warn",
        event: "wecom_oauth_denied",
        detail: JSON.stringify({ userid: info.userid ?? null, openid: info.openid ?? null }),
      });
      return htmlNotice(
        "无权免密访问",
        `当前企业微信账号（${info.userid || "非企业成员"}）不在允许的白名单中，请先在控制台将其 UserID 加入白名单。`,
        403,
      );
    }
    const auth = await getEffectiveAuth(env, store);
    const headers: Record<string, string> = { location: next };
    if (auth) {
      const value = await makeSessionCookie(env, auth.username, auth.fingerprint);
      const secure = url.protocol === "https:" ? "; Secure" : "";
      headers["set-cookie"] =
        `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
    }
    await store.addLog({
      level: "info",
      event: "wecom_oauth_login",
      detail: JSON.stringify({ userid: info.userid, next }),
    });
    return new Response(null, { status: 302, headers });
  } catch (e) {
    return htmlNotice("企微身份校验失败", e instanceof Error ? e.message : String(e), 502);
  }
}

async function handleWecomSyncMenu(url: URL, store: Store, env: Env): Promise<Response> {
  const cfg = await getWecomConfig(store);
  const secrets = await getWecomSecretsPlain(store, env);
  if (!cfg.corp_id || !cfg.agent_id || !secrets.secret) {
    return err("bad_request", "请先填写并保存 CorpID、AgentID 和应用 Secret", 400);
  }
  try {
    await syncWecomMenu(store, cfg, secrets, url.origin);
    await store.addLog({ level: "info", event: "wecom_menu_synced" });
    return json({ ok: true });
  } catch (e) {
    return err("wecom_upstream_error", e instanceof Error ? e.message : String(e), 502);
  }
}

async function handleWecomTest(store: Store, env: Env): Promise<Response> {
  const cfg = await getWecomConfig(store);
  const secrets = await getWecomSecretsPlain(store, env);
  if (!cfg.corp_id || !cfg.agent_id || !secrets.secret) {
    return err("bad_request", "请先填写并保存 CorpID、AgentID 和应用 Secret", 400);
  }
  try {
    const target = wecomNotifyTarget(cfg);
    await sendWecomText(
      store, cfg, secrets, target,
      "✅ PanPilot 企业微信联动测试成功！\n直接回复剧名即可搜索并自动订阅。",
    );
    await store.addLog({ level: "info", event: "wecom_test_sent", detail: JSON.stringify({ target }) });
    return json({ ok: true, target });
  } catch (e) {
    return err("wecom_upstream_error", e instanceof Error ? e.message : String(e), 502);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const store = getStore(env);

    try {
      // WeCom trusted-domain verification file (WW_verify_*.txt).
      if (pathname.startsWith("/WW_verify_") && pathname.endsWith(".txt") && req.method === "GET") {
        const vRes = await handleWecomVerifyFile(pathname, store);
        if (vRes) return vRes;
      }

      // Public endpoints.
      if (pathname === "/api/health") {
        const hasUiKey = (await store.listDriverKeys()).some((k) => !k.revoked_at);
        return json({
          ok: true,
          version: VERSION,
          store: store.kind,
          web_auth: (await getEffectiveAuth(env, store)) ? "password" : "disabled",
          driver_auth: env.DRIVER_TOKEN || hasUiKey ? "configured" : "not_configured",
          time: now(),
        });
      }
      if (pathname === "/login") return handleLogin(req, env, url, store);
      if (pathname === "/logout" && req.method === "POST") return handleLogout();
      if (pathname === "/api/wecom/callback") return handleWecomCallback(req, url, store, env, ctx);
      if (pathname === "/api/wecom/oauth" && req.method === "GET") return handleWecomOAuth(url, store, env);

      // Driver API — independent API key (UI-managed key or bootstrap
      // DRIVER_TOKEN secret), unaffected by web login.
      if (pathname.startsWith("/api/driver/")) {
        const denied = await driverAuth(req, env, store);
        if (denied) return denied;
        if (pathname === "/api/driver/pending" && req.method === "GET") return handleDriverPending(url, store);
        if (pathname === "/api/driver/claim" && req.method === "POST") return handleDriverClaim(req, store);
        if (pathname === "/api/driver/candidates" && req.method === "POST") return handleDriverCandidates(req, store);
        if (pathname === "/api/driver/progress" && req.method === "POST") return handleDriverProgress(req, store, env, ctx);
        if (pathname === "/api/driver/heartbeat" && req.method === "POST") return handleDriverHeartbeat(req, store);
        if (pathname === "/api/driver/logs" && req.method === "POST") return handleDriverLogs(req, store);
        if (pathname === "/api/driver/config" && req.method === "GET") return handleDriverConfig(store, env);
        if (pathname === "/api/driver/quark-status" && req.method === "POST") return handleDriverQuarkStatus(req, store, env, ctx);
        if (pathname === "/api/driver/agent-guide" && req.method === "GET") return handleDriverAgentGuide();
        return err("not_found", "unknown driver endpoint", 404);
      }

      // Everything below requires web login (when configured).
      const denied = await webAuth(req, env, url, store);
      if (denied) return denied;

      if (pathname === "/" || pathname === "/index.html") {
        return new Response(appHtml("dashboard"), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (pathname === "/subscriptions") {
        return new Response(appHtml("subscriptions"), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (pathname === "/explore") {
        return new Response(appHtml("explore"), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (pathname === "/discover") {
        return new Response(appHtml("discover"), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (pathname === "/logs") {
        return new Response(appHtml("logs"), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (pathname === "/settings") {
        return new Response(appHtml("settings"), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (pathname === "/api/subscriptions" || pathname.startsWith("/api/subscriptions/")) {
        if (pathname === "/api/subscriptions" && req.method === "GET") return handleListSubs(store, env);
        if (pathname === "/api/subscriptions" && req.method === "POST") return handleCreateSub(req, store);
        const m = pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
        if (m) {
          const id = decodeURIComponent(m[1]);
          if (req.method === "GET") return handleGetSub(store, id);
          if (req.method === "PATCH") return handlePatchSub(req, store, env, id);
          if (req.method === "DELETE") return handleDeleteSub(store, id);
        }
        return err("not_found", "unknown subscriptions endpoint", 404);
      }

      if (pathname === "/api/stats" && req.method === "GET") return handleStats(store);

      if (pathname === "/api/logs" && req.method === "GET") return handleListLogs(url, store);

      if (pathname === "/api/settings/driver-keys" || pathname.startsWith("/api/settings/driver-keys/")) {
        if (pathname === "/api/settings/driver-keys") {
          if (req.method === "GET") return handleListDriverKeys(store, env);
          if (req.method === "POST") return handleCreateDriverKey(req, store, env);
        }
        const rm = pathname.match(/^\/api\/settings\/driver-keys\/([^/]+)\/reveal$/);
        if (rm && req.method === "GET") {
          return handleRevealDriverKey(store, env, decodeURIComponent(rm[1]));
        }
        const km = pathname.match(/^\/api\/settings\/driver-keys\/([^/]+)\/(reset|revoke)$/);
        if (km && req.method === "POST") {
          const keyId = decodeURIComponent(km[1]);
          if (km[2] === "reset") return handleResetDriverKey(store, env, keyId);
          return handleRevokeDriverKey(store, keyId);
        }
        return err("not_found", "unknown driver-keys endpoint", 404);
      }

      if (pathname === "/api/settings") {
        if (req.method === "GET") return handleGetSettings(store, env);
        if (req.method === "PUT" || req.method === "POST") return handleUpdateSettings(req, store, env);
        return err("not_found", "unknown settings endpoint", 404);
      }

      if (pathname === "/api/account") {
        if (req.method === "PUT") return handleChangeAccount(req, env, store);
        return err("not_found", "unknown account endpoint", 404);
      }

      if (pathname === "/api/tmdb/search" && req.method === "GET") return handleTmdbSearch(url, store);
      if (pathname === "/api/tmdb/details" && req.method === "GET") return handleTmdbDetails(url, store);

      if (pathname === "/api/explore/img" && req.method === "GET") {
        return handleExploreImg(url.searchParams.get("url"));
      }
      if (pathname === "/api/explore/tmdb" && req.method === "GET") {
        const dirs = await getEffectiveDirectories(store);
        const res = await fetchTmdbExplore(url, (p) => tmdbFetch(store, p), dirs);
        if (res.errorResponse) return res.errorResponse;
        return json({ items: res.items ?? [], page: res.page ?? 1, total_pages: res.total_pages ?? 1 });
      }
      if (pathname === "/api/explore/douban" && req.method === "GET") {
        const collection = url.searchParams.get("collection") || "tv_hot";
        const start = Number(url.searchParams.get("start") ?? "0");
        const count = Number(url.searchParams.get("count") ?? "20");
        const dirs = await getEffectiveDirectories(store);
        try {
          const data = await fetchDoubanExplore(collection, start, count, dirs);
          return json(data);
        } catch (e) {
          return err("douban_upstream_error", e instanceof Error ? e.message : String(e), 502);
        }
      }
      if (pathname === "/api/explore/match" && req.method === "GET") {
        const title = url.searchParams.get("title")?.trim() ?? "";
        if (!title) return err("bad_request", "title is required", 400);
        const mediaType = (url.searchParams.get("media_type") || "tv") as ExploreMediaType;
        const yearRaw = Number(url.searchParams.get("year") ?? "");
        const year = Number.isFinite(yearRaw) && yearRaw > 1900 ? yearRaw : undefined;
        const { results, errorCode } = await searchTmdbItems(store, cleanMediaTitle(title) || title);
        if (!results) {
          return json({ tmdb_configured: errorCode !== "tmdb_not_configured", matched: null });
        }
        const matched = pickBestTmdbMatch(
          results.map((r) => ({ ...r, media_type: r.media_type === "movie" ? "movie" : "tv" })),
          title,
          mediaType,
          year,
        );
        return json({ tmdb_configured: true, matched });
      }

      if (pathname === "/api/wecom/menu/sync" && req.method === "POST") return handleWecomSyncMenu(url, store, env);
      if (pathname === "/api/wecom/test" && req.method === "POST") return handleWecomTest(store, env);

      if (pathname === "/api/agent-guide" && req.method === "GET") {
        return new Response(JSON.stringify({ guide: AI_DRIVER_GUIDE_MD, version: VERSION }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }

      return err("not_found", "not found", 404);
    } catch (e) {
      return err("internal", e instanceof Error ? e.message : String(e), 500);
    }
  },
};
