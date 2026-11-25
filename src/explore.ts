/**
 * PanPilot Explore module — MoviePilot-inspired media discovery across TMDB & Douban.
 * Zero external dependencies; designed for Cloudflare Workers runtime.
 */

import { regionForMedia, type DirectorySettings } from "./directories";

export type ExploreMediaType = "tv" | "movie" | "variety";

export interface ExploreItem {
  source: "tmdb" | "douban";
  id: string;
  tmdb_id?: number;
  douban_id?: string;
  media_type: ExploreMediaType;
  title: string;
  original_title?: string;
  year?: number;
  region?: string;
  subtitle?: string;
  episodes_info?: string;
  rating?: number;
  poster_url?: string;
  poster_path?: string;
  overview?: string;
}

export const DOUBAN_COLLECTIONS = [
  "tv_hot",
  "movie_showing",
  "movie_hot_gaia",
  "tv_domestic",
  "tv_american",
  "tv_japanese",
  "tv_korean",
  "tv_animation",
  "tv_variety_show",
  "tv_chinese_best_weekly",
  "tv_global_best_weekly",
  "movie_weekly_best",
  "movie_top250",
] as const;

export type DoubanCollection = (typeof DOUBAN_COLLECTIONS)[number];

const DOUBAN_COLLECTION_SET = new Set<string>(DOUBAN_COLLECTIONS);

const DOUBAN_REXXAR_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40",
  Referer: "https://m.douban.com/tv/",
  Accept: "application/json",
};

const DOUBAN_WEB_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://movie.douban.com/",
  Accept: "application/json",
};

const DOUBAN_IMG_RE = /^https:\/\/img\d+\.doubanio\.com\//;

const tmdbPoster = (p: unknown): string | undefined =>
  typeof p === "string" && p ? `https://image.tmdb.org/t/p/w342${p}` : undefined;

function wrapDoubanPoster(url: unknown): string | undefined {
  if (typeof url !== "string" || !url) return undefined;
  const httpsUrl = url.replace(/^http:\/\//, "https://");
  if (!DOUBAN_IMG_RE.test(httpsUrl)) return undefined;
  return `/api/explore/img?url=${encodeURIComponent(httpsUrl)}`;
}

function parseYear(val: unknown, subtitle?: string): number | undefined {
  if (typeof val === "number" && Number.isFinite(val) && val > 1900 && val < 2100) return val;
  if (typeof val === "string" && /^\d{4}$/.test(val.trim())) return Number(val.trim());
  if (subtitle) {
    const m = subtitle.match(/\b(19\d{2}|20\d{2})\b/);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function inferDoubanRegion(dirs: DirectorySettings, collection: string, mediaType: ExploreMediaType, subtitle?: string): string | undefined {
  if (mediaType === "variety") return dirs.tv_special_map.variety ?? "综艺";
  const sub = subtitle ?? "";
  if (mediaType === "movie") {
    if (collection === "tv_animation") return dirs.movie_category_map.animation ?? "动画电影";
    if (/中国|香港|台湾|华语/.test(sub)) return dirs.movie_category_map.CN ?? "华语电影";
    return dirs.movie_category_map["*"] ?? "外语电影";
  }
  if (collection === "tv_domestic" || /中国/.test(sub)) return dirs.tv_region_map.CN ?? "国产剧";
  if (collection === "tv_japanese" || /日本/.test(sub)) return dirs.tv_region_map.JP ?? "日韩剧";
  if (collection === "tv_korean" || /韩国/.test(sub)) return dirs.tv_region_map.KR ?? "日韩剧";
  if (collection === "tv_american" || /美国|英国|法国|德国|加拿大|西班牙/.test(sub)) return dirs.tv_region_map.US ?? "欧美剧";
  if (collection === "tv_animation" && /中国/.test(sub)) return dirs.tv_special_map.animation_cn ?? "国漫";
  return undefined;
}

// ---------------------------------------------------------------------------
// TMDB Explore
// ---------------------------------------------------------------------------

export type TmdbFetchFn = (path: string) => Promise<{ data?: unknown; errorResponse?: Response }>;

export async function fetchTmdbExplore(
  url: URL,
  tmdbFetch: TmdbFetchFn,
  dirs: DirectorySettings,
): Promise<{ items?: ExploreItem[]; page?: number; total_pages?: number; errorResponse?: Response }> {
  const kind = url.searchParams.get("kind") || "trending";
  const rawType = url.searchParams.get("type") || "all";
  const type: "all" | "tv" | "movie" = rawType === "tv" || rawType === "movie" ? rawType : "all";
  const pageRaw = Number(url.searchParams.get("page") || "1");
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(50, Math.floor(pageRaw)) : 1;

  let path = "";
  let fixedMediaType: "tv" | "movie" | null = null;

  if (kind === "trending") {
    path = `/trending/${type}/week?page=${page}`;
  } else if (kind === "popular") {
    const t = type === "movie" ? "movie" : "tv";
    fixedMediaType = t;
    path = `/${t}/popular?page=${page}`;
  } else if (kind === "top_rated") {
    const t = type === "movie" ? "movie" : "tv";
    fixedMediaType = t;
    path = `/${t}/top_rated?page=${page}`;
  } else {
    const t = type === "movie" ? "movie" : "tv";
    fixedMediaType = t;
    const allowedSorts = [
      "popularity.desc",
      "vote_average.desc",
      "first_air_date.desc",
      "primary_release_date.desc",
    ];
    let sort = url.searchParams.get("sort") || "popularity.desc";
    if (!allowedSorts.includes(sort)) sort = "popularity.desc";
    if (t === "tv" && sort === "primary_release_date.desc") sort = "first_air_date.desc";
    if (t === "movie" && sort === "first_air_date.desc") sort = "primary_release_date.desc";

    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("sort_by", sort);
    params.set("include_adult", "false");
    if (sort === "vote_average.desc") params.set("vote_count.gte", "100");

    const genre = url.searchParams.get("genre")?.trim() ?? "";
    if (/^\d+(,\d+)*$/.test(genre)) params.set("with_genres", genre);

    const lang = url.searchParams.get("lang")?.trim() ?? "";
    if (/^[a-z]{2}$/.test(lang)) params.set("with_original_language", lang);

    const year = url.searchParams.get("year")?.trim() ?? "";
    if (/^\d{4}$/.test(year)) {
      params.set(t === "tv" ? "first_air_date_year" : "primary_release_year", year);
    }
    path = `/discover/${t}?${params.toString()}`;
  }

  const { data, errorResponse } = await tmdbFetch(path);
  if (errorResponse) return { errorResponse };

  const payload = (data ?? {}) as { results?: Record<string, unknown>[]; page?: number; total_pages?: number };
  const items: ExploreItem[] = (payload.results ?? [])
    .filter((r) => typeof r === "object" && r !== null && r.media_type !== "person")
    .map((r) => {
      const mt: "tv" | "movie" = fixedMediaType ?? (r.media_type === "movie" ? "movie" : "tv");
      const dateStr = String((mt === "tv" ? r.first_air_date : r.release_date) ?? "");
      const countries = Array.isArray(r.origin_country) ? r.origin_country.map(String) : [];
      const genreIds = Array.isArray(r.genre_ids) ? r.genre_ids.map(Number).filter(Number.isFinite) : [];
      const region = regionForMedia(dirs, countries[0], mt, genreIds);
      const year = dateStr ? Number(dateStr.slice(0, 4)) : undefined;
      return {
        source: "tmdb",
        id: `tmdb:${mt}:${Number(r.id)}`,
        tmdb_id: Number(r.id),
        media_type: mt,
        title: String((mt === "tv" ? r.name : r.title) ?? ""),
        original_title: String((mt === "tv" ? r.original_name : r.original_title) ?? ""),
        year: year && Number.isFinite(year) ? year : undefined,
        region,
        subtitle: [year || "", region || ""].filter(Boolean).join(" · ") || undefined,
        rating: typeof r.vote_average === "number" && r.vote_average > 0 ? Number(r.vote_average.toFixed(1)) : undefined,
        poster_url: tmdbPoster(r.poster_path),
        poster_path: typeof r.poster_path === "string" && r.poster_path ? r.poster_path : undefined,
        overview: typeof r.overview === "string" ? r.overview : undefined,
      };
    });

  return {
    items,
    page: typeof payload.page === "number" ? payload.page : page,
    total_pages: typeof payload.total_pages === "number" ? payload.total_pages : page,
  };
}

// ---------------------------------------------------------------------------
// Douban Explore
// ---------------------------------------------------------------------------

interface RexxarItem {
  id?: string | number;
  title?: string;
  type?: string;
  year?: string | number;
  card_subtitle?: string;
  episodes_info?: string;
  rating?: { value?: number };
  pic?: { normal?: string; large?: string };
  cover?: { url?: string };
  info?: string;
}

async function fetchDoubanFallbackSubjects(
  collection: DoubanCollection,
  start: number,
  count: number,
  dirs: DirectorySettings,
): Promise<{ items: ExploreItem[]; total: number }> {
  const isMovie = collection.startsWith("movie_");
  const type = isMovie ? "movie" : "tv";
  const tag = collection === "tv_domestic" ? "国产剧"
    : collection === "tv_american" ? "美剧"
    : collection === "tv_japanese" ? "日剧"
    : collection === "tv_korean" ? "韩剧"
    : collection === "tv_animation" ? "日本动画"
    : collection === "tv_variety_show" ? "综艺"
    : "热门";
  const url = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&page_limit=${count}&page_start=${start}`;
  const res = await fetch(url, { headers: DOUBAN_WEB_HEADERS });
  if (!res.ok) throw new Error(`豆瓣榜单请求失败 HTTP ${res.status}`);
  const data = (await res.json()) as {
    subjects?: { id?: string; title?: string; rate?: string; cover?: string; episodes_info?: string }[];
  };
  const mediaType: ExploreMediaType = collection === "tv_variety_show" ? "variety" : (isMovie ? "movie" : "tv");
  const items: ExploreItem[] = (data.subjects ?? []).map((s) => {
    const rate = s.rate ? Number(s.rate) : NaN;
    return {
      source: "douban",
      id: `douban:${s.id ?? s.title ?? Math.random()}`,
      douban_id: s.id ? String(s.id) : undefined,
      media_type: mediaType,
      title: String(s.title ?? "").trim(),
      region: inferDoubanRegion(dirs, collection, mediaType),
      episodes_info: s.episodes_info || undefined,
      rating: Number.isFinite(rate) && rate > 0 ? Number(rate.toFixed(1)) : undefined,
      poster_url: wrapDoubanPoster(s.cover),
    };
  });
  return { items, total: start + items.length + (items.length === count ? count : 0) };
}

export async function fetchDoubanExplore(
  collectionRaw: string,
  startRaw: number,
  countRaw: number,
  dirs: DirectorySettings,
): Promise<{ items: ExploreItem[]; start: number; count: number; total: number; has_more: boolean }> {
  const collection = (DOUBAN_COLLECTION_SET.has(collectionRaw) ? collectionRaw : "tv_hot") as DoubanCollection;
  const start = Number.isFinite(startRaw) && startRaw >= 0 ? Math.floor(startRaw) : 0;
  const count = Number.isFinite(countRaw) && countRaw >= 1 ? Math.min(40, Math.floor(countRaw)) : 20;

  const url = `https://m.douban.com/rexxar/api/v2/subject_collection/${collection}/items?start=${start}&count=${count}`;
  const res = await fetch(url, { headers: DOUBAN_REXXAR_HEADERS });
  if (!res.ok) {
    const fb = await fetchDoubanFallbackSubjects(collection, start, count, dirs);
    return {
      items: fb.items,
      start,
      count,
      total: fb.total,
      has_more: fb.items.length >= count,
    };
  }
  const data = (await res.json()) as {
    start?: number;
    count?: number;
    total?: number;
    subject_collection_items?: RexxarItem[];
  };
  const rawItems = data.subject_collection_items ?? [];
  const total = typeof data.total === "number" ? data.total : start + rawItems.length;

  const items: ExploreItem[] = rawItems.map((it) => {
    const isMovie = collection.startsWith("movie_") || it.type === "movie";
    const mediaType: ExploreMediaType = collection === "tv_variety_show" ? "variety" : (isMovie ? "movie" : "tv");
    const subtitle = typeof it.card_subtitle === "string" ? it.card_subtitle.replace(/\s*\/\s*/g, " · ") : undefined;
    const year = parseYear(it.year, it.card_subtitle);
    const rate = it.rating && typeof it.rating.value === "number" && it.rating.value > 0
      ? Number(it.rating.value.toFixed(1))
      : undefined;
    const rawPic = it.pic?.normal || it.pic?.large || it.cover?.url;
    return {
      source: "douban",
      id: `douban:${it.id ?? it.title ?? ""}`,
      douban_id: it.id != null ? String(it.id) : undefined,
      media_type: mediaType,
      title: String(it.title ?? "").trim(),
      year,
      region: inferDoubanRegion(dirs, collection, mediaType, it.card_subtitle),
      subtitle,
      episodes_info: typeof it.episodes_info === "string" && it.episodes_info ? it.episodes_info : undefined,
      rating: rate,
      poster_url: wrapDoubanPoster(rawPic),
      overview: typeof it.info === "string" && it.info ? it.info : undefined,
    };
  });

  return {
    items,
    start,
    count,
    total,
    has_more: start + items.length < total && items.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Douban Poster Proxy (strict *.doubanio.com whitelist against SSRF)
// ---------------------------------------------------------------------------

export async function handleExploreImg(urlParam: string | null): Promise<Response> {
  const target = (urlParam ?? "").trim().replace(/^http:\/\//, "https://");
  if (!DOUBAN_IMG_RE.test(target)) {
    return new Response("invalid image url", { status: 400 });
  }
  try {
    const res = await fetch(target, {
      headers: {
        Referer: "https://m.douban.com/",
        "User-Agent": DOUBAN_REXXAR_HEADERS["User-Agent"],
      },
    });
    if (!res.ok) return new Response("upstream image error", { status: 502 });
    const headers = new Headers();
    headers.set("content-type", res.headers.get("content-type") || "image/jpeg");
    headers.set("cache-control", "public, max-age=86400");
    return new Response(res.body, { status: 200, headers });
  } catch {
    return new Response("image fetch failed", { status: 502 });
  }
}

// ---------------------------------------------------------------------------
// Douban -> TMDB Auto-Match
// ---------------------------------------------------------------------------

export interface MatchCandidate {
  tmdb_id: number;
  media_type: "tv" | "movie";
  title: string;
  original_title?: string;
  year?: number;
  region?: string;
  poster_url?: string;
  poster_path?: string;
  rating?: number;
  overview?: string;
}

export function cleanMediaTitle(raw: string): string {
  return raw
    .replace(/\s+第[一二三四五六七八九十百\d]+季.*$/i, "")
    .replace(/\s+Season\s+\d+.*$/i, "")
    .replace(/\s+S\d{1,2}$/i, "")
    .trim();
}

export function pickBestTmdbMatch(
  candidates: MatchCandidate[],
  title: string,
  mediaType: ExploreMediaType,
  year?: number,
): MatchCandidate | null {
  if (!candidates.length) return null;
  const targetType = mediaType === "movie" ? "movie" : "tv";
  const cleaned = cleanMediaTitle(title).toLowerCase();
  const rawLower = title.trim().toLowerCase();

  let best: MatchCandidate | null = null;
  let bestScore = -1;

  for (const c of candidates) {
    let score = 0;
    if (c.media_type === targetType) score += 30;
    const ct = (c.title || "").trim().toLowerCase();
    const co = (c.original_title || "").trim().toLowerCase();
    if (ct === rawLower || ct === cleaned || co === cleaned) score += 50;
    else if (ct.includes(cleaned) || cleaned.includes(ct)) score += 25;
    if (year && c.year) {
      const diff = Math.abs(year - c.year);
      if (diff === 0) score += 20;
      else if (diff === 1) score += 10;
    }
    if (c.poster_path) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 30 ? best : candidates[0];
}
