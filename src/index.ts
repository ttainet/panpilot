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
 */

import {
  regionForMedia,
  resolveDirectories,
  validateDirectories,
  type DirectorySettings,
} from "./directories";
import { AI_DRIVER_GUIDE_MD } from "./guide";

import { DEFAULT_TG_CHANNELS, PRIORITY_TG_CHANNELS } from "./channels";

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

const VERSION = "0.7.0";
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
    return new Response(LOGIN_HTML(failed), { headers: { "content-type": "text/html; charset=utf-8" } });
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
  private logs: unknown[] = [];
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
    this.logs.push({ ...entry, created_at: now() });
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
  "season", "total_episodes", "quality_pref", "poster_path", "overview", "rating",
  "mode", "status", "target_dir",
  "next_check_at", "last_checked_at", "last_error", "created_at", "updated_at",
] as const;

function subValues(s: Subscription): unknown[] {
  return [
    s.id, s.title, s.original_title ?? null, s.year ?? null, s.tmdb_id ?? null,
    s.media_type, s.region ?? null, s.season ?? null, s.total_episodes ?? null,
    s.quality_pref ?? null, s.poster_path ?? null, s.overview ?? null, s.rating ?? null,
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
      following: subs.filter((s) => ACTIVE_STATUSES.includes(s.status)).length,
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
    out.push({ ...sub, stored_episodes: stored, missing_episodes: missing });
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
    logs?: { level?: string; event?: string; detail?: string }[];
  }>(req);
  if (!input || !Array.isArray(input.logs)) return err("bad_request", "logs[] is required", 400);
  let subscriptionId: string | undefined;
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
    await store.addLog({
      subscription_id: subscriptionId, driver_id: driverId,
      level: l.level ?? "info", event: l.event, detail: l.detail,
    });
    accepted++;
  }
  return json({ accepted });
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

  if (!changed) {
    return err("bad_request", "nothing to update: provide tmdb_api_key / quark_cookie / tg_channels / tg_channels_priority_only / directories (or the clear/reset flags)", 400);
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
// Pages — v0.4 MoviePilot-style dark SPA (layout/interaction inspired by
// MoviePilot; all code and CSS below are an independent implementation,
// no GPL code or assets are reused).
// ---------------------------------------------------------------------------

const APP_CSS = `
  :root {
    --pp-bg: #0d1017;
    --pp-bg-soft: #12151f;
    --pp-panel: #171b28;
    --pp-panel-2: #1d2233;
    --pp-border: #262c40;
    --pp-text: #e8eaf2;
    --pp-muted: #9aa3b8;
    --pp-accent: #6d6df2;
    --pp-accent-2: #9d6bf5;
    --pp-grad: linear-gradient(135deg, #5b6cff 0%, #9d6bf5 100%);
    --pp-green: #34c98e;
    --pp-amber: #f0b35c;
    --pp-red: #f26d6d;
    --pp-gray: #8a93a8;
    --pp-radius: 14px;
    --pp-shadow: 0 10px 28px rgba(0, 0, 0, .38);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--pp-bg);
    color: var(--pp-text);
    min-height: 100vh;
  }
  a { color: var(--pp-accent-2); text-decoration: none; }
  button, input, select, textarea { font: inherit; color: inherit; }
  input, select, textarea {
    background: var(--pp-bg-soft);
    border: 1px solid var(--pp-border);
    border-radius: 10px;
    padding: .55rem .7rem;
    outline: none;
  }
  textarea { width: 100%; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .85rem; line-height: 1.5; resize: vertical; }
  input:focus, select:focus, textarea:focus { border-color: var(--pp-accent); }
  .status-bad { color: var(--pp-red); font-weight: 600; }
  .status-ok { color: var(--pp-green); }
  input::placeholder { color: #5d6577; }
  .btn {
    border: 1px solid var(--pp-border);
    background: var(--pp-panel-2);
    border-radius: 10px;
    padding: .5rem .95rem;
    cursor: pointer;
    transition: filter .15s, background .15s;
  }
  .btn:hover { filter: brightness(1.18); }
  .btn-primary { background: var(--pp-grad); border: none; color: #fff; font-weight: 600; }
  .btn-ghost { background: transparent; }
  .btn-danger { background: transparent; border-color: rgba(242, 109, 109, .45); color: var(--pp-red); }
  .muted { color: var(--pp-muted); font-size: .88rem; line-height: 1.55; }
  .error-text { color: var(--pp-red); font-size: .9rem; }

  /* ---- layout: fixed dark sidebar + main column ---- */
  .layout { display: flex; min-height: 100vh; }
  .sidebar {
    width: 232px; flex: 0 0 232px;
    background: var(--pp-bg-soft);
    border-right: 1px solid var(--pp-border);
    display: flex; flex-direction: column;
    padding: 1.1rem .9rem;
    position: sticky; top: 0; height: 100vh;
  }
  .brand { display: flex; align-items: center; gap: .65rem; padding: .2rem .4rem 1.1rem; }
  .brand-logo {
    width: 38px; height: 38px; border-radius: 11px;
    background: var(--pp-grad); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 1.15rem; box-shadow: var(--pp-shadow);
  }
  .brand-name { font-size: 1.18rem; font-weight: 700; letter-spacing: .02em; }
  .brand-sub { font-size: .72rem; color: var(--pp-muted); }
  .menu { display: flex; flex-direction: column; gap: .3rem; margin-top: .4rem; }
  .menu-item {
    display: flex; align-items: center; gap: .6rem;
    background: transparent; border: none; border-radius: 10px;
    padding: .62rem .7rem; cursor: pointer; text-align: left;
    color: var(--pp-muted); font-size: .97rem;
  }
  .menu-item svg { flex: 0 0 auto; opacity: .85; }
  .menu-item:hover { background: var(--pp-panel); color: var(--pp-text); }
  .menu-item.active { background: var(--pp-panel-2); color: #fff; box-shadow: inset 3px 0 0 var(--pp-accent); }
  .sidebar-foot { margin-top: auto; border-top: 1px solid var(--pp-border); padding-top: .9rem; }
  .side-user { font-size: .88rem; color: var(--pp-muted); padding: 0 .4rem .55rem; word-break: break-all; }
  .logout-btn {
    width: 100%; background: transparent; border: 1px solid var(--pp-border);
    border-radius: 10px; padding: .5rem; cursor: pointer; color: var(--pp-muted);
  }
  .logout-btn:hover { color: var(--pp-text); border-color: var(--pp-accent); }
  .main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .topbar {
    display: flex; align-items: center; gap: 1rem;
    padding: 1rem 1.6rem; border-bottom: 1px solid var(--pp-border);
    background: rgba(13, 16, 23, .85); position: sticky; top: 0; z-index: 5;
    backdrop-filter: blur(6px);
  }
  .page-title { font-size: 1.25rem; font-weight: 700; margin-right: auto; }
  .topbar-user { color: var(--pp-muted); font-size: .9rem; }
  .content { padding: 1.4rem 1.6rem 2.4rem; max-width: 1240px; width: 100%; margin: 0 auto; }
  .view { display: none; }
  .view.active { display: block; }

  /* ---- cards & stats ---- */
  .card {
    background: var(--pp-panel); border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius); box-shadow: var(--pp-shadow);
    padding: 1.15rem 1.25rem; margin-bottom: 1.2rem;
  }
  .card h2 { margin: 0 0 .55rem; font-size: 1.05rem; }
  .card h3 { margin: 0 0 .55rem; font-size: .98rem; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.2rem; }
  .stat-card {
    background: var(--pp-panel); border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius); box-shadow: var(--pp-shadow);
    padding: 1.05rem 1.2rem;
  }
  .stat-label { color: var(--pp-muted); font-size: .86rem; }
  .stat-value { font-size: 1.9rem; font-weight: 750; margin-top: .3rem; }
  .stat-value .unit { font-size: .9rem; color: var(--pp-muted); font-weight: 500; }
  form.inline { display: flex; flex-wrap: wrap; gap: .55rem; align-items: center; margin-top: .7rem; }

  /* ---- subscription poster wall ---- */
  .sub-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; }
  .sub-card {
    display: flex; gap: .95rem;
    background: var(--pp-panel); border: 1px solid var(--pp-border);
    border-radius: var(--pp-radius); box-shadow: var(--pp-shadow);
    padding: .9rem;
  }
  .poster { width: 92px; height: 138px; object-fit: cover; border-radius: 9px; flex: 0 0 auto; background: var(--pp-panel-2); }
  .poster-ph {
    display: flex; align-items: center; justify-content: center;
    font-size: 2rem; font-weight: 700; color: var(--pp-muted);
    background: linear-gradient(160deg, var(--pp-panel-2), var(--pp-bg-soft));
  }
  .sub-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .sub-title { font-weight: 650; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub-year { color: var(--pp-muted); font-weight: 500; font-size: .88rem; }
  .tag-row { display: flex; flex-wrap: wrap; gap: .35rem; margin: .45rem 0 .55rem; }
  .tag {
    font-size: .74rem; color: var(--pp-muted);
    border: 1px solid var(--pp-border); border-radius: 999px; padding: .08rem .5rem;
  }
  .tag-rate { color: var(--pp-amber); border-color: rgba(240, 179, 92, .4); }
  .progress { height: 7px; border-radius: 999px; background: var(--pp-bg-soft); overflow: hidden; }
  .progress-bar { height: 100%; background: var(--pp-grad); border-radius: 999px; }
  .sub-meta { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-top: .5rem; font-size: .85rem; color: var(--pp-muted); }
  .sub-next { font-size: .78rem; color: var(--pp-muted); margin-top: .3rem; }
  .sub-actions { display: flex; gap: .5rem; margin-top: auto; padding-top: .6rem; }
  .sub-actions .btn { padding: .38rem .8rem; font-size: .86rem; }
  .badge { font-size: .76rem; border-radius: 999px; padding: .14rem .55rem; white-space: nowrap; }
  .b-active { background: rgba(109, 109, 242, .18); color: #a5a5ff; }
  .b-partial { background: rgba(240, 179, 92, .16); color: var(--pp-amber); }
  .b-done { background: rgba(52, 201, 142, .15); color: var(--pp-green); }
  .b-paused { background: rgba(138, 147, 168, .16); color: var(--pp-gray); }
  .b-error { background: rgba(242, 109, 109, .15); color: var(--pp-red); }

  /* ---- recent list (dashboard) ---- */
  .recent-row {
    display: flex; align-items: center; gap: .85rem;
    padding: .55rem 0; border-bottom: 1px solid var(--pp-border);
  }
  .recent-row:last-child { border-bottom: none; }
  .recent-row img, .recent-row .poster-ph { width: 40px; height: 60px; border-radius: 6px; object-fit: cover; font-size: 1rem; }
  .recent-main { flex: 1 1 auto; min-width: 0; }
  .recent-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .recent-sub { color: var(--pp-muted); font-size: .8rem; margin-top: .15rem; }

  /* ---- discover / TMDB grid ---- */
  .tmdb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .9rem; margin-top: 1rem; }
  .tmdb-card {
    background: var(--pp-panel); border: 1px solid var(--pp-border);
    border-radius: 12px; overflow: hidden; cursor: pointer;
    transition: transform .12s, border-color .12s;
  }
  .tmdb-card:hover { transform: translateY(-2px); border-color: var(--pp-accent); }
  .tmdb-card img { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; display: block; background: var(--pp-panel-2); }
  .tmdb-card .poster-ph { width: 100%; aspect-ratio: 2 / 3; height: auto; border-radius: 0; }
  .tmdb-info { padding: .55rem .65rem .7rem; }
  .tmdb-info .t { font-weight: 600; font-size: .92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tmdb-info .m { color: var(--pp-muted); font-size: .78rem; margin-top: .2rem; }
  .guide-card { border-color: rgba(240, 179, 92, .5); }

  /* ---- modal ---- */
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(4, 6, 10, .66);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem; z-index: 50;
  }
  .modal-backdrop[hidden] { display: none; }
  .modal {
    background: var(--pp-panel); border: 1px solid var(--pp-border);
    border-radius: 16px; box-shadow: var(--pp-shadow);
    max-width: 640px; width: 100%; max-height: 90vh; overflow: auto; padding: 1.3rem;
  }
  .modal-head { display: flex; gap: 1.1rem; }
  .modal-head img, .modal-head .poster-ph { width: 120px; height: 180px; border-radius: 10px; object-fit: cover; }
  .modal-head .poster-ph { font-size: 2.4rem; }
  .modal-actions { display: flex; gap: .6rem; justify-content: flex-end; margin-top: 1.1rem; }
  .overview { color: var(--pp-muted); font-size: .9rem; line-height: 1.65; margin-top: .8rem;
    display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }

  /* ---- login ---- */
  .login-wrap {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 1.2rem;
    background:
      radial-gradient(720px 420px at 18% 12%, rgba(91, 108, 255, .22), transparent 60%),
      radial-gradient(640px 420px at 85% 88%, rgba(157, 107, 245, .18), transparent 60%),
      var(--pp-bg);
  }
  .login-card {
    width: 100%; max-width: 392px;
    background: var(--pp-panel); border: 1px solid var(--pp-border);
    border-radius: 18px; box-shadow: var(--pp-shadow);
    padding: 2rem 1.8rem 1.6rem;
  }
  .login-brand { display: flex; flex-direction: column; align-items: center; gap: .55rem; margin-bottom: 1.4rem; text-align: center; }
  .login-brand .brand-logo { width: 52px; height: 52px; border-radius: 14px; font-size: 1.5rem; }
  .login-card form { display: flex; flex-direction: column; gap: .7rem; }
  .login-card input { padding: .68rem .8rem; }
  .login-card .btn-primary { padding: .68rem; margin-top: .2rem; }
  .login-foot { text-align: center; margin-top: 1.1rem; }

  /* ---- responsive: sidebar collapses to a top bar ---- */
  @media (max-width: 880px) {
    .layout { flex-direction: column; }
    .sidebar {
      width: 100%; flex: none; height: auto; position: static;
      flex-direction: row; flex-wrap: wrap; align-items: center;
      padding: .6rem .8rem; gap: .5rem;
    }
    .brand { padding: 0; margin-right: auto; }
    .brand-sub { display: none; }
    .menu { flex-direction: row; flex-wrap: wrap; margin-top: 0; }
    .menu-item { padding: .45rem .6rem; }
    .menu-item.active { box-shadow: inset 0 -3px 0 var(--pp-accent); }
    .sidebar-foot { margin: 0; border: none; padding: 0; display: flex; align-items: center; gap: .6rem; }
    .side-user { padding: 0; }
    .logout-btn { width: auto; padding: .4rem .7rem; }
    .content { padding: 1rem .9rem 2rem; }
    .topbar { padding: .8rem 1rem; }
    .sub-grid { grid-template-columns: 1fr; }
  }
`;

function LOGIN_HTML(failed: boolean): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PanPilot 登录</title>
<style>${APP_CSS}</style>
</head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <div class="login-brand">
      <div class="brand-logo">P</div>
      <div class="brand-name" style="font-size:1.35rem">PanPilot</div>
      <div class="brand-sub">影视订阅控制台</div>
    </div>
    ${failed ? '<p class="error-text">用户名或密码不正确，请重试。</p>' : ""}
    <form method="post" action="/login">
      <input name="username" placeholder="用户名" autocomplete="username" required>
      <input name="password" type="password" placeholder="密码" autocomplete="current-password" required>
      <button type="submit" class="btn btn-primary">登录</button>
    </form>
    <p class="muted login-foot">订阅控制面。搜索与转存由外部 Driver 执行；网盘 Cookie 仅在你主动填写后以 AES-GCM 加密形式保存，仅供你的 Driver 取用。</p>
  </div>
</div>
</body>
</html>`;
}

// Small inline icons (own simple SVG paths, currentColor).
const ICON_DASH = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';
const ICON_SUBS = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/></svg>';
const ICON_FIND = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg>';
const ICON_GEAR = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/></svg>';

function appHtml(initialView: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PanPilot</title>
<style>${APP_CSS}</style>
</head>
<body data-initial-view="${initialView}">
<div class="layout">
  <aside class="sidebar" id="sidebar">
    <div class="brand">
      <div class="brand-logo">P</div>
      <div>
        <div class="brand-name">PanPilot</div>
        <div class="brand-sub">影视订阅控制台</div>
      </div>
    </div>
    <nav class="menu">
      <button class="menu-item" data-nav="dashboard">${ICON_DASH}<span>仪表盘</span></button>
      <button class="menu-item" data-nav="subscriptions">${ICON_SUBS}<span>我的订阅</span></button>
      <button class="menu-item" data-nav="discover">${ICON_FIND}<span>发现</span></button>
      <button class="menu-item" data-nav="settings">${ICON_GEAR}<span>设置</span></button>
    </nav>
    <div class="sidebar-foot">
      <div class="side-user" id="side-user"></div>
      <form method="post" action="/logout"><button class="logout-btn" type="submit">退出登录</button></form>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <div class="page-title" id="page-title">仪表盘</div>
      <div class="topbar-user" id="topbar-user"></div>
    </header>
    <main class="content">

      <section class="view" id="view-dashboard">
        <div class="stat-grid">
          <div class="stat-card"><div class="stat-label">订阅总数</div><div class="stat-value" id="stat-total">–</div></div>
          <div class="stat-card"><div class="stat-label">追更中</div><div class="stat-value" id="stat-following">–</div></div>
          <div class="stat-card"><div class="stat-label">已完结 / 集齐</div><div class="stat-value" id="stat-finished">–</div></div>
          <div class="stat-card"><div class="stat-label">已入库集数</div><div class="stat-value" id="stat-stored">–</div></div>
        </div>
        <div class="card">
          <h2>最近更新的订阅</h2>
          <div id="recent-list"><p class="muted">加载中…</p></div>
        </div>
        <p class="muted">搜索与转存由外部 Driver 每 6 小时一轮执行；本页只管理订阅与进度。订阅绑定 TMDB ID（参考 MoviePilot），后续按季追踪。</p>
      </section>

      <section class="view" id="view-subscriptions">
        <div class="sub-grid" id="sub-grid"><p class="muted">加载中…</p></div>
      </section>

      <section class="view" id="view-discover">
        <div class="card">
          <h2>从 TMDB 选剧</h2>
          <form class="inline" id="tmdb-form">
            <input id="tmdb-q" placeholder="输入剧名，如 谷雨" style="min-width:240px;flex:1">
            <button type="submit" class="btn btn-primary">搜索 TMDB</button>
          </form>
          <p class="muted">点搜索结果可看详情并按季订阅。综艺在 TMDB 中属于 tv 类型，订阅后可在下方手动表单里把类型改成「综艺」重新添加。</p>
          <div id="tmdb-guide"></div>
          <div id="tmdb-results" class="tmdb-grid"></div>
        </div>
        <div class="card">
          <h2>手动添加订阅</h2>
          <p class="muted">TMDB 未配置或搜不到时，可直接填写。带海报的订阅请从上方搜索订阅。</p>
          <form id="add-form" class="inline">
            <input name="title" id="f-title" placeholder="剧名 *" required>
            <input name="year" id="f-year" type="number" placeholder="年份" min="1900" max="2100" style="width:100px">
            <select name="media_type" id="f-media_type">
              <option value="tv">电视剧</option>
              <option value="movie">电影</option>
              <option value="variety">综艺</option>
            </select>
            <input name="region" id="f-region" placeholder="地区，如 国产剧">
            <input name="season" id="f-season" type="number" placeholder="季" min="0" style="width:80px">
            <input name="total_episodes" id="f-total_episodes" type="number" placeholder="总集数" min="1" style="width:100px">
            <select name="mode" id="f-mode">
              <option value="manual">手动确认</option>
              <option value="auto">自动转存</option>
            </select>
            <button type="submit" class="btn btn-primary">添加订阅</button>
          </form>
        </div>
      </section>

      <section class="view" id="view-settings">
        <div class="card">
          <h2>TMDB</h2>
          <p class="muted">TMDB API Key 保存在服务端设置中（页面只显示末 4 位掩码），用于发现页的选剧搜索与元数据回填。Key 在 themoviedb.org 免费申请。</p>
          <p>当前状态：<span id="tmdb-status">加载中…</span></p>
          <form id="tmdb-key-form" class="inline">
            <input id="tmdb-key" placeholder="输入新的 TMDB API Key" style="min-width:320px;flex:1" autocomplete="off">
            <button type="submit" class="btn btn-primary">保存</button>
            <button type="button" class="btn" id="tmdb-clear">清除</button>
          </form>
        </div>
        <div class="card" id="card-quark-cookie">
          <h2>夸克网盘 Cookie</h2>
          <p class="muted">Driver 用它直接调用夸克接口转存。Cookie 以 <strong>AES-GCM 加密</strong>形式保存在服务端（密钥为 Worker Secret，页面与接口永不回显明文）；只有持有 Driver Token 的 Driver 能取回。Cookie 等同于登录凭证，请只在本页填写，不要发到聊天或代码仓库里。</p>
          <p>当前状态：<span id="cookie-status">加载中…</span></p>
          <p id="cookie-driver-status" class="muted"></p>
          <form id="cookie-form" class="inline">
            <input id="cookie-input" type="password" placeholder="粘贴夸克 Cookie（已保存的值不会回显）" style="min-width:320px;flex:1" autocomplete="off">
            <button type="submit" class="btn btn-primary">保存 Cookie</button>
            <button type="button" class="btn" id="cookie-clear">清除</button>
          </form>
          <p id="cookie-msg" class="muted"></p>
        </div>
        <div class="card" id="card-tg-channels">
          <h2>TG 频道列表</h2>
          <p class="muted">Driver 搜索时使用的 Telegram 频道，一行一个频道名。未自定义时使用内置默认清单（2026-11-23 逐个验证的 147 个有效频道）。打开「只用夸克优先频道」时：默认清单直接用其中确认有夸克链接的 76 个；自定义清单则取它与这 76 个的交集，交集为空时退回自定义清单全量。</p>
          <p>当前状态：<span id="channels-status">加载中…</span></p>
          <textarea id="channels-input" rows="12" spellcheck="false"></textarea>
          <p class="muted">共 <span id="channels-count">0</span> 个频道（输入时实时计数，保存时自动去重、去空行）。</p>
          <form class="inline" id="channels-form">
            <label class="muted"><input type="checkbox" id="channels-priority" style="width:auto"> 只用夸克优先频道（76）</label>
            <button type="submit" class="btn btn-primary">保存频道列表</button>
            <button type="button" class="btn" id="channels-reset">恢复默认（147）</button>
          </form>
          <p id="channels-msg" class="muted"></p>
        </div>
        <div class="card" id="card-directories">
          <h2>入库目录</h2>
          <p class="muted">Driver 转存入库时使用的网盘目录规范，分类判定以这里的映射为准（Driver 每轮从配置接口读取生效值）。默认值按夸克实际结构预填：电视剧与电影都在根目录下，日韩合并为「日韩剧」，国漫/纪录片/综艺都在电视剧下，电影分华语/外语/动画。映射一行一条，格式「代码=文件夹名」：地区代码为 TMDB 原产地代码（CN/JP/KR 等），* 表示其他地区；电影映射里 animation 表示动画电影；电视剧特殊分类的键为 animation_cn（国漫）/ documentary（纪录片）/ variety（综艺）。模板占位符：{title} {year} {season} {episode}，:02 表示两位零填充。</p>
          <p>当前状态：<span id="directories-status">加载中…</span></p>
          <form id="directories-form">
            <div style="display:flex;flex-wrap:wrap;gap:.55rem;align-items:center">
              <label class="muted">根目录 <input id="dir-base" style="width:150px"></label>
              <label class="muted">电视剧目录 <input id="dir-tv" style="width:110px"></label>
              <label class="muted">电影目录 <input id="dir-movie" style="width:110px"></label>
            </div>
            <p class="muted" style="margin:.7rem 0 .3rem">电视剧地区映射（原产地 → 文件夹）</p>
            <textarea id="dir-tv-region" rows="4" spellcheck="false"></textarea>
            <p class="muted" style="margin:.7rem 0 .3rem">电视剧特殊分类（键 → 文件夹）</p>
            <textarea id="dir-tv-special" rows="3" spellcheck="false"></textarea>
            <p class="muted" style="margin:.7rem 0 .3rem">电影分类映射（原产地 / animation → 文件夹）</p>
            <textarea id="dir-movie-category" rows="4" spellcheck="false"></textarea>
            <p class="muted" style="margin:.7rem 0 .3rem">命名模板</p>
            <div style="display:flex;flex-wrap:wrap;gap:.55rem;align-items:center">
              <label class="muted">剧名夹 <input id="dir-title-template" style="width:170px"></label>
              <label class="muted">季夹 <input id="dir-season-template" style="width:150px"></label>
              <label class="muted">单集文件 <input id="dir-episode-template" style="width:300px"></label>
            </div>
            <p class="muted">示例路径：<span id="directories-preview">—</span></p>
            <div style="display:flex;flex-wrap:wrap;gap:.55rem;align-items:center;margin-top:.7rem">
              <button type="submit" class="btn btn-primary">保存目录设置</button>
              <button type="button" class="btn" id="directories-reset">恢复默认</button>
            </div>
          </form>
          <p id="directories-msg" class="muted"></p>
        </div>
        <div class="card">
          <h2>登录账号</h2>
          <p class="muted">当前登录用户名：<span id="account-username">…</span>（来源：<span id="account-source">…</span>）。初始账号密码来自部署时的 Secrets，在这里修改后以新账号为准（密码只存哈希）。修改须验证当前密码；保存后其他设备上的旧登录会失效，本浏览器会自动续上新登录。</p>
          <form id="account-form" class="inline">
            <input id="acc-current" type="password" placeholder="当前密码 *" autocomplete="current-password" required>
            <input id="acc-username" placeholder="新用户名（不改可留空）" autocomplete="username">
            <input id="acc-password" type="password" placeholder="新密码（不改可留空）" autocomplete="new-password">
            <input id="acc-password2" type="password" placeholder="再输一次新密码" autocomplete="new-password">
            <button type="submit" class="btn btn-primary">保存新账号</button>
          </form>
          <p id="account-msg" class="muted"></p>
        </div>
        <div class="card" id="card-driver-keys">
          <h2>Driver API Key</h2>
          <p class="muted">Driver 需要的一切凭据都从 PanPilot 取（夸克 Cookie、TMDB Key、频道清单），而取用前必须先凭 API Key 通过鉴权：请求头带 <code>Authorization: Bearer &lt;Key&gt;</code>，没有有效 Key 时所有 Driver 接口一律 401、拿不到任何数据。在这里可为每个 Driver 建独立 Key（建议一个 Driver 一个，名称写清是谁），也可重置（旧 Key 立即作废、生成新 Key）或吊销。Key 明文<strong>只在创建/重置时显示一次</strong>，服务端只保存它的 SHA-256 哈希，丢了只能重置。</p>
          <p>当前 Key：<span id="driver-keys-status">加载中…</span></p>
          <div id="driver-keys-list"></div>
          <div id="dk-once" hidden style="border:1px solid rgba(240,179,92,.55);border-radius:10px;padding:.8rem .9rem;margin:.8rem 0">
            <p style="color:var(--pp-amber);font-weight:600;margin:.1rem 0 .6rem">新 Key 只显示这一次，请立即复制并保存到 Driver 的配置里：</p>
            <form class="inline" id="dk-once-form">
              <input id="dk-once-value" readonly style="min-width:340px;flex:1;font-family:ui-monospace,Menlo,Consolas,monospace" autocomplete="off">
              <button type="button" class="btn" id="dk-copy">复制</button>
              <button type="button" class="btn btn-ghost" id="dk-once-close">我已保存，关闭</button>
            </form>
          </div>
          <form id="dk-form" class="inline">
            <input id="dk-name" placeholder="Driver 名称，如 claude-main / home-nas" style="min-width:280px" autocomplete="off">
            <button type="submit" class="btn btn-primary">新建 Key</button>
          </form>
          <p id="dk-msg" class="muted"></p>
          <p class="muted">说明：部署时设置的 DRIVER_TOKEN 是「系统引导 Key」，不在上面的列表里、始终有效；如需停用它，要修改 Worker 的 DRIVER_TOKEN Secret。</p>
        </div>
        <div class="card">
          <h2>Driver</h2>
          <p class="muted">Driver 检查间隔：<span id="interval">…</span> 小时一轮（由 Worker 环境变量 CHECK_INTERVAL_HOURS 控制，默认 6）。Driver API 使用独立 API Key（见上方卡片），与网页登录互不影响。</p>
        </div>
      </section>

    </main>
  </div>
</div>

<div class="modal-backdrop" id="modal-backdrop" hidden>
  <div class="modal" role="dialog" aria-modal="true">
    <div id="modal-content"><p class="muted">加载中…</p></div>
  </div>
</div>

<script>
var VIEWS = ['dashboard', 'subscriptions', 'discover', 'settings'];
var VIEW_TITLES = { dashboard: '仪表盘', subscriptions: '我的订阅', discover: '发现', settings: '设置' };
var STATUS_LABEL = {
  subscribed: '已订阅', pending_search: '待搜索', searching: '搜索中',
  candidates_ready: '已找到候选', awaiting_confirm: '待确认', transferring: '转存中',
  verifying: '复核中', partial_stored: '部分入库', completed: '已集齐',
  ended: '已完结', paused: '已暂停', error: '出错'
};
var subsCache = [];
var storedMap = {};

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
  if (s === 'partial_stored') return 'b-partial';
  if (s === 'paused') return 'b-paused';
  if (s === 'error') return 'b-error';
  return 'b-active';
}
function badge(s) {
  return '<span class="badge ' + statusClass(s) + '">' + esc(STATUS_LABEL[s] || s) + '</span>';
}
function posterUrl(p, size) { return p ? 'https://image.tmdb.org/t/p/' + (size || 'w342') + p : null; }
function posterHtml(s, cls) {
  var url = posterUrl(s.poster_path);
  if (url) return '<img class="' + cls + '" src="' + url + '" alt="" loading="lazy">';
  return '<div class="' + cls + ' poster-ph">' + esc((s.title || '?').slice(0, 1)) + '</div>';
}
async function api(path, opts) {
  var r = await fetch(path, opts || {});
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  return r;
}

function switchView(name) {
  if (VIEWS.indexOf(name) < 0) name = 'dashboard';
  for (var i = 0; i < VIEWS.length; i++) {
    document.getElementById('view-' + VIEWS[i]).classList.toggle('active', VIEWS[i] === name);
  }
  var items = document.querySelectorAll('.menu-item');
  for (var j = 0; j < items.length; j++) {
    items[j].classList.toggle('active', items[j].getAttribute('data-nav') === name);
  }
  document.getElementById('page-title').textContent = VIEW_TITLES[name];
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}
var navItems = document.querySelectorAll('.menu-item');
for (var n = 0; n < navItems.length; n++) {
  navItems[n].addEventListener('click', function () { switchView(this.getAttribute('data-nav')); });
}

/* ---------- subscriptions rendering ---------- */
function progressOf(s) {
  var stored = storedMap[s.id] || 0;
  var total = s.total_episodes || 0;
  var pct = total > 0 ? Math.min(100, Math.round(stored / total * 100)) : (stored > 0 ? 100 : 0);
  var text = s.media_type === 'movie'
    ? (stored > 0 ? '已入库' : '未入库')
    : ('已入库 ' + stored + (total ? ' / ' + total + ' 集' : ' 集'));
  return { stored: stored, total: total, pct: pct, text: text };
}
function subCard(s) {
  var p = progressOf(s);
  var tags = '<span class="tag">' + mediaLabel(s.media_type) + '</span>'
    + (s.region ? '<span class="tag">' + esc(s.region) + '</span>' : '')
    + (s.season != null && s.media_type !== 'movie' ? '<span class="tag">第 ' + s.season + ' 季</span>' : '')
    + (s.rating ? '<span class="tag tag-rate">★ ' + Number(s.rating).toFixed(1) + '</span>' : '');
  var pauseBtn = s.status === 'paused'
    ? '<button class="btn btn-ghost" data-act="resume" data-id="' + s.id + '">恢复</button>'
    : '<button class="btn btn-ghost" data-act="pause" data-id="' + s.id + '">暂停</button>';
  return '<article class="sub-card">' + posterHtml(s, 'poster')
    + '<div class="sub-body">'
    + '<div class="sub-title">' + esc(s.title) + (s.year ? ' <span class="sub-year">' + s.year + '</span>' : '') + '</div>'
    + '<div class="tag-row">' + tags + '</div>'
    + '<div class="progress"><div class="progress-bar" style="width:' + p.pct + '%"></div></div>'
    + '<div class="sub-meta"><span>' + p.text + '</span>' + badge(s.status) + '</div>'
    + '<div class="sub-next">下次检查：' + fmtTime(s.next_check_at) + '</div>'
    + '<div class="sub-actions">' + pauseBtn
    + '<button class="btn btn-danger" data-act="delete" data-id="' + s.id + '">删除</button></div>'
    + '</div></article>';
}
function renderSubs() {
  var grid = document.getElementById('sub-grid');
  grid.innerHTML = subsCache.length ? subsCache.map(subCard).join('') : '<p class="muted">暂无订阅，去「发现」页搜一部剧开始吧。</p>';
}
function renderDashboard(stats) {
  document.getElementById('stat-total').textContent = stats.total_subscriptions;
  document.getElementById('stat-following').textContent = stats.following;
  document.getElementById('stat-finished').textContent = stats.finished;
  document.getElementById('stat-stored').textContent = stats.stored_episodes;
  var recent = subsCache.slice().sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); }).slice(0, 6);
  var box = document.getElementById('recent-list');
  if (!recent.length) { box.innerHTML = '<p class="muted">暂无订阅。</p>'; return; }
  box.innerHTML = recent.map(function (s) {
    var p = progressOf(s);
    return '<div class="recent-row">' + posterHtml(s, '')
      + '<div class="recent-main"><div class="recent-title">' + esc(s.title)
      + (s.year ? ' <span class="sub-year">' + s.year + '</span>' : '') + '</div>'
      + '<div class="recent-sub">' + mediaLabel(s.media_type)
      + (s.region ? ' · ' + esc(s.region) : '') + ' · ' + p.text + ' · 更新于 ' + fmtTime(s.updated_at) + '</div></div>'
      + badge(s.status) + '</div>';
  }).join('');
}
async function loadSubs() {
  var r = await api('/api/subscriptions');
  var data = await r.json();
  subsCache = data.subscriptions || [];
  var rs = await api('/api/stats');
  var sd = await rs.json();
  storedMap = (sd.stats && sd.stats.stored_by_subscription) || {};
  renderSubs();
  renderDashboard(sd.stats);
}
document.getElementById('sub-grid').addEventListener('click', async function (e) {
  var btn = e.target.closest('button[data-act]');
  if (!btn) return;
  var id = btn.getAttribute('data-id');
  var act = btn.getAttribute('data-act');
  if (act === 'delete') {
    if (!confirm('确定删除这个订阅吗？（只删订阅记录，不动网盘里的文件）')) return;
    await api('/api/subscriptions/' + id, { method: 'DELETE' });
  } else if (act === 'pause') {
    await api('/api/subscriptions/' + id, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'paused' })
    });
  } else if (act === 'resume') {
    await api('/api/subscriptions/' + id, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'pending_search', next_check_at: Math.floor(Date.now() / 1000) })
    });
  }
  loadSubs();
});

/* ---------- discover / TMDB ---------- */
var modalItem = null;
var modalDetails = null;
function closeModal() { document.getElementById('modal-backdrop').hidden = true; }
document.getElementById('modal-backdrop').addEventListener('click', function (e) {
  if (e.target === this) closeModal();
});

async function openDetail(item) {
  modalItem = item;
  modalDetails = null;
  var box = document.getElementById('modal-content');
  box.innerHTML = '<p class="muted">加载详情中…</p>';
  document.getElementById('modal-backdrop').hidden = false;
  var r = await fetch('/api/tmdb/details?type=' + encodeURIComponent(item.media_type) + '&id=' + item.tmdb_id);
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) {
    box.innerHTML = '<p class="error-text">' + esc(data && data.error ? data.error.message : '读取 TMDB 详情失败') + '</p>'
      + '<div class="modal-actions"><button class="btn" onclick="closeModal()">关闭</button></div>';
    return;
  }
  var d = data.details;
  modalDetails = d;
  var poster = d.poster_path
    ? '<img src="' + posterUrl(d.poster_path, 'w342') + '" alt="">'
    : '<div class="poster-ph">' + esc((d.title || '?').slice(0, 1)) + '</div>';
  var seasonOptions = '';
  var seasons = (d.seasons || []).filter(function (s) { return s.season >= 1; });
  for (var i = 0; i < seasons.length; i++) {
    seasonOptions += '<option value="' + seasons[i].season + '" data-eps="' + seasons[i].episode_count + '">第 '
      + seasons[i].season + ' 季（' + seasons[i].episode_count + ' 集）</option>';
  }
  var seasonRow = d.media_type === 'tv'
    ? '<form class="inline"><label class="muted">订阅季</label><select id="m-season">' + seasonOptions + '</select>'
      + '<label class="muted">模式</label><select id="m-mode"><option value="manual">手动确认</option><option value="auto">自动转存</option></select></form>'
    : '<form class="inline"><label class="muted">模式</label><select id="m-mode"><option value="manual">手动确认</option><option value="auto">自动转存</option></select></form>';
  box.innerHTML = '<div class="modal-head">' + poster
    + '<div style="flex:1;min-width:0"><div style="font-size:1.15rem;font-weight:700">' + esc(d.title)
    + (d.year ? ' <span class="sub-year">' + d.year + '</span>' : '') + '</div>'
    + '<div class="tag-row"><span class="tag">' + (d.media_type === 'movie' ? '电影' : '电视剧') + '</span>'
    + (d.region ? '<span class="tag">' + esc(d.region) + '</span>' : '')
    + (d.rating ? '<span class="tag tag-rate">★ ' + Number(d.rating).toFixed(1) + '</span>' : '')
    + (d.genres && d.genres.length ? '<span class="tag">' + esc(d.genres.join(' / ')) + '</span>' : '') + '</div>'
    + seasonRow + '</div></div>'
    + (d.overview ? '<p class="overview">' + esc(d.overview) + '</p>' : '')
    + '<div class="modal-actions"><button class="btn" id="m-cancel">取消</button>'
    + '<button class="btn btn-primary" id="m-subscribe">订阅</button></div>';
  document.getElementById('m-cancel').addEventListener('click', closeModal);
  document.getElementById('m-subscribe').addEventListener('click', subscribeFromModal);
}

async function subscribeFromModal() {
  var d = modalDetails;
  if (!d) return;
  var payload = {
    title: d.title, original_title: d.original_title || undefined,
    year: d.year, tmdb_id: d.tmdb_id, media_type: d.media_type,
    region: d.region || undefined, mode: document.getElementById('m-mode').value,
    poster_path: d.poster_path || undefined, overview: d.overview || undefined,
    rating: typeof d.rating === 'number' ? d.rating : undefined
  };
  if (d.media_type === 'tv') {
    var sel = document.getElementById('m-season');
    if (sel) {
      payload.season = Number(sel.value);
      var opt = sel.options[sel.selectedIndex];
      var eps = opt ? Number(opt.getAttribute('data-eps')) : 0;
      if (eps) payload.total_episodes = eps;
    }
  }
  var r = await fetch('/api/subscriptions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) { alert(data && data.error ? data.error.message : '订阅失败'); return; }
  closeModal();
  await loadSubs();
  switchView('subscriptions');
}

document.getElementById('tmdb-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var q = document.getElementById('tmdb-q').value.trim();
  var box = document.getElementById('tmdb-results');
  var guide = document.getElementById('tmdb-guide');
  if (!q) return;
  guide.innerHTML = '';
  box.innerHTML = '<p class="muted">搜索中…</p>';
  var r = await fetch('/api/tmdb/search?q=' + encodeURIComponent(q));
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) {
    box.innerHTML = '';
    if (data && data.error && data.error.code === 'tmdb_not_configured') {
      guide.innerHTML = '<div class="card guide-card"><h3>TMDB 还没有配置</h3>'
        + '<p class="muted">选剧搜索需要先在「设置」页保存 TMDB API Key（themoviedb.org 免费申请）。配置好后回到这里搜索即可；也可以先用下方表单手动添加订阅。</p>'
        + '<button class="btn btn-primary" id="guide-go-settings">去设置页配置</button></div>';
      document.getElementById('guide-go-settings').addEventListener('click', function () { switchView('settings'); });
    } else {
      alert(data && data.error ? data.error.message : 'TMDB 搜索失败');
    }
    return;
  }
  var results = data.results || [];
  if (!results.length) { box.innerHTML = '<p class="muted">没有找到结果，可手动填写订阅。</p>'; return; }
  box.innerHTML = results.map(function (item, idx) {
    var poster = item.poster_path
      ? '<img src="' + posterUrl(item.poster_path, 'w342') + '" alt="" loading="lazy">'
      : '<div class="poster-ph">' + esc((item.title || '?').slice(0, 1)) + '</div>';
    return '<div class="tmdb-card" data-idx="' + idx + '">' + poster
      + '<div class="tmdb-info"><div class="t">' + esc(item.title) + '</div>'
      + '<div class="m">' + [item.year, item.media_type === 'movie' ? '电影' : '电视剧',
          item.rating ? '★ ' + Number(item.rating).toFixed(1) : '', item.region]
          .filter(Boolean).join(' · ') + '</div></div></div>';
  }).join('');
  var cards = box.querySelectorAll('.tmdb-card');
  for (var i = 0; i < cards.length; i++) {
    cards[i].addEventListener('click', function () {
      openDetail(results[Number(this.getAttribute('data-idx'))]);
    });
  }
});

document.getElementById('add-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var f = new FormData(e.target);
  var payload = {};
  f.forEach(function (v, k) { if (v !== '') payload[k] = v; });
  var numKeys = ['year', 'season', 'total_episodes'];
  for (var i = 0; i < numKeys.length; i++) {
    if (payload[numKeys[i]] != null) payload[numKeys[i]] = Number(payload[numKeys[i]]);
  }
  var r = await fetch('/api/subscriptions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) { alert(data && data.error ? data.error.message : '添加失败'); return; }
  e.target.reset();
  await loadSubs();
  switchView('subscriptions');
});

/* ---------- settings ---------- */
async function loadSettings() {
  var r = await api('/api/settings');
  var data = await r.json();
  var t = data.settings.tmdb_api_key;
  document.getElementById('tmdb-status').textContent =
    t.configured ? '已配置（' + t.masked + '）' : '未配置 — 选剧搜索不可用，仍可手动填写订阅';
  document.getElementById('interval').textContent = data.settings.check_interval_hours;
  var acc = data.settings.account;
  var uname = acc ? acc.username : '';
  document.getElementById('account-username').textContent = acc ? acc.username : '（未配置）';
  document.getElementById('account-source').textContent = acc ? (acc.source === 'settings' ? '后台已修改' : '部署初始值') : '—';
  document.getElementById('side-user').textContent = uname ? '当前账号：' + uname : '';
  document.getElementById('topbar-user').textContent = uname || '';
  renderCookieSettings(data.settings.quark_cookie);
  renderChannelSettings(data.settings.tg_channels);
  renderDirectorySettings(data.settings.directories, data.settings.directories_custom);
  loadDriverKeys();
}
function renderCookieSettings(c) {
  var st = document.getElementById('cookie-status');
  var drv = document.getElementById('cookie-driver-status');
  if (!c) { st.textContent = '—'; return; }
  if (!c.enc_configured) {
    st.innerHTML = '<span class="status-bad">功能未启用</span> — 服务端未配置 COOKIE_ENC_SECRET，无法加密保存（不会明文存储）。';
    drv.textContent = '';
    return;
  }
  if (!c.configured) {
    st.textContent = '未配置 — Driver 拿不到 Cookie，只能走浏览器登录态等其他方式。';
    drv.textContent = '';
    return;
  }
  st.innerHTML = '<span class="status-ok">已配置</span>'
    + (c.length ? '（长度 ' + c.length + ' 字符）' : '')
    + (c.updated_at ? '，更新于 ' + fmtTime(c.updated_at) : '');
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
  var lines = document.getElementById('channels-input').value.split(/[\\n,]+/);
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
  document.getElementById('channels-input').value = (t.effective || []).join('\\n');
  document.getElementById('channels-priority').checked = !!t.priority_only;
  countChannelsText();
  st.textContent = (t.custom ? '使用自定义清单（共 ' + t.base_count + ' 个）' : '使用默认清单（' + t.default_count + ' 个，2026-11-23 验证）')
    + '；当前生效 ' + t.count + ' 个'
    + (t.priority_only ? (t.priority_fallback ? '（优先开关已开，但与优先集无交集，已退回全量）' : '（仅夸克优先 ' + t.priority_count + ' 个）') : '');
}
/* ---------- settings: library directories ---------- */
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
    episode_name_template: document.getElementById('dir-episode-template').value.trim()
  };
}
function dirPreviewOf(d) {
  var title = String(d.title_template || '').split('{title}').join('谷雨').split('{year}').join('2026');
  var season = String(d.season_template || '').split('{season:02}').join('01').split('{season}').join('1');
  var ep = String(d.episode_name_template || '').split('{title}').join('谷雨')
    .split('{season:02}').join('01').split('{season}').join('1')
    .split('{episode:02}').join('01').split('{episode}').join('1');
  var region = (d.tv_region_map && (d.tv_region_map.CN || d.tv_region_map['*'])) || '';
  return [d.base_dir, d.tv_dir, region, title, season, ep + '.mkv'].filter(Boolean).join('/');
}
function updateDirPreview() {
  document.getElementById('directories-preview').textContent = dirPreviewOf(collectDirectories());
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
  st.textContent = custom ? '使用自定义设置' : '使用默认设置（按夸克实际结构预填）';
  updateDirPreview();
}
document.getElementById('directories-form').addEventListener('input', updateDirPreview);
document.getElementById('directories-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var msg = document.getElementById('directories-msg');
  var r = await fetch('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ directories: collectDirectories() })
  });
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) { msg.textContent = data && data.error ? data.error.message : '保存失败'; return; }
  msg.textContent = '已保存。Driver 下次取配置时生效。';
  loadSettings();
});
document.getElementById('directories-reset').addEventListener('click', async function () {
  if (!confirm('恢复为默认入库目录设置吗？自定义的路径与映射会被删除。')) return;
  var r = await fetch('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reset_directories: true })
  });
  if (!r.ok) { alert('恢复失败'); return; }
  document.getElementById('directories-msg').textContent = '已恢复默认目录设置。';
  loadSettings();
});

/* ---------- settings: Driver API keys ---------- */
function showOnceKey(token) {
  var box = document.getElementById('dk-once');
  document.getElementById('dk-once-value').value = token;
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest' });
}
document.getElementById('dk-copy').addEventListener('click', function () {
  var input = document.getElementById('dk-once-value');
  input.select();
  var done = function () { document.getElementById('dk-msg').textContent = '已复制到剪贴板。'; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value).then(done, function () {
      document.execCommand('copy'); done();
    });
  } else {
    document.execCommand('copy'); done();
  }
});
document.getElementById('dk-once-close').addEventListener('click', function () {
  document.getElementById('dk-once').hidden = true;
  document.getElementById('dk-once-value').value = '';
});
async function loadDriverKeys() {
  var st = document.getElementById('driver-keys-status');
  var box = document.getElementById('driver-keys-list');
  var r = await api('/api/settings/driver-keys');
  var data = await r.json().catch(function () { return null; });
  if (!r.ok || !data) { st.textContent = '加载失败'; return; }
  var keys = data.driver_keys || [];
  var active = keys.filter(function (k) { return !k.revoked_at; }).length;
  st.textContent = '共 ' + keys.length + ' 个（' + active + ' 个有效）'
    + (data.bootstrap_key && data.bootstrap_key.configured ? '，另有系统引导 Key（不在列表中）' : '');
  if (!keys.length) {
    box.innerHTML = '<p class="muted">还没有用页面创建的 Key。在下方输入名称新建一个给你的 Driver 用。</p>';
    return;
  }
  box.innerHTML = keys.map(function (k) {
    var isActive = !k.revoked_at;
    var actions = isActive
      ? '<button class="btn btn-ghost" data-dk-reset="' + k.id + '">重置</button>'
        + '<button class="btn btn-danger" data-dk-revoke="' + k.id + '">吊销</button>'
      : '';
    return '<div class="recent-row"><div class="recent-main">'
      + '<div class="recent-title">' + esc(k.name) + ' <span class="tag">' + esc(k.token_hint) + '</span></div>'
      + '<div class="recent-sub">创建于 ' + fmtTime(k.created_at)
      + ' · 最近使用：' + (k.last_used_at ? fmtTime(k.last_used_at) : '从未')
      + (k.revoked_at ? ' · 吊销于 ' + fmtTime(k.revoked_at) : '') + '</div></div>'
      + (isActive ? '<span class="badge b-done">有效</span>' : '<span class="badge b-paused">已吊销</span>')
      + actions + '</div>';
  }).join('');
}
document.getElementById('driver-keys-list').addEventListener('click', async function (e) {
  var resetBtn = e.target.closest('button[data-dk-reset]');
  var revokeBtn = e.target.closest('button[data-dk-revoke]');
  var msg = document.getElementById('dk-msg');
  if (resetBtn) {
    if (!confirm('确定重置这个 Key 吗？旧 Key 立即作废，使用它的 Driver 必须换上新 Key 才能继续工作。')) return;
    var rr = await fetch('/api/settings/driver-keys/' + resetBtn.getAttribute('data-dk-reset') + '/reset', { method: 'POST' });
    var rd = await rr.json().catch(function () { return null; });
    if (!rr.ok) { msg.textContent = rd && rd.error ? rd.error.message : '重置失败'; return; }
    msg.textContent = '已重置：旧 Key 已吊销，新 Key 见上方（只显示一次）。';
    showOnceKey(rd.key);
    loadDriverKeys();
    return;
  }
  if (revokeBtn) {
    if (!confirm('确定吊销这个 Key 吗？使用它的 Driver 将立刻无法访问，此操作不可恢复（只能新建）。')) return;
    var vr = await fetch('/api/settings/driver-keys/' + revokeBtn.getAttribute('data-dk-revoke') + '/revoke', { method: 'POST' });
    var vd = await vr.json().catch(function () { return null; });
    if (!vr.ok) { msg.textContent = vd && vd.error ? vd.error.message : '吊销失败'; return; }
    msg.textContent = '已吊销。';
    loadDriverKeys();
  }
});
document.getElementById('dk-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var msg = document.getElementById('dk-msg');
  var name = document.getElementById('dk-name').value.trim();
  if (!name) { msg.textContent = '请先填写 Driver 名称'; return; }
  var r = await fetch('/api/settings/driver-keys', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name })
  });
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) { msg.textContent = data && data.error ? data.error.message : '创建失败'; return; }
  document.getElementById('dk-name').value = '';
  msg.textContent = '已创建：把上方 Key 配置到 Driver 里（只显示一次）。';
  showOnceKey(data.key);
  loadDriverKeys();
});
document.getElementById('account-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var msg = document.getElementById('account-msg');
  var current = document.getElementById('acc-current').value;
  var username = document.getElementById('acc-username').value.trim();
  var pw1 = document.getElementById('acc-password').value;
  var pw2 = document.getElementById('acc-password2').value;
  if (!current) { msg.textContent = '请先输入当前密码'; return; }
  if (!username && !pw1) { msg.textContent = '新用户名和新密码至少填一个'; return; }
  if (pw1 !== pw2) { msg.textContent = '两次输入的新密码不一致'; return; }
  var payload = { current_password: current };
  if (username) payload.new_username = username;
  if (pw1) payload.new_password = pw1;
  var r = await fetch('/api/account', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) { msg.textContent = data && data.error ? data.error.message : '保存失败'; return; }
  msg.textContent = '已保存：' + data.note;
  e.target.reset();
  loadSettings();
});
document.getElementById('tmdb-key-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var key = document.getElementById('tmdb-key').value.trim();
  if (!key) { alert('请输入 TMDB API Key'); return; }
  var r = await fetch('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tmdb_api_key: key })
  });
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) { alert(data && data.error ? data.error.message : '保存失败'); return; }
  document.getElementById('tmdb-key').value = '';
  loadSettings();
});
document.getElementById('tmdb-clear').addEventListener('click', async function () {
  var r = await fetch('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clear_tmdb_api_key: true })
  });
  if (!r.ok) { alert('清除失败'); return; }
  loadSettings();
});
document.getElementById('cookie-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var msg = document.getElementById('cookie-msg');
  var v = document.getElementById('cookie-input').value.trim();
  if (!v) { msg.textContent = '请先粘贴 Cookie'; return; }
  var r = await fetch('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quark_cookie: v })
  });
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) { msg.textContent = data && data.error ? data.error.message : '保存失败'; return; }
  document.getElementById('cookie-input').value = '';
  msg.textContent = '已加密保存。Driver 下次取配置时生效。';
  loadSettings();
});
document.getElementById('cookie-clear').addEventListener('click', async function () {
  if (!confirm('确定清除已保存的夸克 Cookie 吗？Driver 将无法再取到它。')) return;
  var r = await fetch('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clear_quark_cookie: true })
  });
  if (!r.ok) { alert('清除失败'); return; }
  document.getElementById('cookie-msg').textContent = '已清除。';
  loadSettings();
});
document.getElementById('channels-input').addEventListener('input', countChannelsText);
document.getElementById('channels-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var msg = document.getElementById('channels-msg');
  var names = document.getElementById('channels-input').value.split(/[\\n,]+/)
    .map(function (s) { return s.trim().replace(/^@+/, ''); }).filter(Boolean);
  var payload = {
    tg_channels: names,
    tg_channels_priority_only: document.getElementById('channels-priority').checked
  };
  var r = await fetch('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  var data = await r.json().catch(function () { return null; });
  if (!r.ok) { msg.textContent = data && data.error ? data.error.message : '保存失败'; return; }
  msg.textContent = '已保存。Driver 下次取配置时生效。';
  loadSettings();
});
document.getElementById('channels-reset').addEventListener('click', async function () {
  if (!confirm('恢复为内置默认清单（147 个已验证频道）吗？自定义清单会被删除。')) return;
  var r = await fetch('/api/settings', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reset_tg_channels: true })
  });
  if (!r.ok) { alert('恢复失败'); return; }
  document.getElementById('channels-msg').textContent = '已恢复默认清单。';
  loadSettings();
});

/* ---------- init ---------- */
var initial = document.body.getAttribute('data-initial-view') || 'dashboard';
if (location.hash) {
  var h = location.hash.slice(1);
  if (VIEWS.indexOf(h) >= 0) initial = h;
}
switchView(initial);
loadSettings();
loadSubs();
</script>
</body>
</html>`;
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
