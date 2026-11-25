/**
 * PanPilot — subscription control plane (Cloudflare Workers)
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
 * No cloud-drive cookies are ever stored here (see DESIGN.md §9).
 */

export interface Env {
  DB?: D1Database;
  /** Driver Bearer token — set via `wrangler secret put DRIVER_TOKEN`. */
  DRIVER_TOKEN?: string;
  /** Web login username — set via `wrangler secret put APP_USERNAME`. */
  APP_USERNAME?: string;
  /** Web login password — set via `wrangler secret put APP_PASSWORD`. */
  APP_PASSWORD?: string;
  /** Optional dedicated session-signing secret; falls back to APP_PASSWORD. */
  SESSION_SECRET?: string;
  /** Hours between Driver rounds (default 6). */
  CHECK_INTERVAL_HOURS?: string;
}

const VERSION = "0.3.0";
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

async function driverAuth(req: Request, env: Env): Promise<Response | null> {
  if (!env.DRIVER_TOKEN) {
    return err("driver_auth_not_configured", "DRIVER_TOKEN secret is not set on this Worker", 503);
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !(await safeEqual(token, env.DRIVER_TOKEN))) {
    return err("unauthorized", "invalid driver token", 401);
  }
  return null;
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
  addLog(entry: { subscription_id?: string; driver_id?: string; level: string; event: string; detail?: string }): Promise<void>;
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
  async addLog(entry: { subscription_id?: string; driver_id?: string; level: string; event: string; detail?: string }) {
    this.logs.push({ ...entry, created_at: now() });
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

const SUB_COLUMNS = [
  "id", "title", "original_title", "year", "tmdb_id", "media_type", "region",
  "season", "total_episodes", "quality_pref", "mode", "status", "target_dir",
  "next_check_at", "last_checked_at", "last_error", "created_at", "updated_at",
] as const;

function subValues(s: Subscription): unknown[] {
  return [
    s.id, s.title, s.original_title ?? null, s.year ?? null, s.tmdb_id ?? null,
    s.media_type, s.region ?? null, s.season ?? null, s.total_episodes ?? null,
    s.quality_pref ?? null, s.mode, s.status, s.target_dir ?? null,
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

  async addLog(entry: { subscription_id?: string; driver_id?: string; level: string; event: string; detail?: string }): Promise<void> {
    await this.db
      .prepare("INSERT INTO logs (id, subscription_id, driver_id, level, event, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(uid(), entry.subscription_id ?? null, entry.driver_id ?? null, entry.level, entry.event, entry.detail ?? null, now())
      .run();
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
  const { status, mode, quality_pref, region, season, total_episodes, target_dir, next_check_at, tmdb_id, year } = patch;
  const clean: Partial<Subscription> = { status, mode, quality_pref, region, season, total_episodes, target_dir, next_check_at, tmdb_id, year };
  for (const k of Object.keys(clean) as (keyof typeof clean)[]) if (clean[k] === undefined) delete clean[k];
  const sub = await store.updateSubscription(id, clean);
  return sub ? json({ subscription: sub }) : err("not_found", "subscription not found", 404);
}

async function handleDeleteSub(store: Store, id: string): Promise<Response> {
  return (await store.deleteSubscription(id))
    ? json({ deleted: true })
    : err("not_found", "subscription not found", 404);
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
  return json({
    settings: {
      tmdb_api_key: { configured: !!key, masked: key ? maskKey(key) : null },
      check_interval_hours: checkIntervalSeconds(env) / 3600,
      account: auth ? { username: auth.username, source: auth.source } : null,
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
  const input = await body<{ tmdb_api_key?: string; clear_tmdb_api_key?: boolean }>(req);
  if (!input) return err("bad_request", "invalid JSON body", 400);
  if (input.clear_tmdb_api_key) {
    await store.deleteSetting(SETTING_TMDB_API_KEY);
  } else if (typeof input.tmdb_api_key === "string") {
    const key = input.tmdb_api_key.trim();
    if (!key) return err("bad_request", "tmdb_api_key must not be empty (use clear_tmdb_api_key to remove)", 400);
    await store.setSetting(SETTING_TMDB_API_KEY, JSON.stringify(key));
  } else {
    return err("bad_request", "nothing to update: provide tmdb_api_key or clear_tmdb_api_key", 400);
  }
  return handleGetSettings(store, env);
}

// ---------------------------------------------------------------------------
// TMDB (web API) — MoviePilot-style: subscriptions bind to a TMDB id
// ---------------------------------------------------------------------------

/** Map TMDB origin country to the user's library region categories (DESIGN.md §3). */
function mapRegion(country: string | undefined, mediaType: MediaType): string {
  const c = (country ?? "").toUpperCase();
  if (mediaType === "movie") {
    switch (c) {
      case "CN": return "国产电影";
      case "HK": case "TW": return "港台电影";
      case "JP": return "日本电影";
      case "KR": return "韩国电影";
      default: return "欧美电影";
    }
  }
  switch (c) {
    case "CN": return "国产剧";
    case "HK": case "TW": return "港台剧";
    case "JP": return "日剧";
    case "KR": return "韩剧";
    default: return "欧美剧";
  }
}

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
  const results = ((data as { results?: unknown[] }).results ?? [])
    .filter((r): r is Row => typeof r === "object" && r !== null && (r as Row).media_type !== "person"
      && ((r as Row).media_type === "tv" || (r as Row).media_type === "movie"))
    .map((r) => {
      const mediaType = String(r.media_type) as MediaType;
      const dateStr = String((mediaType === "tv" ? r.first_air_date : r.release_date) ?? "");
      const countries = Array.isArray(r.origin_country) ? (r.origin_country as unknown[]).map(String) : [];
      return {
        tmdb_id: Number(r.id),
        media_type: mediaType,
        title: String((mediaType === "tv" ? r.name : r.title) ?? ""),
        original_title: String((mediaType === "tv" ? r.original_name : r.original_title) ?? ""),
        year: dateStr ? Number(dateStr.slice(0, 4)) : undefined,
        origin_country: countries,
        region: mapRegion(countries[0], mediaType),
        poster_url: tmdbPoster(r.poster_path),
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
  const genres = Array.isArray(r.genres)
    ? (r.genres as Row[]).map((g) => String(g.name)).filter(Boolean)
    : [];
  const base = {
    tmdb_id: Number(r.id),
    media_type: type as MediaType,
    title: String((type === "tv" ? r.name : r.title) ?? ""),
    original_title: String((type === "tv" ? r.original_name : r.original_title) ?? ""),
    year: dateStr ? Number(dateStr.slice(0, 4)) : undefined,
    origin_country: countries,
    region: mapRegion(countries[0], type as MediaType),
    genres,
    poster_url: tmdbPoster(r.poster_path),
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
// Pages
// ---------------------------------------------------------------------------

const PAGE_CSS = `
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 920px; padding: 0 1rem; }
  nav { display: flex; gap: 1rem; align-items: baseline; margin-bottom: 1rem; }
  nav h1 { font-size: 1.3rem; margin: 0; margin-right: auto; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #ddd; padding: .45rem .6rem; text-align: left; font-size: .92rem; }
  form.inline { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; }
  input, select, button { padding: .45rem .6rem; font-size: .95rem; }
  .muted { color: #666; font-size: .88rem; }
  .error { color: #b00020; }
  .tmdb-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .8rem; margin-top: 1rem; }
  .tmdb-card { border: 1px solid #ddd; border-radius: 8px; padding: .5rem; cursor: pointer; }
  .tmdb-card:hover { border-color: #888; }
  .tmdb-card img { width: 100%; border-radius: 4px; }
  .tmdb-card .t { font-weight: 600; font-size: .92rem; margin-top: .4rem; }
  section { margin-top: 2rem; }
`;

function LOGIN_HTML(failed: boolean): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PanPilot 登录</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<h1>PanPilot 登录</h1>
${failed ? '<p class="error">用户名或密码不正确，请重试。</p>' : ""}
<form method="post" action="/login" class="inline">
  <input name="username" placeholder="用户名" autocomplete="username" required>
  <input name="password" type="password" placeholder="密码" autocomplete="current-password" required>
  <button type="submit">登录</button>
</form>
<p class="muted">订阅控制面。搜索与转存由外部 Driver 执行，本站不保存任何网盘 Cookie。</p>
</body>
</html>`;
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PanPilot 订阅</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<nav>
  <h1>PanPilot 订阅</h1>
  <a href="/">订阅</a>
  <a href="/settings">设置</a>
  <form method="post" action="/logout" style="display:inline"><button type="submit">退出登录</button></form>
</nav>
<p class="muted">订阅控制面。搜索与转存由外部 Driver 每 6 小时一轮执行；本页只管理订阅与进度。订阅绑定 TMDB ID（参考 MoviePilot），后续按季追踪。</p>

<section>
  <h2>从 TMDB 选剧</h2>
  <form class="inline" id="tmdb-form">
    <input id="tmdb-q" placeholder="输入剧名，如 谷雨" style="min-width:220px">
    <button type="submit">搜索 TMDB</button>
  </form>
  <p class="muted">需要在「设置」页先配置 TMDB API Key；未配置时可直接用下方表单手动填写订阅。综艺在 TMDB 中属于 tv 类型，选中后可在表单里把类型改成「综艺」。</p>
  <div id="tmdb-results" class="tmdb-results"></div>
</section>

<section>
  <h2>添加订阅</h2>
  <form id="add-form" class="inline">
    <input name="title" id="f-title" placeholder="剧名 *" required>
    <input name="year" id="f-year" type="number" placeholder="年份" min="1900" max="2100">
    <select name="media_type" id="f-media_type">
      <option value="tv">电视剧</option>
      <option value="movie">电影</option>
      <option value="variety">综艺</option>
    </select>
    <input name="region" id="f-region" placeholder="地区，如 国产剧">
    <input name="season" id="f-season" type="number" placeholder="季" min="0">
    <select id="tmdb-season" style="display:none"></select>
    <input name="total_episodes" id="f-total_episodes" type="number" placeholder="总集数" min="1">
    <select name="mode">
      <option value="manual">手动确认</option>
      <option value="auto">自动转存</option>
    </select>
    <input type="hidden" name="tmdb_id" id="f-tmdb_id">
    <input type="hidden" name="original_title" id="f-original_title">
    <button type="submit">添加订阅</button>
  </form>
  <p class="muted" id="tmdb-picked"></p>
</section>

<section>
  <h2>我的订阅</h2>
  <table>
    <thead><tr><th>剧名</th><th>年份</th><th>类型/地区</th><th>季</th><th>总集数</th><th>模式</th><th>状态</th><th>下次检查</th><th></th></tr></thead>
    <tbody id="rows"><tr><td colspan="9" class="muted">加载中…</td></tr></tbody>
  </table>
</section>

<script>
const rows = document.getElementById('rows');
function fmtTime(sec) {
  if (!sec) return '';
  return new Date(sec * 1000).toLocaleString();
}
async function load() {
  const r = await fetch('/api/subscriptions');
  if (r.status === 401) { location.href = '/login'; return; }
  const data = await r.json();
  const subs = data.subscriptions || [];
  rows.innerHTML = subs.length ? '' : '<tr><td colspan="9" class="muted">暂无订阅</td></tr>';
  for (const s of subs) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td><button>删除</button></td>';
    tr.children[0].textContent = s.title + (s.tmdb_id ? ' (TMDB ' + s.tmdb_id + ')' : '');
    tr.children[1].textContent = s.year != null ? s.year : '';
    tr.children[2].textContent = [s.media_type, s.region].filter(Boolean).join(' / ');
    tr.children[3].textContent = s.season != null ? s.season : '';
    tr.children[4].textContent = s.total_episodes != null ? s.total_episodes : '';
    tr.children[5].textContent = s.mode;
    tr.children[6].textContent = s.status;
    tr.children[7].textContent = fmtTime(s.next_check_at);
    tr.querySelector('button').onclick = async () => {
      await fetch('/api/subscriptions/' + s.id, { method: 'DELETE' });
      load();
    };
    rows.appendChild(tr);
  }
}

let pickedSeasons = [];
const seasonSelect = document.getElementById('tmdb-season');
seasonSelect.addEventListener('change', () => {
  const s = pickedSeasons.find((x) => String(x.season) === seasonSelect.value);
  if (s) {
    document.getElementById('f-season').value = s.season;
    document.getElementById('f-total_episodes').value = s.episode_count || '';
  }
});

async function pickTmdb(item) {
  const r = await fetch('/api/tmdb/details?type=' + encodeURIComponent(item.media_type) + '&id=' + item.tmdb_id);
  const data = await r.json();
  if (!r.ok) { alert(data.error ? data.error.message : '读取 TMDB 详情失败'); return; }
  const d = data.details;
  document.getElementById('f-title').value = d.title || '';
  document.getElementById('f-year').value = d.year != null ? d.year : '';
  document.getElementById('f-media_type').value = d.media_type === 'movie' ? 'movie' : 'tv';
  document.getElementById('f-region').value = d.region || '';
  document.getElementById('f-tmdb_id').value = d.tmdb_id;
  document.getElementById('f-original_title').value = d.original_title || '';
  pickedSeasons = d.seasons || [];
  if (pickedSeasons.length) {
    seasonSelect.innerHTML = '';
    for (const s of pickedSeasons) {
      const opt = document.createElement('option');
      opt.value = s.season;
      opt.textContent = '第 ' + s.season + ' 季（' + s.episode_count + ' 集）';
      seasonSelect.appendChild(opt);
    }
    const regular = pickedSeasons.filter((x) => x.season >= 1);
    const chosen = regular.length ? regular[regular.length - 1] : pickedSeasons[pickedSeasons.length - 1];
    seasonSelect.value = String(chosen.season);
    seasonSelect.style.display = '';
    document.getElementById('f-season').value = chosen.season;
    document.getElementById('f-total_episodes').value = chosen.episode_count || '';
  } else {
    seasonSelect.style.display = 'none';
    document.getElementById('f-season').value = '';
    document.getElementById('f-total_episodes').value = '';
  }
  document.getElementById('tmdb-picked').textContent =
    '已从 TMDB 回填：' + d.title + (d.year ? '（' + d.year + '）' : '') + ' · ' + (d.region || '') +
    (d.genres && d.genres.length ? ' · ' + d.genres.join(' / ') : '') + '。核对后点「添加订阅」。';
  document.getElementById('add-form').scrollIntoView({ behavior: 'smooth' });
}

document.getElementById('tmdb-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = document.getElementById('tmdb-q').value.trim();
  const box = document.getElementById('tmdb-results');
  if (!q) return;
  box.innerHTML = '<p class="muted">搜索中…</p>';
  const r = await fetch('/api/tmdb/search?q=' + encodeURIComponent(q));
  const data = await r.json();
  if (!r.ok) {
    box.innerHTML = '';
    alert(data.error ? data.error.message : 'TMDB 搜索失败');
    return;
  }
  box.innerHTML = '';
  if (!data.results.length) box.innerHTML = '<p class="muted">没有找到结果，可手动填写订阅。</p>';
  for (const item of data.results) {
    const card = document.createElement('div');
    card.className = 'tmdb-card';
    if (item.poster_url) {
      const img = document.createElement('img');
      img.src = item.poster_url;
      img.alt = item.title;
      card.appendChild(img);
    }
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = item.title;
    card.appendChild(t);
    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = [item.year, item.media_type === 'movie' ? '电影' : '电视剧',
      (item.origin_country || []).join('/'), item.region].filter(Boolean).join(' · ');
    card.appendChild(meta);
    card.onclick = () => pickTmdb(item);
    box.appendChild(card);
  }
});

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = Object.fromEntries(f.entries());
  for (const k of ['year', 'season', 'total_episodes', 'tmdb_id']) {
    if (payload[k] === '' || payload[k] == null) delete payload[k];
    else payload[k] = Number(payload[k]);
  }
  if (!payload.region) delete payload.region;
  if (!payload.original_title) delete payload.original_title;
  const r = await fetch('/api/subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    alert(data && data.error ? data.error.message : '添加失败');
    return;
  }
  e.target.reset();
  document.getElementById('tmdb-picked').textContent = '';
  seasonSelect.style.display = 'none';
  load();
});
load();
</script>
</body>
</html>`;

const SETTINGS_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PanPilot 设置</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<nav>
  <h1>PanPilot 设置</h1>
  <a href="/">订阅</a>
  <a href="/settings">设置</a>
  <form method="post" action="/logout" style="display:inline"><button type="submit">退出登录</button></form>
</nav>

<section>
  <h2>TMDB</h2>
  <p class="muted">TMDB API Key 保存在服务端设置中（页面只显示末 4 位掩码），用于订阅页的选剧搜索与元数据回填。Key 在 themoviedb.org 免费申请。</p>
  <p>当前状态：<span id="tmdb-status">加载中…</span></p>
  <form id="tmdb-form" class="inline">
    <input id="tmdb-key" placeholder="输入新的 TMDB API Key" style="min-width:320px" autocomplete="off">
    <button type="submit">保存</button>
    <button type="button" id="tmdb-clear">清除</button>
  </form>
</section>

<section>
  <h2>登录账号</h2>
  <p class="muted">当前登录用户名：<span id="account-username">…</span>（来源：<span id="account-source">…</span>）。初始账号密码来自部署时的 Secrets，在这里修改后以新账号为准（密码只存哈希）。修改须验证当前密码；保存后其他设备上的旧登录会失效，本浏览器会自动续上新登录。</p>
  <form id="account-form" class="inline">
    <input id="acc-current" type="password" placeholder="当前密码 *" autocomplete="current-password" required>
    <input id="acc-username" placeholder="新用户名（不改可留空）" autocomplete="username">
    <input id="acc-password" type="password" placeholder="新密码（不改可留空）" autocomplete="new-password">
    <input id="acc-password2" type="password" placeholder="再输一次新密码" autocomplete="new-password">
    <button type="submit">保存新账号</button>
  </form>
  <p id="account-msg" class="muted"></p>
</section>

<section>
  <h2>Driver</h2>
  <p class="muted">Driver 检查间隔：<span id="interval">…</span> 小时一轮（由 Worker 环境变量 CHECK_INTERVAL_HOURS 控制，默认 6）。Driver API 使用独立 Bearer Token，与网页登录互不影响。</p>
</section>

<script>
async function loadSettings() {
  const r = await fetch('/api/settings');
  if (r.status === 401) { location.href = '/login'; return; }
  const data = await r.json();
  const t = data.settings.tmdb_api_key;
  document.getElementById('tmdb-status').textContent =
    t.configured ? '已配置（' + t.masked + '）' : '未配置 — 选剧搜索不可用，仍可手动填写订阅';
  document.getElementById('interval').textContent = data.settings.check_interval_hours;
  const acc = data.settings.account;
  document.getElementById('account-username').textContent = acc ? acc.username : '（未配置）';
  document.getElementById('account-source').textContent = acc ? (acc.source === 'settings' ? '后台已修改' : '部署初始值') : '—';
}
document.getElementById('account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('account-msg');
  const current = document.getElementById('acc-current').value;
  const username = document.getElementById('acc-username').value.trim();
  const pw1 = document.getElementById('acc-password').value;
  const pw2 = document.getElementById('acc-password2').value;
  if (!current) { msg.textContent = '请先输入当前密码'; return; }
  if (!username && !pw1) { msg.textContent = '新用户名和新密码至少填一个'; return; }
  if (pw1 !== pw2) { msg.textContent = '两次输入的新密码不一致'; return; }
  const payload = { current_password: current };
  if (username) payload.new_username = username;
  if (pw1) payload.new_password = pw1;
  const r = await fetch('/api/account', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) { msg.textContent = data && data.error ? data.error.message : '保存失败'; return; }
  msg.textContent = '已保存：' + data.note;
  e.target.reset();
  loadSettings();
});
document.getElementById('tmdb-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = document.getElementById('tmdb-key').value.trim();
  if (!key) { alert('请输入 TMDB API Key'); return; }
  const r = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tmdb_api_key: key }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) { alert(data && data.error ? data.error.message : '保存失败'); return; }
  document.getElementById('tmdb-key').value = '';
  loadSettings();
});
document.getElementById('tmdb-clear').addEventListener('click', async () => {
  const r = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clear_tmdb_api_key: true }),
  });
  if (!r.ok) { alert('清除失败'); return; }
  loadSettings();
});
loadSettings();
</script>
</body>
</html>`;

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
        return json({
          ok: true,
          version: VERSION,
          store: store.kind,
          web_auth: (await getEffectiveAuth(env, store)) ? "password" : "disabled",
          driver_auth: env.DRIVER_TOKEN ? "configured" : "not_configured",
          time: now(),
        });
      }
      if (pathname === "/login") return handleLogin(req, env, url, store);
      if (pathname === "/logout" && req.method === "POST") return handleLogout();

      // Driver API — independent Bearer token, unaffected by web login.
      if (pathname.startsWith("/api/driver/")) {
        const denied = await driverAuth(req, env);
        if (denied) return denied;
        if (pathname === "/api/driver/pending" && req.method === "GET") return handleDriverPending(url, store);
        if (pathname === "/api/driver/claim" && req.method === "POST") return handleDriverClaim(req, store);
        if (pathname === "/api/driver/candidates" && req.method === "POST") return handleDriverCandidates(req, store);
        if (pathname === "/api/driver/progress" && req.method === "POST") return handleDriverProgress(req, store, env);
        if (pathname === "/api/driver/heartbeat" && req.method === "POST") return handleDriverHeartbeat(req, store);
        if (pathname === "/api/driver/logs" && req.method === "POST") return handleDriverLogs(req, store);
        return err("not_found", "unknown driver endpoint", 404);
      }

      // Everything below requires web login (when configured).
      const denied = await webAuth(req, env, url, store);
      if (denied) return denied;

      if (pathname === "/" || pathname === "/index.html") {
        return new Response(PAGE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (pathname === "/settings") {
        return new Response(SETTINGS_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
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
