import { getConfig } from "./config.js";
import { fetchHeadlessDetailed } from "./headless-scraper.js";
import {
  REPLACED_COMPLIANCE_SOURCE_KEYS,
  SCRIPT_COMPLIANCE_SOURCES,
} from "./compliance-script-registry.js";
import { runComplianceScriptSource } from "./compliance-script-runner.js";

function buildGoogleNewsRss(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

const REMOVED_LEGACY_KEYS = new Set([
  "cac", "japan_ppc", "korea_pipc", "euronews_latest",
  "google_search_bambulab_privacy_security",
  "google_privacy", "edpb", "noyb", "ftc_privacy", "dataguidance",
  "ie_dpc_news",
  ...REPLACED_COMPLIANCE_SOURCE_KEYS,
]);

export const DEFAULT_COMPLIANCE_SOURCES = {
  ...SCRIPT_COMPLIANCE_SOURCES,
  gn_eu_ai_act: {
    name: "Google News: EU AI Act Legislation/Enforcement",
    url: buildGoogleNewsRss(`"EU AI Act" (legislation OR enforcement OR investigation)`),
    type: "rss",
    region: "EU",
    enabled: true,
    limit: 30,
  },
  gn_eu_data_act: {
    name: "Google News: EU Data Act Legislation/Enforcement",
    url: buildGoogleNewsRss(`"EU Data Act" (legislation OR enforcement OR investigation)`),
    type: "rss",
    region: "EU",
    enabled: true,
    limit: 30,
  },
  gn_cn_tech_us_eu_enforcement: {
    name: "Google News: Chinese Tech under US/EU Regulatory Actions",
    url: buildGoogleNewsRss(`("Chinese tech company" OR "China tech firm" OR "Chinese technology company") ("US regulator" OR "EU regulator" OR investigation OR enforcement)`),
    type: "rss",
    region: "Global",
    enabled: true,
    limit: 30,
  },
  gn_data_transfer_eu_us: {
    name: "Google News: Data Transfer EU/US Legislation/Enforcement",
    url: buildGoogleNewsRss(`"data transfer" ("EU" OR "US") (legislation OR enforcement OR investigation)`),
    type: "rss",
    region: "EU/US",
    enabled: true,
    limit: 30,
  },
  gn_privacy_legislation_enforcement: {
    name: "Google News: Privacy Legislation/Enforcement (General)",
    url: buildGoogleNewsRss(`("privacy law" OR "data protection law" OR GDPR OR PIPL OR CCPA) (legislation OR enforcement OR regulator OR fine OR investigation)`),
    type: "rss",
    region: "Global",
    enabled: true,
    limit: 30,
  },
  gn_bambulab_privacy_concerns: {
    name: "Google News: Bambu Lab Privacy/Data Concerns",
    url: buildGoogleNewsRss(`"bambu lab" ("data privacy" OR "user data" OR "cloud data" OR "data collection" OR spying OR surveillance OR "phone home" OR "privacy concern" OR "privacy issue" OR "security vulnerability" OR "data breach")`),
    type: "rss",
    region: "Global",
    enabled: true,
    limit: 30,
    filterKeywords: ["privacy", "data", "spy", "surveil", "security", "breach", "cloud", "phone home", "telemetry", "track", "GDPR", "collect"],
  },
  reddit_bambulab_privacy_security: {
    name: "Reddit: Bambu Lab Privacy/Security Discussions",
    url: "https://www.reddit.com/r/BambuLab/search.rss?q=privacy+OR+%22data+collection%22+OR+spying+OR+telemetry+OR+%22phone+home%22+OR+%22user+data%22+OR+surveillance+OR+%22security+vulnerability%22&sort=new&t=year&restrict_sr=on",
    type: "rss",
    region: "Global",
    enabled: true,
    limit: 25,
    filterKeywords: ["privacy", "data collect", "spying", "spy", "telemetry", "phone home", "user data", "surveillance", "security", "cloud", "GDPR", "data breach", "tracking", "monitor"],
    fallbackOnEmpty: true,
    fallback: {
      key: "reddit_bambulab_fallback",
      url: buildGoogleNewsRss(`site:reddit.com "bambu lab" ("privacy" OR "data collection" OR "spying" OR "telemetry" OR "security vulnerability")`),
      type: "rss",
    },
  },
  forum_bambulab_privacy_security: {
    name: "Forum: Bambu Lab Privacy/Security Discussions",
    url: "https://forum.bambulab.com/latest.rss",
    type: "rss",
    region: "Global",
    enabled: true,
    limit: 30,
    filterKeywords: ["privacy", "data collect", "spy", "telemetry", "phone home", "user data", "surveil", "security", "cloud", "GDPR", "data breach", "track", "monitor", "firmware.*auth", "lan.?only", "offline"],
    fallbackOnEmpty: true,
    fallback: {
      key: "forum_bambulab_fallback",
      url: buildGoogleNewsRss(`site:forum.bambulab.com ("privacy" OR "user data" OR "data collection" OR "security vulnerability" OR "phone home" OR "telemetry")`),
      type: "rss",
    },
  },
  facebook_bambulab_privacy_security: {
    name: "Facebook/News: Bambu Lab Privacy/Security",
    url: buildGoogleNewsRss(`"bambu lab" site:facebook.com ("privacy" OR "user data" OR "data collection" OR "spying" OR "security vulnerability")`),
    type: "rss",
    region: "Global",
    enabled: true,
    limit: 20,
    filterKeywords: ["privacy", "data", "spy", "surveil", "security", "breach", "cloud", "phone home", "telemetry", "track", "GDPR"],
  },
};

export function mergeSavedComplianceSource(defaultSource, savedSource) {
  if (savedSource === undefined || savedSource === null) return { ...defaultSource };
  if (typeof savedSource === "boolean") {
    return { ...defaultSource, enabled: savedSource };
  }

  const merged = { ...defaultSource };
  for (const key of ["enabled", "limit", "recentDays"]) {
    if (savedSource[key] !== undefined) merged[key] = savedSource[key];
  }
  return merged;
}

function stripCdata(str) {
  if (!str) return "";
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      return Number.isFinite(value) ? String.fromCodePoint(value) : "";
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : "";
    });
}

function stripHtml(html) {
  if (!html) return "";
  let value = stripCdata(html);
  for (let i = 0; i < 3; i++) {
    const prev = value;
    value = decodeHtmlEntities(value);
    value = value.replace(/<[^>]*>/g, " ");
    value = value.replace(/\s+/g, " ").trim();
    if (value === prev) break;
  }
  return value;
}

function normalizeLooseText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericLinkText(value) {
  const normalized = normalizeLooseText(value);
  if (!normalized) return true;
  return [
    "read more",
    "learn more",
    "see more",
    "see all",
    "view all",
    "vedi tutti",
    "leggi di piu",
    "mehr erfahren",
    "en savoir plus",
    "weiterlesen",
    "details",
    "open",
    "here",
  ].includes(normalized);
}

function deriveTitleFromContext(htmlBefore) {
  if (!htmlBefore) return "";
  const candidates = [];
  const collect = (regex) => {
    let match;
    while ((match = regex.exec(htmlBefore)) !== null) {
      const text = stripHtml(match[1]);
      if (!text || text.length < 6 || isGenericLinkText(text)) continue;
      candidates.push(text);
    }
  };
  collect(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi);
  collect(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi);
  return candidates.at(-1) || "";
}

function detectDate(value) {
  if (!value) return "";
  const normalizeToken = (str) =>
    String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const iso = value.match(/(20\d{2})[-\/._](\d{1,2})[-\/._](\d{1,2})(?=[^0-9]|$)/);
  if (iso) {
    const [, y, m, d] = iso;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
    if (Number.isFinite(dt.getTime())) return dt.toISOString();
  }
  const dmy = value.match(/(\d{1,2})[-\/._](\d{1,2})[-\/._](20\d{2})(?=[^0-9]|$)/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
    if (Number.isFinite(dt.getTime())) return dt.toISOString();
  }
  const textMonth = value.match(/\b(\d{1,2})(?:st|nd|rd|th)?\.?\s+([A-Za-zÀ-ÿ]+)\s+(20\d{2})\b/);
  if (textMonth) {
    const [, d, monthRaw, y] = textMonth;
    const monthToken = normalizeToken(monthRaw);
    const monthMap = {
      jan: 1, january: 1, janvier: 1, gennaio: 1,
      feb: 2, february: 2, fevrier: 2, februar: 2, febbraio: 2,
      mar: 3, march: 3, mars: 3, marz: 3, maerz: 3, marzo: 3,
      apr: 4, april: 4, avril: 4, aprile: 4,
      may: 5, mai: 5, maggio: 5,
      jun: 6, june: 6, juni: 6, juin: 6, giugno: 6,
      jul: 7, july: 7, juli: 7, juillet: 7, luglio: 7,
      aug: 8, august: 8, aout: 8, agosto: 8,
      sep: 9, sept: 9, september: 9, septembre: 9, settembre: 9,
      oct: 10, october: 10, octobre: 10, oktober: 10, ottobre: 10,
      nov: 11, november: 11, novembre: 11,
      dec: 12, december: 12, dezember: 12, decembre: 12, dicembre: 12,
    };
    const month = monthMap[monthToken];
    if (month) {
      const dt = new Date(Date.UTC(Number(y), month - 1, Number(d), 0, 0, 0));
      if (Number.isFinite(dt.getTime())) return dt.toISOString();
    }
  }
  const zh = value.match(/\b(20\d{2})年(\d{1,2})月(\d{1,2})日\b/);
  if (zh) {
    const [, y, m, d] = zh;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
    if (Number.isFinite(dt.getTime())) return dt.toISOString();
  }

  if (value.length < 500) {
    const relative = normalizeToken(value).match(/\b(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks)\s+ago\b/);
    if (relative) {
      const amount = Number(relative[1]);
      const unit = relative[2];
      const msPerUnit = unit.startsWith("minute")
        ? 60 * 1000
        : unit.startsWith("hour")
          ? 60 * 60 * 1000
          : unit.startsWith("day")
            ? 24 * 60 * 60 * 1000
            : 7 * 24 * 60 * 60 * 1000;
      const dt = new Date(Date.now() - amount * msPerUnit);
      if (Number.isFinite(dt.getTime())) return dt.toISOString();
    }
    if (/\byesterday\b/i.test(value)) {
      const dt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (Number.isFinite(dt.getTime())) return dt.toISOString();
    }
    if (/\btoday\b/i.test(value)) {
      const dt = new Date();
      if (Number.isFinite(dt.getTime())) return dt.toISOString();
    }
  }

  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  return "";
}

function parseFeed(xml) {
  const items = [];

  const parseEntries = (regex) => {
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const entryXml = match[1];
      const get = (tag) => {
        const m = entryXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
        return m ? stripCdata(m[1]) : "";
      };
      const getAttr = (tag, attr) => {
        const m = entryXml.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, "i"));
        return m ? m[1] : "";
      };
      const getAtomLink = () => {
        const alt = entryXml.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
                 || entryXml.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i);
        if (alt) return alt[1];
        return getAttr("link", "href");
      };
      const title = stripHtml(get("title"));
      if (!title) continue;
      const link = decodeHtmlEntities(get("link") || getAtomLink()).replace(/\s/g, "");
      items.push({
        title,
        description: stripHtml(get("description") || get("summary") || get("content")).slice(0, 300),
        link,
        publish_time: detectDate(get("pubDate") || get("dc:date") || get("published") || get("updated")),
        author: stripHtml(get("author") || get("dc:creator") || get("name")),
      });
    }
  };

  parseEntries(/<item>([\s\S]*?)<\/item>/gi);
  if (items.length === 0) {
    parseEntries(/<entry>([\s\S]*?)<\/entry>/gi);
  }
  return items;
}

async function fetchRss(url, limit, filterKeywords) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "NewsAlert/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`RSS ${resp.status} from ${new URL(url).hostname}`);
  const xml = await resp.text();
  let items = parseFeed(xml);
  if (filterKeywords?.length) {
    const patterns = filterKeywords.map((kw) => new RegExp(kw, "i"));
    items = items.filter((item) => {
      const haystack = `${item.title} ${item.description}`;
      return patterns.some((rx) => rx.test(haystack));
    });
  }
  return items.slice(0, limit);
}

function getFallbackReason(items, sourceConfig, effectiveRecentDays) {
  if (!sourceConfig.fallbackOnEmpty) return "";
  if (!Array.isArray(items) || items.length === 0) return "0 items";
  if (items.every((item) => !item.publish_time)) return "0 dated items";

  const recentDays = Number(effectiveRecentDays ?? sourceConfig.recentDays);
  if (!(Number.isFinite(recentDays) && recentDays > 0)) return "";

  const cutoff = Date.now() - recentDays * 24 * 60 * 60 * 1000;
  const hasRecentItem = items.some((item) => {
    const ts = new Date(item.publish_time).getTime();
    return Number.isFinite(ts) && ts >= cutoff && ts <= Date.now() + 10 * 60 * 1000;
  });
  return hasRecentItem ? "" : "0 items within recentDays";
}

function countMissingDates(items) {
  return (items || []).filter((item) => !item.publish_time).length;
}

function extractLinks(html, baseUrl, filterFn) {
  const items = [];
  const seen = new Set();
  const unwrapGoogleRedirect = (link) => {
    try {
      const u = new URL(link);
      if (!/(^|\.)google\./i.test(u.hostname)) return link;
      if (u.pathname !== "/url") return link;
      const target = u.searchParams.get("q");
      if (!target) return link;
      return decodeHtmlEntities(target).trim();
    } catch {
      return link;
    }
  };
  const linkRegex = /<a[^>]+href=(?:["']([^"']+)["']|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1] || match[2];
    const rawText = stripHtml(match[3]).trim();
    const before = html.slice(Math.max(0, match.index - 1600), match.index);
    const after = html.slice(match.index, Math.min(html.length, match.index + match[0].length + 500));
    const around = before + after;
    const narrowBefore = html.slice(Math.max(0, match.index - 400), match.index);
    const narrowAfter = html.slice(match.index, Math.min(html.length, match.index + match[0].length + 300));
    const narrowAround = narrowBefore + narrowAfter;
    const derivedTitle = deriveTitleFromContext(before);
    const text = (rawText.length >= 6 && !isGenericLinkText(rawText)) ? rawText : derivedTitle;
    if (!href || !text || href.includes("javascript:") || href === "###" || seen.has(text) || seen.has(href)) continue;
    if (filterFn && !filterFn(href, text)) continue;
    seen.add(text);
    seen.add(href);
    let link = href;
    if (link.startsWith("//")) {
      link = "https:" + link;
    } else if (!link.startsWith("http")) {
      try { link = new URL(href, baseUrl).href; } catch { continue; }
    }
    link = unwrapGoogleRedirect(link);
    if (!/^https?:\/\//i.test(link)) continue;
    let publish_time = detectDate(`${href} ${text} ${narrowAround}`);
    if (!publish_time) publish_time = detectDate(`${href} ${text} ${around}`);
    items.push({ title: text, link, description: "", publish_time });
  }
  return items;
}

async function scrapeGeneric(url, limit, filterFn) {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`Scrape ${resp.status}`);
  const html = await resp.text();
  return extractLinks(html, url, filterFn).slice(0, limit);
}

const dpcFilter = (href, text) =>
  text.length > 10 &&
  !text.toLowerCase().startsWith("read more") &&
  (href.includes("/news-media/latest-news/") || href.includes("/news-media/press-releases/"));

const SCRAPERS = {
  eu_commission_news: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      (text.length > 6 || href.length > 20) &&
      (href.includes("/news-and-media/news/") || href.includes("/commission/presscorner/detail/") || href.includes("/commission/presscorner/"))
    ),
  beuc_position_papers: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      (text.length > 4 || href.length > 20) && (href.includes("/position-paper") || href.includes("/position-papers/"))
    ),
  ie_dpc_latest_news: (url, limit) => scrapeGeneric(url, limit, dpcFilter),
  ie_dpc_press_releases: (url, limit) => scrapeGeneric(url, limit, dpcFilter),
  ecommerce_europe_news: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      text.length > 10 && (href.includes("/news-item/") || href.includes("/news/"))
    ),
  bundeskartellamt_updates: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      text.length > 10 && href.includes("/SharedDocs/Meldung/")
    ),
  autorite_concurrence_news: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      text.length > 10 && href.includes("/fr/article/")
    ),
  agcm_media: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      text.length > 8 && (href.includes("/media/comunicati-stampa/") || href.includes("/media-e-comunicazione/dettaglio-notizia"))
    ),
  garante_privacy_comunicati: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      text.length > 10 && href.includes("/docweb-display/docweb/")
    ),
  garante_privacy_newsletter: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      text.length > 10 && href.includes("/docweb-display/docweb/")
    ),
  ccpc_business_news: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      text.length > 10 && href.includes("/business/")
    ),
  somi_news: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      text.length > 10 && href.includes("/nl/")
    ),
  iapp_news: (url, limit) =>
    scrapeGeneric(url, limit, (href, text) =>
      text.length > 6 && (href.includes("/news/a/") || href.includes("/news/"))
    ),
};

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.startsWith("127.") ||
      host === "[::1]" ||
      host.startsWith("0.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
      (host.startsWith("[") && /^(fc|fd|fe[89ab])/i.test(host.slice(1)))
    ) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchComplianceSourceDetailed(key, sourceConfig, options = {}) {
  const { url, type, limit = 20, filterKeywords } = sourceConfig;
  if (type === "script") {
    return runComplianceScriptSource(key, { ...sourceConfig, limit }, {
      recentDays: options.recentDays,
      now: options.now,
    });
  }
  if (!isAllowedUrl(url)) throw new Error(`Blocked URL: ${url}`);
  if (type === "rss") {
    const items = await fetchRss(url, limit, filterKeywords);
    return { items, diagnostics: { fetchType: "rss" } };
  }
  if (type === "headless") {
    const result = await fetchHeadlessDetailed(key, sourceConfig);
    return {
      items: result.items || [],
      diagnostics: {
        fetchType: "headless",
        ...(result.diagnostics || {}),
      },
    };
  }
  const scraper = SCRAPERS[key] || ((u, l) => scrapeGeneric(u, l));
  const items = await scraper(url, limit);
  return { items, diagnostics: { fetchType: "scrape" } };
}

async function allSettledWithLimit(entries, limit, worker) {
  const results = new Array(entries.length);
  let nextIndex = 0;
  const concurrency = Math.max(1, Math.min(Number(limit) || 1, entries.length || 1));

  async function consume() {
    while (nextIndex < entries.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      try {
        const value = await worker(entries[currentIndex], currentIndex);
        results[currentIndex] = { status: "fulfilled", value };
      } catch (reason) {
        results[currentIndex] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => consume()));
  return results;
}

export function getMergedComplianceSources() {
  const config = getConfig();
  const saved = config.complianceSources || {};
  const merged = {};
  for (const [key, def] of Object.entries(DEFAULT_COMPLIANCE_SOURCES)) {
    merged[key] = mergeSavedComplianceSource(def, saved[key]);
  }
  for (const [key, val] of Object.entries(saved)) {
    if (REMOVED_LEGACY_KEYS.has(key)) continue;
    if (!merged[key] && val.url) merged[key] = val;
  }
  return merged;
}

export async function fetchAllComplianceSources(options = {}) {
  const sources = getMergedComplianceSources();
  const entries = Object.entries(sources).filter(([, v]) => v.enabled !== false);
  const diagnostics = [];
  const recentDaysOverrideMap = options.recentDaysByKey instanceof Map ? options.recentDaysByKey : null;
  const fetchConcurrency = Number.isFinite(Number(options.fetchConcurrency))
    ? Number(options.fetchConcurrency)
    : 4;

  const settled = await allSettledWithLimit(
    entries,
    fetchConcurrency,
    async ([key, sourceConfig]) => {
      console.log(`[Compliance] Fetching ${sourceConfig.name || key}...`);
      const sourceDiagnostics = {
        source: `compliance_${key}`,
        key,
        name: sourceConfig.name || key,
        fetchType: sourceConfig.type || "unknown",
        configuredRecentDays: sourceConfig.recentDays ?? null,
        limit: sourceConfig.limit || 20,
        fetchMode: "primary",
        primaryCount: 0,
        primaryMissingDate: 0,
        returnedCount: 0,
        returnedMissingDate: 0,
        fallbackUsed: false,
        fallbackReason: "",
        fallbackSource: "",
        fallbackCount: 0,
        fallbackMissingDate: 0,
      };
      const effectiveRecentDays = recentDaysOverrideMap?.get(key);
      try {
        const primary = await fetchComplianceSourceDetailed(key, sourceConfig, {
          recentDays: effectiveRecentDays,
          now: options.now,
        });
        const items = primary.items || [];
        sourceDiagnostics.fetchType = primary.diagnostics?.fetchType || sourceDiagnostics.fetchType;
        sourceDiagnostics.primaryCount = items.length;
        sourceDiagnostics.primaryMissingDate = countMissingDates(items);
        Object.assign(sourceDiagnostics, primary.diagnostics || {});
        const fb = sourceConfig.fallback;
        const fallbackReason = getFallbackReason(items, sourceConfig, effectiveRecentDays);
        if (fb?.url && fallbackReason) {
          const reason = fallbackReason;
          console.warn(`[Compliance] ${key} returned ${reason}, using fallback ${fb.key || "google"}`);
          const fallbackConfig = { ...fb, limit: sourceConfig.limit || 20 };
          if (typeof fb.urlBuilder === "function") {
            fallbackConfig.url = fb.urlBuilder(effectiveRecentDays ?? sourceConfig.recentDays);
          }
          if (sourceConfig.filterKeywords) fallbackConfig.filterKeywords = sourceConfig.filterKeywords;
          try {
            const fallback = await fetchComplianceSourceDetailed(fb.key || key, fallbackConfig, {
              recentDays: effectiveRecentDays,
              now: options.now,
            });
            const fallbackItems = fallback.items || [];
            sourceDiagnostics.fetchMode = "fallback";
            sourceDiagnostics.fallbackUsed = true;
            sourceDiagnostics.fallbackReason = reason;
            sourceDiagnostics.fallbackSource = fb.key || `${key}_fallback`;
            sourceDiagnostics.fallbackCount = fallbackItems.length;
            sourceDiagnostics.fallbackMissingDate = countMissingDates(fallbackItems);
            sourceDiagnostics.returnedCount = fallbackItems.length;
            sourceDiagnostics.returnedMissingDate = sourceDiagnostics.fallbackMissingDate;
            console.log(`[Compliance] ${key} returning fallback results (${fallbackItems.length} items, missing dates ${sourceDiagnostics.fallbackMissingDate}).`);
            return {
              items: fallbackItems.map((item) => ({
                ...item,
                _source: `compliance_${key}`,
                _fallbackSource: fb.key || `${key}_fallback`,
                _group: "compliance",
                _region: sourceConfig.region || "",
              })),
              diagnostics: sourceDiagnostics,
            };
          } catch (fallbackErr) {
            sourceDiagnostics.fetchMode = "fallback";
            sourceDiagnostics.fallbackUsed = true;
            sourceDiagnostics.fallbackReason = reason;
            sourceDiagnostics.fallbackSource = fb.key || `${key}_fallback`;
            sourceDiagnostics.fallbackError = fallbackErr?.message || "unknown fallback error";
            throw { error: fallbackErr, diagnostics: sourceDiagnostics };
          }
        }
        sourceDiagnostics.returnedCount = items.length;
        sourceDiagnostics.returnedMissingDate = sourceDiagnostics.primaryMissingDate;
        console.log(`[Compliance] ${key} using primary results (${items.length} items, missing dates ${sourceDiagnostics.primaryMissingDate}).`);
        return {
          items: items.map((item) => ({
            ...item,
            _source: `compliance_${key}`,
            _group: "compliance",
            _region: sourceConfig.region || "",
          })),
          diagnostics: sourceDiagnostics,
        };
      } catch (err) {
        if (err?.diagnostics && err?.error) throw err;
        const fb = sourceConfig.fallback;
        sourceDiagnostics.primaryError = err.message;
        if (!fb?.url) throw { error: err, diagnostics: sourceDiagnostics };
        console.warn(`[Compliance] ${key} failed, using fallback ${fb.key || "google"}: ${err.message}`);
        const fallbackConfig = { ...fb, limit: sourceConfig.limit || 20 };
        if (typeof fb.urlBuilder === "function") {
          fallbackConfig.url = fb.urlBuilder(effectiveRecentDays ?? sourceConfig.recentDays);
        }
        if (sourceConfig.filterKeywords) fallbackConfig.filterKeywords = sourceConfig.filterKeywords;
        try {
          const fallback = await fetchComplianceSourceDetailed(fb.key || key, fallbackConfig, {
            recentDays: effectiveRecentDays,
            now: options.now,
          });
          const items = fallback.items || [];
          sourceDiagnostics.fetchMode = "fallback";
          sourceDiagnostics.fallbackUsed = true;
          sourceDiagnostics.fallbackReason = `primary_error:${err.message}`;
          sourceDiagnostics.fallbackSource = fb.key || `${key}_fallback`;
          sourceDiagnostics.fallbackCount = items.length;
          sourceDiagnostics.fallbackMissingDate = countMissingDates(items);
          sourceDiagnostics.returnedCount = items.length;
          sourceDiagnostics.returnedMissingDate = sourceDiagnostics.fallbackMissingDate;
          console.log(`[Compliance] ${key} returning fallback results after primary error (${items.length} items, missing dates ${sourceDiagnostics.fallbackMissingDate}).`);
          return {
            items: items.map((item) => ({
              ...item,
              _source: `compliance_${key}`,
              _fallbackSource: fb.key || `${key}_fallback`,
              _group: "compliance",
              _region: sourceConfig.region || "",
            })),
            diagnostics: sourceDiagnostics,
          };
        } catch (fallbackErr) {
          sourceDiagnostics.fetchMode = "fallback";
          sourceDiagnostics.fallbackUsed = true;
          sourceDiagnostics.fallbackReason = `primary_error:${err.message}`;
          sourceDiagnostics.fallbackSource = fb.key || `${key}_fallback`;
          sourceDiagnostics.fallbackError = fallbackErr?.message || "unknown fallback error";
          throw { error: fallbackErr, diagnostics: sourceDiagnostics };
        }
      }
    }
  );

  const allResults = [];
  const errors = [];
  settled.forEach((result, i) => {
    const key = entries[i][0];
    if (result.status === "fulfilled") {
      allResults.push(...result.value.items);
      diagnostics.push(result.value.diagnostics);
    } else {
      const reason = result.reason?.error || result.reason;
      console.error(`[Compliance] Error fetching ${key}:`, reason?.message);
      if (result.reason?.diagnostics) diagnostics.push(result.reason.diagnostics);
      errors.push({ source: `compliance_${key}`, error: reason?.message || "unknown" });
    }
  });

  return { items: allResults, errors, diagnostics };
}
