/**
 * PanPilot WeCom (Enterprise WeChat / 企业微信自建应用) protocol & API module.
 *
 * Pure Web Crypto implementation for Cloudflare Workers:
 * - Callback SHA-1 signature verification (`msg_signature`)
 * - AES-256-CBC encryption & decryption with 32-byte PKCS#7 padding
 * - XML tag extraction (CDATA / plain text)
 * - Access token caching in settings store
 * - Custom menu sync, text/news messaging, and OAuth2 user lookup
 *   routed through an optional fixed-IP proxy (default https://qywx.ttai.net).
 */

export interface WecomStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  deleteSetting(key: string): Promise<void>;
}

export const DEFAULT_WECOM_PROXY = "https://qywx.ttai.net";
export const WECOM_UPSTREAM = "https://qyapi.weixin.qq.com";

export interface WecomPublicConfig {
  enabled: boolean;
  corp_id: string;
  agent_id: number | null;
  proxy_url: string;
  allowed_users: string[];
  notify_enabled: boolean;
  oauth_enabled: boolean;
  verify_file_name?: string;
  verify_file_content?: string;
}

export interface WecomSecrets {
  secret?: string;
  token?: string;
  encoding_aes_key?: string;
}

export interface WecomNewsArticle {
  title: string;
  description?: string;
  url: string;
  picurl?: string;
}

export const DEFAULT_WECOM_CONFIG: WecomPublicConfig = {
  enabled: false,
  corp_id: "",
  agent_id: null,
  proxy_url: DEFAULT_WECOM_PROXY,
  allowed_users: [],
  notify_enabled: true,
  oauth_enabled: true,
  verify_file_name: "",
  verify_file_content: "",
};

export function maskSecret(s: string | undefined): string | null {
  if (!s) return null;
  if (s.length <= 4) return "••••";
  return `••••${s.slice(-4)}`;
}

export function normalizeProxyUrl(raw: unknown): { value?: string; error?: string } {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { value: DEFAULT_WECOM_PROXY };
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return { error: "API 代理地址必须以 https:// 或 http:// 开头" };
    }
    return { value: `${u.origin}${u.pathname}`.replace(/\/+$/, "") };
  } catch {
    return { error: "API 代理地址格式不合法" };
  }
}

export function normalizeAllowedUsers(raw: unknown): string[] {
  const items: string[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) if (typeof v === "string") items.push(v);
  } else if (typeof raw === "string") {
    items.push(...raw.split(/[\n,|,\s]+/));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const u = item.trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

export function normalizeVerifyFileName(raw: unknown): { value?: string; error?: string } {
  const s = typeof raw === "string" ? raw.trim().replace(/^\/+/, "") : "";
  if (!s) return { value: "" };
  if (!/^WW_verify_[A-Za-z0-9._-]{4,80}\.txt$/.test(s)) {
    return { error: "校验文件名必须符合 WW_verify_xxx.txt 格式" };
  }
  return { value: s };
}

export function resolveWecomConfig(rawJson: string | null): WecomPublicConfig {
  if (!rawJson) return { ...DEFAULT_WECOM_CONFIG };
  try {
    const parsed = JSON.parse(rawJson) as Partial<WecomPublicConfig>;
    const proxy = normalizeProxyUrl(parsed.proxy_url).value ?? DEFAULT_WECOM_PROXY;
    const agent = typeof parsed.agent_id === "number" && Number.isInteger(parsed.agent_id) && parsed.agent_id > 0
      ? parsed.agent_id
      : null;
    const vname = normalizeVerifyFileName(parsed.verify_file_name).value ?? "";
    return {
      enabled: parsed.enabled === true,
      corp_id: typeof parsed.corp_id === "string" ? parsed.corp_id.trim() : "",
      agent_id: agent,
      proxy_url: proxy,
      allowed_users: normalizeAllowedUsers(parsed.allowed_users),
      notify_enabled: parsed.notify_enabled !== false,
      oauth_enabled: parsed.oauth_enabled !== false,
      verify_file_name: vname,
      verify_file_content: typeof parsed.verify_file_content === "string" ? parsed.verify_file_content.trim() : "",
    };
  } catch {
    return { ...DEFAULT_WECOM_CONFIG };
  }
}

export function validateWecomConfig(raw: unknown): { value?: WecomPublicConfig; error?: string } {
  if (!raw || typeof raw !== "object") return { error: "wecom config must be an object" };
  const r = raw as Record<string, unknown>;
  const corpId = typeof r.corp_id === "string" ? r.corp_id.trim() : "";
  if (corpId && !/^[A-Za-z0-9_-]{4,64}$/.test(corpId)) {
    return { error: "CorpID 格式不正确" };
  }
  let agentId: number | null = null;
  if (r.agent_id !== undefined && r.agent_id !== null && r.agent_id !== "") {
    const n = Number(r.agent_id);
    if (!Number.isInteger(n) || n <= 0) return { error: "AgentID 必须为正整数" };
    agentId = n;
  }
  const proxy = normalizeProxyUrl(r.proxy_url);
  if (proxy.error) return { error: proxy.error };
  const vname = normalizeVerifyFileName(r.verify_file_name);
  if (vname.error) return { error: vname.error };
  const vcontent = typeof r.verify_file_content === "string" ? r.verify_file_content.trim() : "";
  if (vcontent.length > 512) return { error: "校验文件内容过长" };

  return {
    value: {
      enabled: r.enabled === true,
      corp_id: corpId,
      agent_id: agentId,
      proxy_url: proxy.value ?? DEFAULT_WECOM_PROXY,
      allowed_users: normalizeAllowedUsers(r.allowed_users),
      notify_enabled: r.notify_enabled !== false,
      oauth_enabled: r.oauth_enabled !== false,
      verify_file_name: vname.value ?? "",
      verify_file_content: vcontent,
    },
  };
}

// ---------------------------------------------------------------------------
// WeCom Cryptographic Protocol (SHA-1 signature + AES-256-CBC, 32-byte PKCS#7)
// ---------------------------------------------------------------------------

function b64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64Encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function decodeAesKey(encodingAesKey: string): Uint8Array {
  const clean = encodingAesKey.trim();
  if (!/^[A-Za-z0-9+/]{43}$/.test(clean)) {
    throw new Error("EncodingAESKey 格式错误：应为 43 位 Base64 字符");
  }
  const key = b64Decode(`${clean}=`);
  if (key.length !== 32) throw new Error("EncodingAESKey 解码长度不是 32 字节");
  return key;
}

export async function wecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): Promise<string> {
  const joined = [token, timestamp, nonce, encrypt].sort().join("");
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(joined));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyWecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  expectedSig: string,
): Promise<boolean> {
  if (!token || !timestamp || !nonce || !encrypt || !expectedSig) return false;
  const sig = await wecomSignature(token, timestamp, nonce, encrypt);
  if (sig.length !== expectedSig.length) return false;
  let diff = 0;
  const a = sig.toLowerCase();
  const b = expectedSig.toLowerCase();
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Decrypt a WeCom base64 ciphertext.
 * Web Crypto's AES-CBC only accepts 16-byte PKCS#7 padding (1..16), whereas WeCom
 * uses 32-byte blocks (padding 1..32). We append a synthetic 16-byte block encrypted
 * from empty plaintext with iv = last 16 bytes of ciphertext so Web Crypto strips
 * only that synthetic block and returns the exact WeCom-padded plaintext.
 */
export async function wecomDecrypt(
  encodingAesKey: string,
  encryptBase64: string,
  expectedCorpId?: string,
): Promise<{ message: string; receiveId: string }> {
  const keyBytes = decodeAesKey(encodingAesKey);
  const iv = keyBytes.slice(0, 16);
  const cipher = b64Decode(encryptBase64.trim());
  if (cipher.length < 32 || cipher.length % 16 !== 0) {
    throw new Error("密文长度不合法");
  }

  const key = await crypto.subtle.importKey(
    "raw", keyBytes as BufferSource, { name: "AES-CBC" }, false, ["encrypt", "decrypt"],
  );

  const lastBlock = cipher.slice(cipher.length - 16);
  const tailEnc = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv: lastBlock as BufferSource }, key, new Uint8Array(0)),
  );
  const combined = new Uint8Array(cipher.length + tailEnc.length);
  combined.set(cipher, 0);
  combined.set(tailEnc, cipher.length);

  const paddedBuf = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: iv as BufferSource }, key, combined as BufferSource,
  );
  const padded = new Uint8Array(paddedBuf);
  if (padded.length < 21) throw new Error("解密后长度过短");

  const pad = padded[padded.length - 1];
  if (pad < 1 || pad > 32 || pad > padded.length) {
    throw new Error("无效的 PKCS#7 填充");
  }
  for (let i = padded.length - pad; i < padded.length; i++) {
    if (padded[i] !== pad) throw new Error("PKCS#7 填充校验失败");
  }

  const raw = padded.slice(0, padded.length - pad);
  if (raw.length < 20) throw new Error("明文载荷过短");
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const msgLen = view.getUint32(16, false);
  if (20 + msgLen > raw.length) throw new Error("消息体长度越界");

  const dec = new TextDecoder();
  const message = dec.decode(raw.slice(20, 20 + msgLen));
  const receiveId = dec.decode(raw.slice(20 + msgLen));
  if (expectedCorpId && receiveId && receiveId !== expectedCorpId) {
    throw new Error("CorpID 不匹配");
  }
  return { message, receiveId };
}

export async function wecomEncrypt(
  encodingAesKey: string,
  plaintext: string,
  corpId: string,
): Promise<string> {
  const keyBytes = decodeAesKey(encodingAesKey);
  const iv = keyBytes.slice(0, 16);
  const enc = new TextEncoder();
  const rand16 = crypto.getRandomValues(new Uint8Array(16));
  const msgBytes = enc.encode(plaintext);
  const corpBytes = enc.encode(corpId);

  const raw = new Uint8Array(20 + msgBytes.length + corpBytes.length);
  raw.set(rand16, 0);
  new DataView(raw.buffer).setUint32(16, msgBytes.length, false);
  raw.set(msgBytes, 20);
  raw.set(corpBytes, 20 + msgBytes.length);

  const pad = 32 - (raw.length % 32);
  const padded = new Uint8Array(raw.length + pad);
  padded.set(raw, 0);
  padded.fill(pad, raw.length);

  const key = await crypto.subtle.importKey(
    "raw", keyBytes as BufferSource, { name: "AES-CBC" }, false, ["encrypt"],
  );
  const fullCipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, padded as BufferSource),
  );
  // Strip the extra 16-byte PKCS#7 block added by Web Crypto.
  return b64Encode(fullCipher.slice(0, padded.length));
}

// ---------------------------------------------------------------------------
// Minimal XML parser (safe for WeCom callback payloads)
// ---------------------------------------------------------------------------

export function extractXmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`);
  const m = xml.match(re);
  if (!m) return undefined;
  return (m[1] ?? m[2] ?? "").trim();
}

// ---------------------------------------------------------------------------
// WeCom API Client (via configured proxy_url or qyapi.weixin.qq.com)
// ---------------------------------------------------------------------------

const SETTING_WECOM_TOKEN_CACHE = "wecom_access_token_cache";

interface CachedToken {
  access_token: string;
  expires_at: number;
  fingerprint: string;
}

async function tokenFingerprint(corpId: string, secret: string, base: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${corpId}:${secret}:${base}`),
  );
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function apiBase(cfg: WecomPublicConfig): string {
  return (cfg.proxy_url || WECOM_UPSTREAM).replace(/\/+$/, "");
}

export async function getWecomAccessToken(
  store: WecomStore,
  cfg: WecomPublicConfig,
  secrets: WecomSecrets,
): Promise<string> {
  if (!cfg.corp_id || !secrets.secret) {
    throw new Error("请先配置企业微信 CorpID 与应用 Secret");
  }
  const base = apiBase(cfg);
  const fp = await tokenFingerprint(cfg.corp_id, secrets.secret, base);
  const nowSec = Math.floor(Date.now() / 1000);

  const raw = await store.getSetting(SETTING_WECOM_TOKEN_CACHE);
  if (raw) {
    try {
      const cached = JSON.parse(raw) as CachedToken;
      if (cached.access_token && cached.fingerprint === fp && cached.expires_at > nowSec + 300) {
        return cached.access_token;
      }
    } catch { /* ignore stale cache */ }
  }

  const url = `${base}/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.corp_id)}&corpsecret=${encodeURIComponent(secrets.secret)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const data = (await res.json().catch(() => null)) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number } | null;
  if (!res.ok || !data || data.errcode !== 0 || !data.access_token) {
    throw new Error(`获取 access_token 失败：${data ? `${data.errcode ?? res.status} ${data.errmsg ?? ""}` : `HTTP ${res.status}`}`);
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 7200;
  await store.setSetting(SETTING_WECOM_TOKEN_CACHE, JSON.stringify({
    access_token: data.access_token,
    expires_at: nowSec + expiresIn,
    fingerprint: fp,
  } satisfies CachedToken));
  return data.access_token;
}

export async function clearWecomTokenCache(store: WecomStore): Promise<void> {
  await store.deleteSetting(SETTING_WECOM_TOKEN_CACHE);
}

async function callWecomPost(
  store: WecomStore,
  cfg: WecomPublicConfig,
  secrets: WecomSecrets,
  path: string,
  payload: unknown,
): Promise<{ errcode: number; errmsg: string }> {
  const token = await getWecomAccessToken(store, cfg, secrets);
  const base = apiBase(cfg);
  const sep = path.includes("?") ? "&" : "?";
  const url = `${base}${path}${sep}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as { errcode?: number; errmsg?: string } | null;
  if (!data) throw new Error(`企业微信接口返回异常 HTTP ${res.status}`);
  if (data.errcode === 40014 || data.errcode === 42001) {
    // Expired token: invalidate cache and retry once.
    await clearWecomTokenCache(store);
    const fresh = await getWecomAccessToken(store, cfg, secrets);
    const retryRes = await fetch(`${base}${path}${sep}access_token=${encodeURIComponent(fresh)}`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const retryData = (await retryRes.json().catch(() => null)) as { errcode?: number; errmsg?: string } | null;
    if (!retryData || retryData.errcode !== 0) {
      throw new Error(`企业微信接口错误：${retryData ? `${retryData.errcode} ${retryData.errmsg ?? ""}` : `HTTP ${retryRes.status}`}`);
    }
    return { errcode: 0, errmsg: retryData.errmsg ?? "ok" };
  }
  if (data.errcode !== 0) {
    throw new Error(`企业微信接口错误：${data.errcode} ${data.errmsg ?? ""}`);
  }
  return { errcode: 0, errmsg: data.errmsg ?? "ok" };
}

export async function sendWecomText(
  store: WecomStore,
  cfg: WecomPublicConfig,
  secrets: WecomSecrets,
  toUser: string,
  content: string,
): Promise<void> {
  if (!cfg.agent_id) throw new Error("请先配置 AgentID");
  await callWecomPost(store, cfg, secrets, "/cgi-bin/message/send", {
    touser: toUser || "@all",
    msgtype: "text",
    agentid: cfg.agent_id,
    text: { content },
    safe: 0,
  });
}

export async function sendWecomNews(
  store: WecomStore,
  cfg: WecomPublicConfig,
  secrets: WecomSecrets,
  toUser: string,
  articles: WecomNewsArticle[],
): Promise<void> {
  if (!cfg.agent_id) throw new Error("请先配置 AgentID");
  await callWecomPost(store, cfg, secrets, "/cgi-bin/message/send", {
    touser: toUser || "@all",
    msgtype: "news",
    agentid: cfg.agent_id,
    news: { articles: articles.slice(0, 8) },
  });
}

export function buildWecomOAuthUrl(cfg: WecomPublicConfig, originUrl: string, targetPath: string): string {
  const origin = originUrl.replace(/\/+$/, "");
  if (!cfg.oauth_enabled || !cfg.corp_id) {
    return `${origin}${targetPath}`;
  }
  const redirect = `${origin}/api/wecom/oauth?next=${encodeURIComponent(targetPath)}`;
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(cfg.corp_id)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=snsapi_base&state=panpilot#wechat_redirect`;
}

export async function syncWecomMenu(
  store: WecomStore,
  cfg: WecomPublicConfig,
  secrets: WecomSecrets,
  originUrl: string,
): Promise<void> {
  if (!cfg.agent_id) throw new Error("请先配置 AgentID");
  const menu = {
    button: [
      {
        name: "搜剧订阅",
        sub_button: [
          { type: "click", name: "发送剧名搜剧", key: "SEARCH_HELP" },
          { type: "view", name: "网页发现页", url: buildWecomOAuthUrl(cfg, originUrl, "/discover") },
        ],
      },
      {
        name: "我的订阅",
        sub_button: [
          { type: "click", name: "追更中进度", key: "SUBS_ACTIVE" },
          { type: "click", name: "已完成列表", key: "SUBS_FINISHED" },
          { type: "view", name: "打开控制台", url: buildWecomOAuthUrl(cfg, originUrl, "/subscriptions") },
        ],
      },
      {
        name: "系统状态",
        sub_button: [
          { type: "click", name: "运行概览", key: "SYS_STATUS" },
          { type: "click", name: "最近日志", key: "RECENT_LOGS" },
          { type: "view", name: "系统设置", url: buildWecomOAuthUrl(cfg, originUrl, "/settings") },
        ],
      },
    ],
  };
  await callWecomPost(store, cfg, secrets, `/cgi-bin/menu/create?agentid=${encodeURIComponent(String(cfg.agent_id))}`, menu);
}

export async function exchangeWecomOAuthCode(
  store: WecomStore,
  cfg: WecomPublicConfig,
  secrets: WecomSecrets,
  code: string,
): Promise<{ userid?: string; openid?: string }> {
  const token = await getWecomAccessToken(store, cfg, secrets);
  const base = apiBase(cfg);
  const url = `${base}/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const data = (await res.json().catch(() => null)) as {
    errcode?: number;
    errmsg?: string;
    userid?: string;
    UserId?: string;
    openid?: string;
    OpenId?: string;
  } | null;
  if (!res.ok || !data || data.errcode !== 0) {
    throw new Error(`OAuth 换取身份失败：${data ? `${data.errcode ?? res.status} ${data.errmsg ?? ""}` : `HTTP ${res.status}`}`);
  }
  return {
    userid: data.userid ?? data.UserId,
    openid: data.openid ?? data.OpenId,
  };
}
