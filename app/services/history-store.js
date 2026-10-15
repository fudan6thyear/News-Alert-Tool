import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.resolve(__dirname, "../data/news-history.json");
const MAX_HISTORY_ITEMS = 8000;

let cache = null;

function ensureStore() {
  if (cache) return cache;
  const dir = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(HISTORY_PATH)) {
    const initial = { items: [] };
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(initial, null, 2), "utf-8");
    cache = initial;
    return cache;
  }
  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    cache = { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch (err) {
    console.error("[History] Failed to read history store, reset with empty:", err.message);
    cache = { items: [] };
  }
  return cache;
}

function saveStore() {
  if (!cache) return;
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

function toText(value) {
  return String(value || "").trim();
}

function normalizeIso(value) {
  const dt = new Date(value || "");
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toISOString();
}

function buildKey(item) {
  const link = toText(item.link).toLowerCase();
  const title = toText(item.title).toLowerCase();
  return `${link}__${title}`;
}

function createId(item) {
  return createHash("sha1").update(buildKey(item)).digest("hex").slice(0, 20);
}

function normalizeItem(item, fetchedAt) {
  const isoFetched = normalizeIso(fetchedAt) || new Date().toISOString();
  const publishTime = normalizeIso(item.publish_time);
  return {
    id: createId(item),
    title: toText(item.title) || "Untitled",
    description: toText(item.description),
    summary: toText(item.summary),
    link: toText(item.link),
    publish_time: publishTime,
    _source: toText(item._source),
    _group: toText(item._group),
    _region: toText(item._region),
    author: toText(item.author),
    popularity: toText(item.popularity),
    first_seen: isoFetched,
    last_seen: isoFetched,
    fetched_at: isoFetched,
    isFavorite: false,
    hit_count: 1,
  };
}

export function appendHistoryItems(items, fetchedAt = new Date().toISOString()) {
  const store = ensureStore();
  if (!Array.isArray(items) || items.length === 0) return { added: 0, updated: 0, total: store.items.length };
  const map = new Map(store.items.map((it) => [buildKey(it), it]));
  let added = 0;
  let updated = 0;
  const fetchedIso = normalizeIso(fetchedAt) || new Date().toISOString();

  for (const item of items) {
    const normalized = normalizeItem(item, fetchedIso);
    const key = buildKey(normalized);
    const exists = map.get(key);
    if (!exists) {
      map.set(key, normalized);
      added += 1;
      continue;
    }
    exists.title = normalized.title || exists.title;
    exists.description = normalized.description || exists.description;
    exists.summary = normalized.summary || exists.summary;
    exists.link = normalized.link || exists.link;
    exists.publish_time = normalized.publish_time || exists.publish_time;
    exists._source = normalized._source || exists._source;
    exists._group = normalized._group || exists._group;
    exists._region = normalized._region || exists._region;
    exists.author = normalized.author || exists.author;
    exists.popularity = normalized.popularity || exists.popularity;
    exists.fetched_at = fetchedIso;
    exists.last_seen = fetchedIso;
    exists.hit_count = Number(exists.hit_count || 0) + 1;
    updated += 1;
  }

  store.items = [...map.values()]
    .sort((a, b) => (b.last_seen || "").localeCompare(a.last_seen || ""))
    .slice(0, MAX_HISTORY_ITEMS);
  saveStore();
  return { added, updated, total: store.items.length };
}

export function queryHistoryItems(params = {}) {
  const store = ensureStore();
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 24));
  const q = toText(params.q).toLowerCase();
  const favoritesOnly = String(params.favoritesOnly || "").toLowerCase() === "true";
  const group = toText(params.group);
  const source = toText(params.source);

  let filtered = store.items;
  if (favoritesOnly) filtered = filtered.filter((it) => it.isFavorite);
  if (group && group !== "all") filtered = filtered.filter((it) => (it._group || "") === group);
  if (source && source !== "all") filtered = filtered.filter((it) => (it._source || "") === source);
  if (q) {
    filtered = filtered.filter((it) => {
      const hay = `${it.title} ${it.description} ${it.summary} ${it._source}`.toLowerCase();
      return hay.includes(q);
    });
  }

  filtered = [...filtered].sort((a, b) => (b.last_seen || "").localeCompare(a.last_seen || ""));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

export function setHistoryFavorite(id, favorite) {
  const store = ensureStore();
  const target = store.items.find((it) => it.id === id);
  if (!target) return null;
  target.isFavorite = Boolean(favorite);
  saveStore();
  return target;
}

