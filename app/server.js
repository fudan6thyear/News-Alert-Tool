import express from "express";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mcpClient } from "./services/mcp-client.js";
import { summarizeNews } from "./services/summarizer.js";
import { sendEmail, resetTransporter } from "./services/email.js";
import { scheduler } from "./services/scheduler.js";
import { getConfig, saveConfig, normalizeSourceVal } from "./services/config.js";
import { appendHistoryItems, queryHistoryItems, setHistoryFavorite } from "./services/history-store.js";
import { sendComplianceDigestWebhook } from "./services/webhook.js";
import { DEFAULT_PROMPTS, validatePromptTemplate } from "./services/prompt-templates.js";
import { fetchUnifiedSnapshot, prepareDigestBundle } from "./services/push-pipeline.js";
import { registerWorkflowExportRoute } from "./services/workflow-export.js";
import {
  getMergedComplianceSources,
} from "./services/compliance-sources.js";
import {
  WINDOWS_AUTOSTART_SCRIPT_NAME,
  getAutostartLogPath,
  getAutostartVbsLogPath,
  writeWindowsStartupVbs,
} from "./services/autostart-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.NEWS_ALERT_PORT || process.env.PORT || 3201);
const MCP_CONNECT_TIMEOUT_MS = 15_000;

function getRequestContext(req) {
  return {
    tenant_id: req.get("X-Tenant-Id") || process.env.LJSP_TENANT_ID || "default",
    request_id: req.get("X-Request-Id") || randomUUID(),
  };
}

process.on("uncaughtException", (err) => {
  console.error("[Server] uncaughtException:", err?.stack || err?.message || err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error("[Server] unhandledRejection:", msg);
  process.exit(1);
});
const PROJECT_DIR = path.resolve(__dirname, "..");
const LOGS_DIR = path.join(PROJECT_DIR, "logs");
const AUTOSTART_LOG = getAutostartLogPath(PROJECT_DIR);
const AUTOSTART_VBS_LOG = getAutostartVbsLogPath(PROJECT_DIR);
const SERVICE_HOST_PID_FILE = path.join(LOGS_DIR, "service-host.pid");
const SERVICE_STDOUT_LOG = path.join(LOGS_DIR, "stdout.log");
const SERVICE_STDERR_LOG = path.join(LOGS_DIR, "stderr.log");
const SERVICE_STOP_FLAG_FILE = path.join(LOGS_DIR, "service-stop.flag");

app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  req.context = getRequestContext(req);
  res.setHeader("X-Request-Id", req.context.request_id);
  res.on("finish", () => {
    console.log("[Request]", JSON.stringify({
      tenant_id: req.context.tenant_id,
      request_id: req.context.request_id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - startedAt,
    }));
  });
  next();
});
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    tenant_id: req.context.tenant_id,
    request_id: req.context.request_id,
  });
});
app.use(express.static(path.join(__dirname, "public")));
registerWorkflowExportRoute(app);

const state = {
  news: [],
  complianceNews: [],
  digest: [],
  complianceDigest: [],
  complianceCommunityPulse: null,
  _lock: null,
};

async function withStateLock(fn) {
  while (state._lock) await state._lock;
  let resolve;
  state._lock = new Promise((r) => { resolve = r; });
  try {
    return await fn();
  } finally {
    state._lock = null;
    resolve();
  }
}

/* Backwards-compat aliases for the SSE endpoint's direct reads */
let latestNews = state.news;
let latestComplianceNews = state.complianceNews;
let latestDigest = state.digest;
let latestComplianceDigest = state.complianceDigest;
let latestComplianceCommunityPulse = state.complianceCommunityPulse;

function clearNewsDigestState() {
  state.digest = latestDigest = [];
}

function clearComplianceDigestState() {
  state.complianceDigest = latestComplianceDigest = [];
  state.complianceCommunityPulse = latestComplianceCommunityPulse = null;
}

function filterEnabledNewsSnapshot(items = []) {
  const config = getConfig();
  return (items || []).filter((item) => normalizeSourceVal(config.sources?.[item._source]).enabled);
}

function filterEnabledComplianceSnapshot(items = []) {
  const config = getConfig();
  return (items || []).filter((item) => {
    const key = String(item._source || "").replace(/^compliance_/, "");
    const sourceConfig = config.complianceSources?.[key];
    return sourceConfig ? sourceConfig.enabled !== false : true;
  });
}

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
    value = decodeHtmlEntities(value);
    value = value.replace(/<[^>]*>/g, " ");
    value = value.replace(/\s+/g, " ").trim();
    if (value === prev) break;
  }
  return value;
}

function normalizeDateCandidate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();

  const normalizeToken = (str) =>
    String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const slashOrDash = raw.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (slashOrDash) {
    const [, y, m, d] = slashOrDash;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
    if (Number.isFinite(dt.getTime())) return dt.toISOString();
  }
  const dmy = raw.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
    if (Number.isFinite(dt.getTime())) return dt.toISOString();
  }
  const textMonth = raw.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-zÀ-ÿ]+)\s+(20\d{2})\b/);
  if (textMonth) {
    const [, d, monthRaw, y] = textMonth;
    const monthToken = normalizeToken(monthRaw);
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

function inferPublishTime(item) {
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

function filterItemsByRecentDays(items, days = 3, resolveDays) {
  const now = Date.now();
  return (items || []).filter((item) => {
    const itemDaysRaw = typeof resolveDays === "function" ? resolveDays(item, days) : days;
    const itemDays = Number.isFinite(Number(itemDaysRaw)) && Number(itemDaysRaw) > 0 ? Number(itemDaysRaw) : days;
    const cutoff = now - itemDays * 24 * 60 * 60 * 1000;
    const publishTime = inferPublishTime(item);
    if (!publishTime) return false;
    const ts = new Date(publishTime).getTime();
    if (!Number.isFinite(ts) || ts < cutoff || ts > now + 10 * 60 * 1000) return false;
    item.publish_time = publishTime;
    return true;
  });
}

// --- API: 数据源列表 (MCP) ---
app.get("/api/sources", async (req, res) => {
  try {
    const tools = await mcpClient.listTools();
    const config = getConfig();
    const sources = tools.map((t) => {
      const sv = normalizeSourceVal(config.sources[t.name]);
      return {
        name: t.name,
        description: t.description,
        enabled: sv.enabled,
        limit: sv.limit,
        recentDays: sv.recentDays,
        group: "news",
      };
    });
    res.json({ ok: true, sources });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: 合规源列表 ---
app.get("/api/compliance-sources", (req, res) => {
  const merged = getMergedComplianceSources();
  const sources = Object.entries(merged).map(([key, val]) => ({
    key,
    name: val.name,
    url: val.url,
    type: val.type,
    region: val.region,
    enabled: val.enabled !== false,
    limit: val.limit ?? 20,
    recentDays: val.recentDays ?? 3,
    group: "compliance",
  }));
  res.json({ ok: true, sources });
});

// --- API: 抓取新闻 (MCP + Compliance) ---
app.post("/api/fetch", async (req, res) => {
  try {
    const snapshot = await fetchUnifiedSnapshot(req.body || {});
    state.news = latestNews = snapshot.newsItems;
    state.complianceNews = latestComplianceNews = snapshot.complianceItems;
    state.digest = latestDigest = [];
    state.complianceDigest = latestComplianceDigest = [];
    state.complianceCommunityPulse = latestComplianceCommunityPulse = null;
    const fetchTime = new Date().toISOString();
    const historyResult = appendHistoryItems(snapshot.items, fetchTime);

    res.json({
      ok: true,
      count: snapshot.items.length,
      newsCount: snapshot.newsItems.length,
      complianceCount: snapshot.complianceItems.length,
      recentDays: snapshot.recentDays,
      droppedByTimeWindow: snapshot.droppedByTimeWindow,
      diagnostics: snapshot.diagnostics,
      history: historyResult,
      items: snapshot.items,
      errors: snapshot.errors,
      fetchTime,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: AI 摘要（逐条） ---
app.post("/api/summarize", async (req, res) => {
  try {
    const { items } = req.body || {};
    const newsToSummarize = items && items.length > 0 ? items : latestNews;

    if (!newsToSummarize || newsToSummarize.length === 0) {
      return res.status(400).json({ ok: false, error: "没有可摘要的新闻，请先抓取新闻" });
    }

    const summarized = await summarizeNews(newsToSummarize);

    res.json({ ok: true, count: summarized.length, items: summarized });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: AI Top 10 热点摘要 (SSE 流式，支持 ?type=news|compliance|all) ---
app.get("/api/digest/stream", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  let clientClosed = false;
  req.on("close", () => { clientClosed = true; });

  const send = (event, data) => {
    if (clientClosed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  const type = req.query.type || "all";

  try {
    const wantsNews = type === "news" || type === "all";
    const wantsCompliance = type === "compliance" || type === "all";
    const newsSnapshot = filterEnabledNewsSnapshot([...latestNews]);
    const compSnapshot = filterEnabledComplianceSnapshot([...latestComplianceNews]);
    if (wantsNews && wantsCompliance && newsSnapshot.length === 0 && compSnapshot.length === 0) {
      clearNewsDigestState();
      clearComplianceDigestState();
      send("error", { error: "没有可分析的数据，请先抓取新闻" });
      res.end();
      return;
    }
    if ((type === "news" || type === "all") && newsSnapshot.length === 0 && type === "news") {
      clearNewsDigestState();
      send("error", { error: "没有新闻数据，请先抓取新闻" });
      res.end();
      return;
    }
    if ((type === "compliance" || type === "all") && compSnapshot.length === 0 && type === "compliance") {
      clearComplianceDigestState();
      send("error", { error: "没有合规数据，请先抓取新闻" });
      res.end();
      return;
    }

    const bundle = await prepareDigestBundle({
      type,
      newsItems: newsSnapshot,
      complianceItems: compSnapshot,
      onProgress: (category, evt) => send("progress", { ...evt, category }),
    });
    const newsGenerationFailed = wantsNews && newsSnapshot.length > 0 && bundle.newsDigest.length === 0;
    const complianceGenerationFailed = wantsCompliance && compSnapshot.length > 0 && bundle.complianceDigest.length === 0;

    if (wantsNews) {
      if (bundle.newsDigest.length > 0) {
        state.digest = latestDigest = bundle.newsDigest;
      } else {
        clearNewsDigestState();
      }
      if (!clientClosed) {
        send("news_result", { ok: true, count: latestDigest.length, items: latestDigest });
      }
    }
    if (wantsCompliance) {
      if (bundle.complianceDigest.length > 0) {
        state.complianceDigest = latestComplianceDigest = bundle.complianceDigest;
        state.complianceCommunityPulse = latestComplianceCommunityPulse = bundle.communityPulse;
      } else {
        clearComplianceDigestState();
      }
      if (!clientClosed) {
        send("compliance_result", { ok: true, count: latestComplianceDigest.length, items: latestComplianceDigest });
        send("community_pulse_result", { ok: true, data: latestComplianceCommunityPulse });
      }
    }
    if ((type === "news" && newsGenerationFailed) || (type === "compliance" && complianceGenerationFailed)) {
      send("error", { error: "摘要生成失败，请检查 AI 配置后重试" });
      res.end();
      return;
    }

    send("result", {
      ok: true,
      news: { count: latestDigest.length, items: latestDigest },
      compliance: { count: latestComplianceDigest.length, items: latestComplianceDigest },
      communityPulse: latestComplianceCommunityPulse,
    });
  } catch (err) {
    if (!clientClosed) {
      console.error("[Digest] SSE Error:", err.message);
      send("error", { error: err.message });
    }
  } finally {
    if (!clientClosed) res.end();
  }
});

app.post("/api/digest", async (req, res) => {
  try {
    const result = await withStateLock(async () => {
      const type = req.query.type || req.body?.type || "all";
      const wantsNews = type === "news" || type === "all";
      const wantsCompliance = type === "compliance" || type === "all";
      const newsSnapshot = filterEnabledNewsSnapshot([...latestNews]);
      const compSnapshot = filterEnabledComplianceSnapshot([...latestComplianceNews]);
      if (wantsNews && wantsCompliance && newsSnapshot.length === 0 && compSnapshot.length === 0) {
        clearNewsDigestState();
        clearComplianceDigestState();
        return null;
      }
      const bundle = await prepareDigestBundle({
        type,
        newsItems: newsSnapshot,
        complianceItems: compSnapshot,
      });
      const results = {};
      let hasGenerated = false;
      const newsGenerationFailed = wantsNews && newsSnapshot.length > 0 && bundle.newsDigest.length === 0;
      const complianceGenerationFailed = wantsCompliance && compSnapshot.length > 0 && bundle.complianceDigest.length === 0;

      if (wantsNews) {
        if (bundle.newsDigest.length > 0) {
          state.digest = latestDigest = bundle.newsDigest;
          hasGenerated = true;
        } else {
          clearNewsDigestState();
        }
        results.news = { count: latestDigest.length, items: latestDigest };
      }

      if (wantsCompliance) {
        if (bundle.complianceDigest.length > 0) {
          state.complianceDigest = latestComplianceDigest = bundle.complianceDigest;
          state.complianceCommunityPulse = latestComplianceCommunityPulse = bundle.communityPulse;
          hasGenerated = true;
        } else {
          clearComplianceDigestState();
        }
        results.compliance = { count: latestComplianceDigest.length, items: latestComplianceDigest };
        results.communityPulse = latestComplianceCommunityPulse;
      }

      if ((type === "news" && newsGenerationFailed) || (type === "compliance" && complianceGenerationFailed)) {
        return null;
      }
      if (!hasGenerated && !((wantsNews && newsSnapshot.length === 0) || (wantsCompliance && compSnapshot.length === 0))) {
        return null;
      }
      return { ok: true, ...results, items: [...(latestDigest || []), ...(latestComplianceDigest || [])] };
    });

    if (!result) {
      return res.status(400).json({ ok: false, error: "没有可分析的数据，请先抓取新闻" });
    }
    res.json(result);
  } catch (err) {
    console.error("[Digest] Error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: 发送邮件（自动补生成 digest） ---
app.post("/api/send-email", async (req, res) => {
  try {
    const result = await withStateLock(async () => {
      const newsSnap = filterEnabledNewsSnapshot([...latestNews]);
      const compSnap = filterEnabledComplianceSnapshot([...latestComplianceNews]);
      const bundle = await prepareDigestBundle({
        type: "all",
        newsItems: newsSnap,
        complianceItems: compSnap,
        existingNewsDigest: newsSnap.length > 0 ? [...latestDigest] : [],
        existingComplianceDigest: compSnap.length > 0 ? [...latestComplianceDigest] : [],
        existingCommunityPulse: compSnap.length > 0 ? latestComplianceCommunityPulse : null,
      });
      const digestSnap = bundle.newsDigest;
      const compDigestSnap = bundle.complianceDigest;

      const hasAny = newsSnap.length > 0 || compSnap.length > 0
        || digestSnap.length > 0 || compDigestSnap.length > 0;
      if (!hasAny) return null;

      state.digest = latestDigest = digestSnap;
      state.complianceDigest = latestComplianceDigest = compDigestSnap;
      state.complianceCommunityPulse = latestComplianceCommunityPulse = bundle.communityPulse;

      const { newsTargetGroups, complianceTargetGroups } = req.body || {};

      return sendEmail({
        newsItems: newsSnap,
        newsDigest: digestSnap,
        complianceItems: compSnap,
        complianceDigest: compDigestSnap,
        newsTargetGroups,
        complianceTargetGroups,
      });
    });

    if (!result) {
      return res.status(400).json({ ok: false, error: "没有可发送的内容，请先抓取新闻" });
    }
    const allTo = result.flatMap((r) => r.to);
    res.json({ ok: true, results: result, to: [...new Set(allTo)] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: 发送飞书 Webhook（合规摘要） ---
app.post("/api/send-webhook", async (req, res) => {
  try {
    const result = await withStateLock(async () => {
      const compSnap = filterEnabledComplianceSnapshot([...latestComplianceNews]);
      const bundle = await prepareDigestBundle({
        type: "compliance",
        newsItems: [],
        complianceItems: compSnap,
        existingComplianceDigest: compSnap.length > 0 ? [...latestComplianceDigest] : [],
        existingCommunityPulse: compSnap.length > 0 ? latestComplianceCommunityPulse : null,
      });
      const compDigestSnap = bundle.complianceDigest;
      const pulseSnap = bundle.communityPulse;
      const hasAny = compSnap.length > 0 || compDigestSnap.length > 0;
      if (!hasAny) return null;

      state.complianceDigest = latestComplianceDigest = compDigestSnap;
      state.complianceCommunityPulse = latestComplianceCommunityPulse = pulseSnap;

      if (compDigestSnap.length === 0) {
        throw new Error("没有可发送的合规 AI 总结，请先抓取并生成摘要");
      }

      const fetchTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
      return sendComplianceDigestWebhook({
        taskName: "手动发送",
        fetchTime,
        complianceDigest: compDigestSnap,
        communityPulse: pulseSnap,
      });
    });

    if (!result) {
      return res.status(400).json({ ok: false, error: "没有可发送的合规内容，请先抓取新闻" });
    }
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: TXT 导出 ---
app.get("/api/export", (req, res) => {
  const hasDigest = latestDigest && latestDigest.length > 0;
  const hasCompDigest = latestComplianceDigest && latestComplianceDigest.length > 0;
  const hasCommunityPulse = latestComplianceCommunityPulse && (latestComplianceCommunityPulse.conclusion || latestComplianceCommunityPulse.hasDiscussion);
  const hasNews = latestNews && latestNews.length > 0;
  const hasComp = latestComplianceNews && latestComplianceNews.length > 0;

  if (!hasDigest && !hasCompDigest && !hasNews && !hasComp && !hasCommunityPulse) {
    return res.status(400).json({ ok: false, error: "没有可导出的新闻" });
  }

  const lines = [];
  const exportTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  lines.push("=".repeat(60));
  lines.push("  News Alert 新闻日报");
  lines.push(`  导出时间：${exportTime}`);
  lines.push("=".repeat(60));
  lines.push("");

  if (hasDigest) {
    lines.push(">>> 今日新闻热点 Top 10 <<<");
    lines.push("=".repeat(40));
    lines.push("");
    for (const item of latestDigest) {
      lines.push(`  #${item.rank} ${item.title}`);
      lines.push(`  摘要：${item.summary}`);
      if (item.sources) lines.push(`  来源：${item.sources}`);
      if (Array.isArray(item.relatedItems) && item.relatedItems.length > 0) {
        lines.push(`  相关原文（${item.relatedItems.length} 条）：`);
        item.relatedItems.forEach((related, index) => {
          const meta = [related.source, related.region].filter(Boolean).join(" | ");
          lines.push(`    ${index + 1}. ${related.title || "无标题"}`);
          if (meta) lines.push(`       信息：${meta}`);
          if (related.link) lines.push(`       链接：${related.link}`);
        });
      }
      lines.push("");
    }
    lines.push("");
  }

  if (hasCompDigest) {
    lines.push(">>> Privacy & AI Compliance Top 10 (DPO) <<<");
    lines.push("=".repeat(40));
    lines.push("");
    for (const item of latestComplianceDigest) {
      lines.push(`  #${item.rank} ${item.title}`);
      lines.push(`  摘要：${item.summary}`);
      if (item.region) lines.push(`  地区：${item.region}`);
      if (item.sources) lines.push(`  来源：${item.sources}`);
      if (Array.isArray(item.relatedItems) && item.relatedItems.length > 0) {
        lines.push(`  相关原文（${item.relatedItems.length} 条）：`);
        item.relatedItems.forEach((related, index) => {
          const meta = [related.source, related.region].filter(Boolean).join(" | ");
          lines.push(`    ${index + 1}. ${related.title || "无标题"}`);
          if (meta) lines.push(`       信息：${meta}`);
          if (related.link) lines.push(`       链接：${related.link}`);
        });
      }
      lines.push("");
    }
    lines.push("");
  }

  if (hasCommunityPulse) {
    lines.push(">>> Bambu Lab 社区舆情总结（隐私/安全） <<<");
    lines.push("=".repeat(40));
    lines.push(`  结论：${latestComplianceCommunityPulse.conclusion || "暂无"}`);
    const findings = Array.isArray(latestComplianceCommunityPulse.findings) ? latestComplianceCommunityPulse.findings : [];
    if (findings.length > 0) {
      lines.push("");
      findings.forEach((f, idx) => {
        lines.push(`  ${idx + 1}. [${f.source || "Unknown"}] ${f.topic || "社区讨论"}`);
        if (f.details) lines.push(`     要点：${toPlainText(f.details)}`);
        if (f.link) lines.push(`     链接：${f.link}`);
      });
    }
    lines.push("");
  }

  if (hasComp) {
    lines.push(`>>> 合规资讯 (${latestComplianceNews.length} 条) <<<`);
    lines.push("=".repeat(40));
    lines.push("");
    const bySource = {};
    for (const item of latestComplianceNews) {
      const src = item._source || "unknown";
      if (!bySource[src]) bySource[src] = [];
      bySource[src].push(item);
    }
    for (const [source, items] of Object.entries(bySource)) {
      const label = source.replace("compliance_", "").replace(/_/g, " ").toUpperCase();
      lines.push(`【${label}】`);
      lines.push("-".repeat(40));
      for (const item of items) {
        lines.push(`  标题：${item.title || "无标题"}`);
        if (item.description) lines.push(`  描述：${toPlainText(item.description)}`);
        if (item.link) lines.push(`  链接：${item.link}`);
        lines.push("");
      }
      lines.push("");
    }
  }

  if (hasNews) {
    lines.push(`>>> 全部新闻 (${latestNews.length} 条) <<<`);
    lines.push("=".repeat(40));
    lines.push("");
    const bySource = {};
    for (const item of latestNews) {
      const src = item._source || "未知来源";
      if (!bySource[src]) bySource[src] = [];
      bySource[src].push(item);
    }
    for (const [source, items] of Object.entries(bySource)) {
      const label = source.replace("get_", "").replace(/_/g, " ").toUpperCase();
      lines.push(`【${label}】`);
      lines.push("-".repeat(40));
      for (const item of items) {
        lines.push(`  标题：${item.title || "无标题"}`);
        if (item.summary) lines.push(`  摘要：${item.summary}`);
        else if (item.description) lines.push(`  描述：${toPlainText(item.description)}`);
        if (item.link) lines.push(`  链接：${item.link}`);
        lines.push("");
      }
      lines.push("");
    }
  }

  const text = lines.join("\n");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="news-alert-${timestamp}.txt"`);
  res.send(text);
});

// --- API: 历史新闻（浏览/搜索/收藏） ---
app.get("/api/history", (req, res) => {
  try {
    const result = queryHistoryItems({
      q: req.query.q,
      page: req.query.page,
      pageSize: req.query.pageSize,
      favoritesOnly: req.query.favoritesOnly,
      group: req.query.group,
      source: req.query.source,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/history/favorite", (req, res) => {
  try {
    const { id, favorite } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: "缺少新闻ID" });
    const updated = setHistoryFavorite(String(id), Boolean(favorite));
    if (!updated) return res.status(404).json({ ok: false, error: "历史新闻不存在" });
    res.json({ ok: true, item: updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: 配置读取/保存 ---
app.get("/api/config", (req, res) => {
  const config = getConfig();
  const maskedHeadlessCredentials = Object.fromEntries(
    Object.entries(config.headlessCredentials || {}).map(([key, value]) => [
      key,
      {
        ...value,
        email: value?.email ? "***" : "",
        password: value?.password ? "***" : "",
      },
    ])
  );
  const safeConfig = {
    ...config,
    ai: { ...config.ai, apiKey: config.ai.apiKey ? "***" : "" },
    email: { ...config.email, senderPassword: config.email.senderPassword ? "***" : "" },
    headlessCredentials: maskedHeadlessCredentials,
  };
  res.json({ ok: true, config: safeConfig, promptDefaults: DEFAULT_PROMPTS });
});

const ALLOWED_CONFIG_KEYS = new Set([
  "ai", "email", "sources", "complianceSources",
  "recipientGroups", "schedules", "schedule", "webhook", "headlessCredentials", "prompts",
]);

app.post("/api/config", (req, res) => {
  try {
    const newConfig = req.body;
    for (const key of Object.keys(newConfig)) {
      if (!ALLOWED_CONFIG_KEYS.has(key)) delete newConfig[key];
    }
    if (newConfig.ai?.apiKey === "***") delete newConfig.ai.apiKey;
    if (newConfig.email?.senderPassword === "***") delete newConfig.email.senderPassword;
    if (newConfig.headlessCredentials) {
      for (const value of Object.values(newConfig.headlessCredentials)) {
        if (value?.email === "***") delete value.email;
        if (value?.password === "***") delete value.password;
      }
    }
    if (newConfig.prompts) {
      const newsErr = validatePromptTemplate(newConfig.prompts.newsTop10Prompt, {
        fieldName: "新闻 Top10 Prompt",
        kind: "news",
      });
      if (newsErr) {
        return res.status(400).json({ ok: false, error: newsErr });
      }
      const compErr = validatePromptTemplate(newConfig.prompts.complianceTop10Prompt, {
        fieldName: "合规 Top10 Prompt",
        kind: "compliance",
      });
      if (compErr) {
        return res.status(400).json({ ok: false, error: compErr });
      }
    }

    saveConfig(newConfig);
    if (newConfig.prompts) {
      state.digest = latestDigest = [];
      state.complianceDigest = latestComplianceDigest = [];
      state.complianceCommunityPulse = latestComplianceCommunityPulse = null;
    }
    if (newConfig.sources) {
      state.news = latestNews = [];
      clearNewsDigestState();
    }
    if (newConfig.complianceSources) {
      state.complianceNews = latestComplianceNews = [];
      clearComplianceDigestState();
    }

    if (newConfig.email) resetTransporter();
    if (newConfig.schedules) {
      scheduler.reloadAll();
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/webhook/test", async (req, res) => {
  try {
    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const result = await sendComplianceDigestWebhook({
      taskName: "手动测试",
      fetchTime: now,
      complianceDigest: [{
        rank: 1,
        title: "Webhook 测试消息",
        summary: "这是一条用于验证飞书 Webhook 的测试消息。",
      }],
      communityPulse: {
        conclusion: "测试通过后，可在定时任务中自动发送合规 AI 总结。",
        findings: [],
      },
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: 收件人组 CRUD ---
app.get("/api/recipient-groups", (req, res) => {
  const config = getConfig();
  res.json({ ok: true, groups: config.recipientGroups || [] });
});

app.post("/api/recipient-groups", (req, res) => {
  try {
    const group = req.body;
    if (!group.name) return res.status(400).json({ ok: false, error: "缺少组名称" });
    group.id = group.id || `grp_${randomUUID().slice(0, 8)}`;
    group.emails = group.emails || [];
    group.color = group.color || "#2563eb";

    const config = getConfig();
    const groups = config.recipientGroups || [];
    groups.push(group);
    saveConfig({ recipientGroups: groups });
    res.json({ ok: true, group });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/recipient-groups/:id", (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const config = getConfig();
    const groups = config.recipientGroups || [];
    const idx = groups.findIndex((g) => g.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: "组不存在" });

    groups[idx] = { ...groups[idx], ...updates, id };
    saveConfig({ recipientGroups: groups });
    res.json({ ok: true, group: groups[idx] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/recipient-groups/:id", (req, res) => {
  try {
    const { id } = req.params;
    const config = getConfig();
    const groups = config.recipientGroups || [];
    if (!groups.find((g) => g.id === id)) {
      return res.status(404).json({ ok: false, error: "组不存在" });
    }
    saveConfig({ recipientGroups: groups.filter((g) => g.id !== id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: 定时任务 CRUD ---
app.get("/api/schedules", (req, res) => {
  const config = getConfig();
  res.json({ ok: true, schedules: config.schedules || [] });
});

function isValidCron(expr) {
  if (typeof expr !== "string") return false;
  const parts = expr.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 6;
}

app.post("/api/schedules", (req, res) => {
  try {
    const task = req.body;
    if (!task.name || !task.cron) {
      return res.status(400).json({ ok: false, error: "缺少任务名称或执行时间" });
    }
    if (!isValidCron(task.cron)) {
      return res.status(400).json({ ok: false, error: "Cron 表达式格式无效" });
    }
    task.id = task.id || `task_${randomUUID().slice(0, 8)}`;
    task.locked = task.locked || false;
    if (task.sendComplianceWebhook === undefined) task.sendComplianceWebhook = true;
    task.lastRun = null;
    task.lastStatus = null;

    const config = getConfig();
    const schedules = config.schedules || [];
    schedules.push(task);
    saveConfig({ schedules });
    scheduler.reloadAll();
    res.json({ ok: true, task });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/schedules/:id", (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const config = getConfig();
    const schedules = config.schedules || [];
    const idx = schedules.findIndex((t) => t.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: "任务不存在" });

    schedules[idx] = { ...schedules[idx], ...updates, id };
    saveConfig({ schedules });
    scheduler.reloadAll();
    res.json({ ok: true, task: schedules[idx] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete("/api/schedules/:id", (req, res) => {
  try {
    const { id } = req.params;
    const config = getConfig();
    const schedules = config.schedules || [];
    const task = schedules.find((t) => t.id === id);
    if (!task) return res.status(404).json({ ok: false, error: "任务不存在" });
    if (task.locked) return res.status(403).json({ ok: false, error: "该任务已锁定，请先解锁" });

    saveConfig({ schedules: schedules.filter((t) => t.id !== id) });
    scheduler.reloadAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: MCP 服务管理 ---
app.get("/api/mcp/status", (req, res) => {
  res.json({ ok: true, ...mcpClient.getStatus() });
});

app.post("/api/mcp/start", async (req, res) => {
  try {
    await mcpClient.connect();
    res.json({ ok: true, message: "MCP 已启动" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/mcp/stop", async (req, res) => {
  try {
    await mcpClient.disconnect();
    res.json({ ok: true, message: "MCP 已停止" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/mcp/restart", async (req, res) => {
  try {
    await mcpClient.reconnect();
    res.json({ ok: true, message: "MCP 已重启" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: 开机自启（通过启动文件夹） ---
function getStartupShortcutPath() {
  const startupDir = path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  return path.join(startupDir, WINDOWS_AUTOSTART_SCRIPT_NAME);
}

function readServiceHostPid() {
  if (!fs.existsSync(SERVICE_HOST_PID_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(SERVICE_HOST_PID_FILE, "utf-8"));
    const pid = Number(parsed.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getBackgroundServiceStatus() {
  const pid = readServiceHostPid();
  const running = isProcessAlive(pid);
  return {
    running,
    pid: running ? pid : null,
    autostartEnabled: fs.existsSync(getStartupShortcutPath()),
    logFiles: {
      autostart: fs.existsSync(AUTOSTART_LOG),
      stdout: fs.existsSync(SERVICE_STDOUT_LOG),
      stderr: fs.existsSync(SERVICE_STDERR_LOG),
    },
  };
}

function startBackgroundHost() {
  const launcher = path.join(PROJECT_DIR, "run-background.vbs");
  if (!fs.existsSync(launcher)) {
    throw new Error("后台启动脚本不存在");
  }

  const child = spawn("wscript.exe", [launcher], {
    cwd: PROJECT_DIR,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function tailLogFile(filePath, lines = 120) {
  if (!fs.existsSync(filePath)) return "";
  const buffer = fs.readFileSync(filePath);
  let raw = "";
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    raw = buffer.slice(2).toString("utf16le");
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    raw = buffer.slice(2).swap16().toString("utf16le");
  } else if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    raw = buffer.slice(3).toString("utf8");
  } else {
    raw = buffer.toString("utf8");
  }
  return raw.split(/\r?\n/).slice(-Math.max(1, Number(lines) || 120)).join("\n").trim();
}

function tailLogFiles(filePaths, lines = 120) {
  return (filePaths || [])
    .map((filePath) => tailLogFile(filePath, lines))
    .filter(Boolean)
    .join("\n");
}

function scheduleCurrentProcessExit({ stopHost = false } = {}) {
  if (stopHost) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.writeFileSync(SERVICE_STOP_FLAG_FILE, new Date().toISOString(), "utf-8");
  }

  setTimeout(() => {
    process.exit(0);
  }, 400);
}

app.get("/api/autostart/status", (req, res) => {
  try {
    res.json({
      ok: true,
      enabled: fs.existsSync(getStartupShortcutPath()),
      logFile: fs.existsSync(AUTOSTART_LOG) ? AUTOSTART_LOG : "",
    });
  } catch {
    res.json({ ok: true, enabled: false });
  }
});

app.post("/api/autostart/enable", (req, res) => {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    writeWindowsStartupVbs(getStartupShortcutPath(), PROJECT_DIR);
    startBackgroundHost();
    res.json({
      ok: true,
      message: "已设置开机自启，并已请求启动后台守护进程，请查看启动日志确认健康状态",
      logFile: AUTOSTART_LOG,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/autostart/disable", (req, res) => {
  try {
    const target = getStartupShortcutPath();
    if (fs.existsSync(target)) fs.unlinkSync(target);
    res.json({ ok: true, message: "已取消开机自启" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/service/status", (req, res) => {
  try {
    res.json({ ok: true, service: getBackgroundServiceStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/service/start", (req, res) => {
  try {
    startBackgroundHost();
    res.json({ ok: true, message: "已请求启动后台守护进程，请查看日志确认健康状态", logFile: AUTOSTART_LOG });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/service/stop", (req, res) => {
  try {
    const status = getBackgroundServiceStatus();
    res.on("finish", () => {
      scheduleCurrentProcessExit({ stopHost: true });
    });
    res.json({
      ok: true,
      message: status.running
        ? "后台守护进程正在停止，当前页面会失去连接"
        : "当前服务正在停止；如需恢复，请重新启动后台服务",
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/service/restart", (req, res) => {
  try {
    const status = getBackgroundServiceStatus();
    if (!status.running) {
      startBackgroundHost();
      return res.json({ ok: true, message: "后台守护进程未运行，现已请求启动，请查看日志确认健康状态", logFile: AUTOSTART_LOG });
    }
    res.on("finish", () => {
      scheduleCurrentProcessExit();
    });
    res.json({ ok: true, message: "后台守护进程正在重启，页面会短暂断开后恢复" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/service/logs", (req, res) => {
  try {
    const lines = Math.min(400, Math.max(20, Number(req.query.lines) || 120));
    res.json({
      ok: true,
      autostart: tailLogFiles([AUTOSTART_VBS_LOG, AUTOSTART_LOG], lines),
      stdout: tailLogFile(SERVICE_STDOUT_LOG, lines),
      stderr: tailLogFile(SERVICE_STDERR_LOG, lines),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API: 系统状态 ---
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    scheduler: scheduler.getStatus(),
    newsCount: latestNews.length,
    mcp: mcpClient.getStatus(),
    service: getBackgroundServiceStatus(),
  });
});

// --- Startup ---
async function start() {
  try {
    console.log("[Server] Connecting to MCP server...");
    await Promise.race([
      mcpClient.connect(),
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error(`MCP connection timed out after ${MCP_CONNECT_TIMEOUT_MS / 1000}s`)),
          MCP_CONNECT_TIMEOUT_MS
        );
      }),
    ]);
    scheduler.initFromConfig();

    app.listen(PORT, () => {
      console.log(`[Server] News Alert running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("[Server] Startup error:", err.message);
    console.log("[Server] Starting without MCP connection. Will retry on first request.");
    scheduler.initFromConfig();
    app.listen(PORT, () => {
      console.log(`[Server] News Alert running at http://localhost:${PORT} (MCP offline)`);
    });
  }
}

start();
