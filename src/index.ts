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

const VERSION = "1.1.0";
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
  "next_check_at", "last_checked_at", "last_error", "created_at", "updated_at",
] as const;

function subValues(s: Subscription): unknown[] {
  return [
    s.id, s.title, s.original_title ?? null, s.year ?? null, s.tmdb_id ?? null,
    s.media_type, s.region ?? null, s.season ?? null, s.total_episodes ?? null,
    s.quality_pref ?? null, s.quality ?? null, s.poster_path ?? null, s.overview ?? null, s.rating ?? null,
    s.mode, s.status, s.target_dir ?? null,
    s.next_check_at ?? null, s.last_checked_at ?? null, s.last_error ?? null,
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

async function handleListSubs(store: Store): Promise<Response> {
  return json({ subscriptions: await store.listSubscriptions() });
}

async function handleCreateSub(req: Request, store: Store): Promise<Response> {
  const input = await body<Partial<Subscription>>(req);
  if (!input?.title) return err("bad_request", "title is required", 400);
  // v1.0: the optional resolution override must be a known value;
  // absent/empty means "follow the global quality profile".
  const q = normalizeQualityOverride(input.quality);
  if (q.error) return err("bad_request", q.error, 400);
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
    poster_path: typeof input.poster_path === "string" && input.poster_path ? input.poster_path : undefined,
    overview: typeof input.overview === "string" && input.overview ? input.overview : undefined,
    rating: typeof input.rating === "number" && Number.isFinite(input.rating) ? input.rating : undefined,
    mode: input.mode ?? "manual",
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

async function handlePatchSub(req: Request, store: Store, id: string): Promise<Response> {
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
async function handleDriverProgress(req: Request, store: Store, env: Env): Promise<Response> {
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
    // Still following this show: schedule the next Driver round (+6h by default).
    patch.next_check_at = now() + checkIntervalSeconds(env);
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
// Only SHA-256 hashes are stored; the plaintext token is returned exactly
// once by create/reset and never again by any endpoint.
// ---------------------------------------------------------------------------

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

/** GET /api/settings/driver-keys — list UI keys (hints only) + bootstrap status. */
async function handleListDriverKeys(store: Store, env: Env): Promise<Response> {
  return json({
    driver_keys: await store.listDriverKeys(),
    // The DRIVER_TOKEN secret is the bootstrap key: always valid, managed
    // via Worker secrets, intentionally not part of this list.
    bootstrap_key: { configured: !!env.DRIVER_TOKEN },
  });
}

/** POST /api/settings/driver-keys {name} → 201 with the plaintext key ONCE. */
async function handleCreateDriverKey(req: Request, store: Store): Promise<Response> {
  const input = await body<{ name?: unknown }>(req);
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
    return err("bad_request", "name is required (1–64 chars, no control characters)", 400);
  }
  const { record, token } = await insertDriverKey(store, name);
  await store.addLog({
    level: "info", event: "driver_key_created",
    detail: JSON.stringify({ id: record.id, name: record.name, hint: record.token_hint }),
  });
  return json({ key: token, driver_key: publicDriverKey(record) }, 201);
}

/**
 * POST /api/settings/driver-keys/:id/reset — revoke the old row and issue a
 * new key under the same name. Returns the new plaintext ONCE.
 */
async function handleResetDriverKey(store: Store, id: string): Promise<Response> {
  const old = await store.getDriverKey(id);
  if (!old) return err("not_found", "driver key not found", 404);
  if (!old.revoked_at) await store.revokeDriverKey(id, now());
  const { record, token } = await insertDriverKey(store, old.name);
  await store.addLog({
    level: "info", event: "driver_key_reset",
    detail: JSON.stringify({ old_id: old.id, new_id: record.id, name: record.name, hint: record.token_hint }),
  });
  return json({ key: token, driver_key: publicDriverKey(record) }, 201);
}

/** POST /api/settings/driver-keys/:id/revoke — idempotent. */
async function handleRevokeDriverKey(store: Store, id: string): Promise<Response> {
  const rec = await store.getDriverKey(id);
  if (!rec) return err("not_found", "driver key not found", 404);
  if (rec.revoked_at) return json({ ok: true, already_revoked: true });
  await store.revokeDriverKey(id, now());
  await store.addLog({
    level: "info", event: "driver_key_revoked",
    detail: JSON.stringify({ id: rec.id, name: rec.name, hint: rec.token_hint }),
  });
  return json({ ok: true });
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
  return json({
    settings: {
      tmdb_api_key: { configured: !!key, masked: key ? maskKey(key) : null },
      check_interval_hours: checkIntervalSeconds(env) / 3600,
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

  if (!changed) {
    return err("bad_request", "nothing to update: provide tmdb_api_key / quark_cookie / tg_channels / tg_channels_priority_only / directories / quality (or the clear/reset flags)", 400);
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
      check_interval_hours: checkIntervalSeconds(env) / 3600,
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
async function handleDriverQuarkStatus(req: Request, store: Store): Promise<Response> {
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

/** GET /api/tmdb/search?q=... — multi search (tv + movie), zh-CN. */
async function handleTmdbSearch(url: URL, store: Store): Promise<Response> {
  const q = url.searchParams.get("q")?.trim();
  if (!q) return err("bad_request", "q is required", 400);
  const { data, errorResponse } = await tmdbFetch(store, `/search/multi?query=${encodeURIComponent(q)}&include_adult=false&page=1`);
  if (errorResponse) return errorResponse;
  const dirs = await getEffectiveDirectories(store);
  const results = ((data as { results?: unknown[] }).results ?? [])
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
  return json({ results });
}

/** GET /api/tmdb/details?type=tv|movie&id=... — seasons/episodes for tv. */
async function handleTmdbDetails(url: URL, store: Store): Promise<Response> {
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");
  if ((type !== "tv" && type !== "movie") || !id || !/^\d+$/.test(id)) {
    return err("bad_request", "type (tv|movie) and numeric id are required", 400);
  }
  const { data, errorResponse } = await tmdbFetch(store, `/${type}/${id}`);
  if (errorResponse) return errorResponse;
  const r = data as Row;
  const countries = Array.isArray(r.origin_country) ? (r.origin_country as unknown[]).map(String) : [];
  const dateStr = String((type === "tv" ? r.first_air_date : r.release_date) ?? "");
  const genreRows = Array.isArray(r.genres) ? (r.genres as Row[]) : [];
  const genres = genreRows.map((g) => String(g.name)).filter(Boolean);
  const genreIds = genreRows.map((g) => Number(g.id)).filter(Number.isFinite);
  const dirs = await getEffectiveDirectories(store);
  const base = {
    tmdb_id: Number(r.id),
    media_type: type as MediaType,
    title: String((type === "tv" ? r.name : r.title) ?? ""),
    original_title: String((type === "tv" ? r.original_name : r.original_title) ?? ""),
    year: dateStr ? Number(dateStr.slice(0, 4)) : undefined,
    origin_country: countries,
    region: regionForMedia(dirs, countries[0], type as MediaType, genreIds),
    genres,
    poster_url: tmdbPoster(r.poster_path),
    poster_path: typeof r.poster_path === "string" && r.poster_path ? r.poster_path : undefined,
    rating: typeof r.vote_average === "number" ? r.vote_average : undefined,
    overview: typeof r.overview === "string" ? r.overview : undefined,
    status: typeof r.status === "string" ? r.status : undefined,
  };
  if (type === "tv") {
    const seasons = (Array.isArray(r.seasons) ? (r.seasons as Row[]) : []).map((s) => ({
      season: Number(s.season_number),
      episode_count: Number(s.episode_count),
      name: typeof s.name === "string" ? s.name : undefined,
    }));
    return json({
      details: {
        ...base,
        number_of_seasons: typeof r.number_of_seasons === "number" ? r.number_of_seasons : undefined,
        number_of_episodes: typeof r.number_of_episodes === "number" ? r.number_of_episodes : undefined,
        seasons,
      },
    });
  }
  return json({
    details: {
      ...base,
      runtime: typeof r.runtime === "number" ? r.runtime : undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;
    const store = getStore(env);

    try {
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

      // Driver API — independent API key (UI-managed key or bootstrap
      // DRIVER_TOKEN secret), unaffected by web login.
      if (pathname.startsWith("/api/driver/")) {
        const denied = await driverAuth(req, env, store);
        if (denied) return denied;
        if (pathname === "/api/driver/pending" && req.method === "GET") return handleDriverPending(url, store);
        if (pathname === "/api/driver/claim" && req.method === "POST") return handleDriverClaim(req, store);
        if (pathname === "/api/driver/candidates" && req.method === "POST") return handleDriverCandidates(req, store);
        if (pathname === "/api/driver/progress" && req.method === "POST") return handleDriverProgress(req, store, env);
        if (pathname === "/api/driver/heartbeat" && req.method === "POST") return handleDriverHeartbeat(req, store);
        if (pathname === "/api/driver/logs" && req.method === "POST") return handleDriverLogs(req, store);
        if (pathname === "/api/driver/config" && req.method === "GET") return handleDriverConfig(store, env);
        if (pathname === "/api/driver/quark-status" && req.method === "POST") return handleDriverQuarkStatus(req, store);
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
        if (pathname === "/api/subscriptions" && req.method === "GET") return handleListSubs(store);
        if (pathname === "/api/subscriptions" && req.method === "POST") return handleCreateSub(req, store);
        const m = pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
        if (m) {
          const id = decodeURIComponent(m[1]);
          if (req.method === "GET") return handleGetSub(store, id);
          if (req.method === "PATCH") return handlePatchSub(req, store, id);
          if (req.method === "DELETE") return handleDeleteSub(store, id);
        }
        return err("not_found", "unknown subscriptions endpoint", 404);
      }

      if (pathname === "/api/stats" && req.method === "GET") return handleStats(store);

      if (pathname === "/api/logs" && req.method === "GET") return handleListLogs(url, store);

      if (pathname === "/api/settings/driver-keys" || pathname.startsWith("/api/settings/driver-keys/")) {
        if (pathname === "/api/settings/driver-keys") {
          if (req.method === "GET") return handleListDriverKeys(store, env);
          if (req.method === "POST") return handleCreateDriverKey(req, store);
        }
        const km = pathname.match(/^\/api\/settings\/driver-keys\/([^/]+)\/(reset|revoke)$/);
        if (km && req.method === "POST") {
          const keyId = decodeURIComponent(km[1]);
          if (km[2] === "reset") return handleResetDriverKey(store, keyId);
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

      return err("not_found", "not found", 404);
    } catch (e) {
      return err("internal", e instanceof Error ? e.message : String(e), 500);
    }
  },
};
