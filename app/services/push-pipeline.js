import { getConfig, normalizeSourceVal } from "./config.js";
import { mcpClient } from "./mcp-client.js";
import { fetchAllComplianceSources, getMergedComplianceSources } from "./compliance-sources.js";
import { digestTop10, digestComplianceTop10, summarizeComplianceCommunityPulse } from "./summarizer.js";

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
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

function toPlainText(text) {
  let value = String(text || "");
  for (let i = 0; i < 3; i++) {
    const prev = value;
    value = decodeHtmlEntities(value)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (value === prev) break;
  }
  return value;
}

export function normalizeDateCandidate(value) {
  if (!value) return "";
  const raw = toPlainText(String(value)).trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isFinite(date.getTime())) return date.toISOString();
  const normalizeToken = (str) =>
    String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const ymd = raw.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (ymd) {
    const [, y, m, d] = ymd;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
    if (Number.isFinite(dt.getTime())) return dt.toISOString();
  }

  const numericDmy = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (numericDmy) {
    const [, d, m, y] = numericDmy;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
    if (Number.isFinite(dt.getTime())) return dt.toISOString();
  }

  const dmy = raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-zÀ-ÿ]+)\s+(20\d{2})\b/i);
  if (dmy) {
    const [, d, monthTokenRaw, y] = dmy;
    const monthToken = normalizeToken(monthTokenRaw);
    const monthMap = {
      jan: 1, january: 1, janvier: 1, gennaio: 1,
      feb: 2, february: 2, fevrier: 2, februar: 2, febbraio: 2,
      mar: 3, march: 3, mars: 3, marzo: 3,
      apr: 4, april: 4, avril: 4, aprile: 4,
      may: 5, mai: 5, maggio: 5,
      jun: 6, june: 6, juin: 6, giugno: 6,
      jul: 7, july: 7, juillet: 7, luglio: 7,
      aug: 8, august: 8, aout: 8, agosto: 8,
      sep: 9, sept: 9, september: 9, septembre: 9, settembre: 9,
      oct: 10, october: 10, octobre: 10, ottobre: 10,
      nov: 11, november: 11, novembre: 11,
      dec: 12, december: 12, decembre: 12, dicembre: 12,
    };
    const month = monthMap[monthToken];
    if (month) {
      const dt = new Date(Date.UTC(Number(y), month - 1, Number(d), 0, 0, 0));
      if (Number.isFinite(dt.getTime())) return dt.toISOString();
    }
  }

  const zhDate = raw.match(/\b(20\d{2})年(\d{1,2})月(\d{1,2})日\b/);
  if (zhDate) {
    const [, y, m, d] = zhDate;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
    if (Number.isFinite(dt.getTime())) return dt.toISOString();
  }
  return "";
}

export function inferPublishTime(item) {
  const candidates = [
    item.publish_time,
    item.pubDate,
    item.published,
    item.date,
    item.lastmod,
    item.updated,
  ];
  for (const value of candidates) {
    const normalized = normalizeDateCandidate(value);
    if (normalized) return normalized;
  }
  const fromLink = normalizeDateCandidate(String(item.link || ""));
  if (fromLink) return fromLink;
  const fromTitle = normalizeDateCandidate(String(item.title || ""));
  return fromTitle || "";
}

export function filterItemsByRecentDays(items, days = 3, resolveDays) {
  return filterItemsByRecentDaysDetailed(items, days, resolveDays).items;
}

export function filterItemsByRecentDaysDetailed(items, days = 3, resolveDays) {
  const now = Date.now();
  const filteredItems = [];
  const sourceMap = new Map();
  const sourceKeyFor = (item) => String(item?._source || "unknown");
  const ensureSource = (source, configuredRecentDays) => {
    if (!sourceMap.has(source)) {
      sourceMap.set(source, {
        source,
        configuredRecentDays,
        beforeFilter: 0,
        afterFilter: 0,
        missingDate: 0,
        outsideRecentDays: 0,
        fallbackUsed: 0,
      });
    }
    return sourceMap.get(source);
  };

  for (const item of items || []) {
    const itemDaysRaw = typeof resolveDays === "function" ? resolveDays(item, days) : days;
    const itemDays = Number.isFinite(Number(itemDaysRaw)) && Number(itemDaysRaw) > 0 ? Number(itemDaysRaw) : days;
    const cutoff = now - itemDays * 24 * 60 * 60 * 1000;
    const source = sourceKeyFor(item);
    const entry = ensureSource(source, itemDays);
    entry.beforeFilter += 1;
    if (item?._fallbackSource) entry.fallbackUsed += 1;

    const publishTime = inferPublishTime(item);
    if (!publishTime) {
      entry.missingDate += 1;
      continue;
    }
    const ts = new Date(publishTime).getTime();
    if (!Number.isFinite(ts) || ts < cutoff || ts > now + 10 * 60 * 1000) {
      entry.outsideRecentDays += 1;
      continue;
    }
    item.publish_time = publishTime;
    entry.afterFilter += 1;
    filteredItems.push(item);
  }

  const sources = [...sourceMap.values()].sort((a, b) => a.source.localeCompare(b.source));
  const totals = sources.reduce((acc, entry) => {
    acc.beforeFilter += entry.beforeFilter;
    acc.afterFilter += entry.afterFilter;
    acc.missingDate += entry.missingDate;
    acc.outsideRecentDays += entry.outsideRecentDays;
    acc.fallbackUsed += entry.fallbackUsed;
    return acc;
  }, {
    beforeFilter: 0,
    afterFilter: 0,
    missingDate: 0,
    outsideRecentDays: 0,
    fallbackUsed: 0,
  });

  return {
    items: filteredItems,
    diagnostics: {
      totals,
      sources,
    },
  };
}

function mergeSourceDiagnostics(filterSources = [], fetchSources = []) {
  const merged = new Map();
  for (const entry of fetchSources || []) {
    if (!entry?.source) continue;
    merged.set(entry.source, { ...entry });
  }
  for (const entry of filterSources || []) {
    if (!entry?.source) continue;
    merged.set(entry.source, { ...(merged.get(entry.source) || {}), ...entry });
  }
  return [...merged.values()].sort((a, b) => String(a.source || "").localeCompare(String(b.source || "")));
}

export function classifyNewsFetchOutcome({
  explicitSources,
  hasEnabledNewsSources,
  requestedSourceCount,
  resolvedSourceCount,
  discoveryError,
  fetchErrors = [],
  fetchedItemCount,
  filteredItemCount,
  filterDiagnostics,
}) {
  if (discoveryError) {
    return {
      status: "mcp_discovery_failed",
      reason: discoveryError,
    };
  }

  if (Array.isArray(explicitSources) && requestedSourceCount === 0) {
    return {
      status: "no_requested_news_sources",
      reason: "manual request did not include any news sources",
    };
  }

  if (!Array.isArray(explicitSources) && !hasEnabledNewsSources) {
    return {
      status: "no_enabled_news_sources",
      reason: "no enabled news sources in saved config",
    };
  }

  if (requestedSourceCount > 0 && resolvedSourceCount === 0) {
    return {
      status: "no_resolved_news_sources",
      reason: "requested or enabled news sources were not available from MCP",
    };
  }

  if ((fetchErrors || []).length > 0 && fetchedItemCount === 0) {
    return {
      status: "mcp_fetch_failed",
      reason: (fetchErrors || []).map((entry) => entry?.error || entry).filter(Boolean).join("; "),
    };
  }

  const totals = filterDiagnostics?.totals || {};
  if (fetchedItemCount > 0 && filteredItemCount === 0 && (totals.outsideRecentDays || 0) > 0) {
    return {
      status: "filtered_out_by_recent_days",
      reason: "all fetched news items were filtered by recentDays",
    };
  }

  if (fetchedItemCount > 0 && filteredItemCount === 0 && (totals.missingDate || 0) > 0) {
    return {
      status: "filtered_out_missing_dates",
      reason: "all fetched news items were missing usable publish dates",
    };
  }

  if (resolvedSourceCount > 0 && fetchedItemCount === 0) {
    return {
      status: "fetched_zero_news_items",
      reason: "news sources ran but returned zero items",
    };
  }

  return {
    status: filteredItemCount > 0 ? "ok" : "no_news_activity",
    reason: filteredItemCount > 0 ? "" : "no news fetch activity occurred",
  };
}

function logPipelineDiagnostics(label, diagnostics) {
  const summary = (diagnostics?.sources || [])
    .map((entry) =>
      `${entry.source}:${entry.beforeFilter || 0}->${entry.afterFilter || 0},missing=${entry.missingDate || 0},outside=${entry.outsideRecentDays || 0},fallback=${entry.fallbackUsed || 0}`
    )
    .join("; ");
  const statusText = diagnostics?.status
    ? `${diagnostics.status}${diagnostics.reason ? ` (${diagnostics.reason})` : ""}`
    : "";
  const detail = summary || statusText || "no items";
  console.log(`[PushPipeline] ${label} diagnostics: ${detail}`);
}

function hasUsableAIConfig() {
  const config = getConfig();
  return Boolean(config.ai?.baseUrl && config.ai?.apiKey && config.ai?.modelName);
}

export async function fetchUnifiedSnapshot({
  requestedSources,
  sources,
  skipCompliance = false,
  recentDays: recentDaysRaw,
} = {}) {
  const parsedRecentDays = Number(recentDaysRaw);
  const recentDays = Number.isFinite(parsedRecentDays) && parsedRecentDays > 0 ? parsedRecentDays : 3;
  const config = getConfig();
  const mergedComplianceSources = getMergedComplianceSources();
  const explicitSources = Array.isArray(requestedSources) ? requestedSources : (Array.isArray(sources) ? sources : null);
  const hasEnabledNewsSources = Object.values(config.sources || {}).some((value) => normalizeSourceVal(value).enabled);

  let sourceConfigs = [];
  let tools = [];
  const pipelineErrors = [];
  let newsDiscoveryError = "";
  let requestedSourceCount = Array.isArray(explicitSources)
    ? explicitSources.filter((name) => typeof name === "string").length
    : Object.values(config.sources || {}).filter((value) => normalizeSourceVal(value).enabled).length;
  if (Array.isArray(explicitSources) && requestedSourceCount === 0) {
    sourceConfigs = [];
  } else if (Array.isArray(explicitSources)) {
    try {
      tools = await mcpClient.listTools();
      const toolNames = new Set(tools.map((t) => t.name));
      sourceConfigs = explicitSources
        .filter((name) => typeof name === "string" && toolNames.has(name))
        .map((name) => {
          const sv = normalizeSourceVal(config.sources[name]);
          return { name, limit: sv.limit, recentDays: sv.recentDays };
        });
    } catch (err) {
      console.error("[PushPipeline] MCP source discovery error:", err.message);
      newsDiscoveryError = err.message;
      pipelineErrors.push(`MCP source discovery failed: ${err.message}`);
    }
  } else {
    if (hasEnabledNewsSources) {
      try {
        tools = await mcpClient.listTools();
        sourceConfigs = tools
          .map((tool) => {
            const sv = normalizeSourceVal(config.sources[tool.name]);
            return { name: tool.name, limit: sv.limit, enabled: sv.enabled, recentDays: sv.recentDays };
          })
          .filter((item) => item.enabled);
      } catch (err) {
        console.error("[PushPipeline] MCP source discovery error:", err.message);
        newsDiscoveryError = err.message;
        pipelineErrors.push(`MCP source discovery failed: ${err.message}`);
      }
    }
  }

  const newsRecentDaysMap = new Map(sourceConfigs.map((cfg) => [cfg.name, cfg.recentDays || recentDays]));
  const complianceRecentDaysMap = new Map(
    Object.entries(mergedComplianceSources).map(([key, value]) => [key, value.recentDays || recentDays])
  );

  let mcpResult = { items: [], errors: [] };
  if (sourceConfigs.length > 0) {
    try {
      mcpResult = await mcpClient.fetchMultipleSources(sourceConfigs);
    } catch (err) {
      console.error("[PushPipeline] MCP fetch error:", err.message);
      mcpResult = { items: [], errors: [err.message] };
    }
  }

  let complianceResult = { items: [], errors: [] };
  if (!skipCompliance) {
    try {
      complianceResult = await fetchAllComplianceSources({ recentDaysByKey: complianceRecentDaysMap });
    } catch (err) {
      console.error("[PushPipeline] Compliance fetch error:", err.message);
      complianceResult = { items: [], errors: [err.message] };
    }
  }

  const newsFiltered = filterItemsByRecentDaysDetailed(
    mcpResult.items,
    recentDays,
    (item, fallbackDays) => newsRecentDaysMap.get(item._source) || fallbackDays
  );
  const complianceFiltered = filterItemsByRecentDaysDetailed(
    complianceResult.items,
    recentDays,
    (item, fallbackDays) => complianceRecentDaysMap.get(String(item._source || "").replace(/^compliance_/, "")) || fallbackDays
  );
  const newsItems = newsFiltered.items;
  const complianceItems = complianceFiltered.items;

  const diagnostics = {
    news: {
      ...classifyNewsFetchOutcome({
        explicitSources,
        hasEnabledNewsSources,
        requestedSourceCount,
        resolvedSourceCount: sourceConfigs.length,
        discoveryError: newsDiscoveryError,
        fetchErrors: mcpResult.errors || [],
        fetchedItemCount: mcpResult.items.length,
        filteredItemCount: newsFiltered.items.length,
        filterDiagnostics: newsFiltered.diagnostics,
      }),
      totals: newsFiltered.diagnostics.totals,
      sources: newsFiltered.diagnostics.sources,
    },
    compliance: {
      totals: complianceFiltered.diagnostics.totals,
      sources: mergeSourceDiagnostics(
        complianceFiltered.diagnostics.sources,
        complianceResult.diagnostics || []
      ),
    },
  };

  logPipelineDiagnostics("news", diagnostics.news);
  logPipelineDiagnostics("compliance", diagnostics.compliance);

  return {
    recentDays,
    newsItems,
    complianceItems,
    items: [...newsItems, ...complianceItems],
    diagnostics,
    errors: [...pipelineErrors, ...(mcpResult.errors || []), ...(complianceResult.errors || [])],
    droppedByTimeWindow: (mcpResult.items.length + complianceResult.items.length) - (newsItems.length + complianceItems.length),
  };
}

export async function prepareDigestBundle({
  type = "all",
  newsItems = [],
  complianceItems = [],
  existingNewsDigest = [],
  existingComplianceDigest = [],
  existingCommunityPulse = null,
  onProgress,
} = {}) {
  const wantsNews = type === "news" || type === "all";
  const wantsCompliance = type === "compliance" || type === "all";
  const hasAI = hasUsableAIConfig();
  const result = {
    newsDigest: [...(existingNewsDigest || [])],
    complianceDigest: [...(existingComplianceDigest || [])],
    communityPulse: existingCommunityPulse || null,
    generatedNewsDigest: false,
    generatedComplianceDigest: false,
    generatedCommunityPulse: false,
  };

  if (!hasAI) return result;

  if (wantsNews && result.newsDigest.length === 0 && newsItems.length > 0) {
    result.newsDigest = await digestTop10([...newsItems], onProgress ? (evt) => onProgress("news", evt) : undefined);
    result.generatedNewsDigest = true;
  }

  if (wantsCompliance && result.complianceDigest.length === 0 && complianceItems.length > 0) {
    result.complianceDigest = await digestComplianceTop10(
      [...complianceItems],
      onProgress ? (evt) => onProgress("compliance", evt) : undefined
    );
    result.generatedComplianceDigest = true;
  }

  if (wantsCompliance && !result.communityPulse && complianceItems.length > 0) {
    result.communityPulse = await summarizeComplianceCommunityPulse(
      [...complianceItems],
      onProgress ? (evt) => onProgress("community_pulse", evt) : undefined
    );
    result.generatedCommunityPulse = true;
  }

  return result;
}
