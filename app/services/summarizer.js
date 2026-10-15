import { getConfig } from "./config.js";
import { DEFAULT_PROMPTS, renderPromptTemplate, validatePromptTemplate } from "./prompt-templates.js";

function getAIConfig() {
  const config = getConfig();
  const { baseUrl, modelName, apiKey } = config.ai;
  if (!baseUrl || !modelName || !apiKey) {
    throw new Error("AI 配置不完整，请在设置中填写 Base URL、Model Name 和 API Key");
  }
  return { baseUrl, modelName, apiKey };
}

function getDigestPromptTemplate(kind) {
  const config = getConfig();
  const key = kind === "compliance" ? "complianceTop10Prompt" : "newsTop10Prompt";
  const template = config.prompts?.[key] || DEFAULT_PROMPTS[key];
  const validationError = validatePromptTemplate(template, { fieldName: key, kind });
  if (validationError) throw new Error(validationError);
  return template;
}

const AI_RETRY_CODES = new Set([429, 503, 502, 500]);
const AI_MAX_RETRIES = 2;

async function callAI(baseUrl, modelName, apiKey, prompt, onProgress) {
  const url = baseUrl.replace(/\/+$/, "") + "/v1/chat/completions";
  const useStream = typeof onProgress === "function";

  const body = {
    model: modelName,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.15,
    top_p: 0.85,
    max_tokens: 4096,
    stream: useStream,
  };

  let lastError;
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = 1000 * 2 ** (attempt - 1);
      console.warn(`[Summarizer] Retry ${attempt}/${AI_MAX_RETRIES} after ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const errText = (await resp.text()).slice(0, 500);
      lastError = new Error(`AI API 请求失败 (${resp.status}): ${errText}`);
      if (AI_RETRY_CODES.has(resp.status) && attempt < AI_MAX_RETRIES) continue;
      throw lastError;
    }

    if (!useStream) {
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || "";
    }

    let full = "";
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") { streamDone = true; break; }
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content || "";
          if (delta) {
            full += delta;
            onProgress(delta, full);
          }
        } catch (e) {
          console.warn("[Summarizer] Stream chunk parse error:", e.message, "payload:", payload.slice(0, 100));
        }
      }
    }
    return full;
  }
  throw lastError || new Error("AI API 请求失败：未知错误");
}

function sanitizeForPrompt(text) {
  return String(text || "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
}

function validateDigestItem(item, index) {
  const hasTitle = !!(item.titleZh || item.titleEn || item.title);
  const hasSummary = !!(item.summaryZh || item.summaryEn || item.summary);
  if (!hasTitle || !hasSummary) {
    console.warn(`[Summarizer] Schema warning: item ${index} missing ${!hasTitle ? "title" : "summary"} fields, raw keys: [${Object.keys(item).join(",")}]`);
  }
  return item;
}

function dedup(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = (it.title || "").trim().toLowerCase().slice(0, 60);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseJsonArray(content) {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) throw new Error("AI 返回格式异常");
  return JSON.parse(content.slice(start, end + 1));
}

function parseJsonObject(content) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("AI 返回对象格式异常");
  return JSON.parse(content.slice(start, end + 1));
}

const MATCH_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "will", "are", "was", "were",
  "has", "have", "had", "its", "their", "his", "her", "our", "your", "about", "after", "before",
  "under", "over", "amid", "what", "when", "where", "how", "why", "you", "they", "them", "than",
  "new", "latest", "today", "news", "top", "hot", "breaking", "guide", "report", "update", "global",
  "into", "onto", "across", "through",
  "的", "了", "和", "是", "在", "与", "及", "对", "将", "等", "中", "上", "下", "后", "前", "新", "最新", "今日",
]);

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/;

function normalizeMatchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\w\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\s]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMatchTokens(text) {
  const normalized = normalizeMatchText(text);
  const tokens = new Set();

  for (const word of normalized.split(/\s+/)) {
    if (!word || MATCH_STOPWORDS.has(word)) continue;
    if (/^[a-z]+$/.test(word) && word.length < 3) continue;

    if (CJK_RE.test(word)) {
      const cjkChars = word.replace(/[^\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/g, "");
      for (let i = 0; i < cjkChars.length - 1; i++) {
        const bigram = cjkChars.slice(i, i + 2);
        if (![...bigram].some((ch) => MATCH_STOPWORDS.has(ch))) {
          tokens.add(bigram);
        }
      }
      const latin = word.replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/g, " ").trim();
      if (latin && latin.length >= 3 && !MATCH_STOPWORDS.has(latin)) tokens.add(latin);
    } else {
      tokens.add(word);
    }
  }

  return [...tokens];
}

function formatOriginalSourceLabel(item) {
  return (item._source || "")
    .replace("get_", "")
    .replace("compliance_", "")
    .replace(/_/g, " ")
    .trim();
}

function buildRelatedItemsForDigestItem(digestItem, originalItems, hintItem = {}) {
  if (!Array.isArray(originalItems) || originalItems.length === 0) return [];

  const hintIndex = Number.isInteger(hintItem.refIndex)
    ? hintItem.refIndex
    : Number.parseInt(hintItem.refIndex, 10);
  const hintLink = typeof hintItem.url === "string" ? hintItem.url.trim() : "";

  const titleTokens = extractMatchTokens(digestItem.title);
  const titleTokenSet = new Set(titleTokens);
  const summaryOnlyTokens = extractMatchTokens(digestItem.summary)
    .filter((t) => !titleTokenSet.has(t))
    .slice(0, 20);

  const MIN_ABSOLUTE_SCORE = 18;
  const MIN_TITLE_HITS = 2;
  const RELATIVE_THRESHOLD = 0.25;

  const scored = originalItems
    .map((item, index) => {
      if (!item?.link || item.link === "#") return null;

      const titleNorm = normalizeMatchText(item.title);
      const descNorm = normalizeMatchText(item.summary || item.description);

      let textScore = 0;
      let hintBonus = 0;
      let titleHitCount = 0;
      const isHintMatch = (hintLink && item.link === hintLink) ||
        (Number.isFinite(hintIndex) && index + 1 === hintIndex);

      if (hintLink && item.link === hintLink) hintBonus += 120;
      if (Number.isFinite(hintIndex) && index + 1 === hintIndex) hintBonus += 80;

      for (const token of titleTokens) {
        if (titleNorm.includes(token)) { textScore += 10; titleHitCount++; }
        else if (descNorm.includes(token)) { textScore += 3; }
      }
      for (const token of summaryOnlyTokens) {
        if (titleNorm.includes(token)) { textScore += 4; titleHitCount++; }
        else if (descNorm.includes(token)) { textScore += 1; }
      }

      const passesThreshold = isHintMatch ||
        (textScore >= MIN_ABSOLUTE_SCORE && titleHitCount >= MIN_TITLE_HITS);

      if (!passesThreshold) return null;

      return {
        index,
        score: textScore + hintBonus,
        textScore,
        titleHitCount,
        title: item.title || "无标题",
        link: item.link,
        source: formatOriginalSourceLabel(item),
        region: item._region || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (scored.length === 0) return [];

  const bestTextScore = Math.max(...scored.map((s) => s.textScore));
  const relativeFloor = Math.max(bestTextScore * RELATIVE_THRESHOLD, MIN_ABSOLUTE_SCORE);

  const picked = [];
  const seen = new Set();

  for (const candidate of scored) {
    if (candidate.score < relativeFloor) break;
    const dedupeKey = `${candidate.link}::${candidate.title}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    picked.push({
      title: candidate.title,
      link: candidate.link,
      source: candidate.source,
      region: candidate.region,
    });
    if (picked.length >= 3) break;
  }

  return picked;
}

function attachRelatedItems(digestItems, originalItems, hintDigestItems = []) {
  return digestItems.map((item, index) => {
    const relatedItems = buildRelatedItemsForDigestItem(item, originalItems, hintDigestItems[index] || {});
    return {
      ...item,
      link: item.link || relatedItems[0]?.link || "",
      relatedItems,
    };
  });
}

function matchLinksToDigest(digestItems, originalItems) {
  if (!originalItems || originalItems.length === 0) return digestItems;
  return digestItems.map((d) => {
    if (d.link) return d;
    const titleWords = (d.title || "")
      .toLowerCase()
      .replace(/[^\w\u3400-\u9fff\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    let bestMatch = null;
    let bestScore = 0;
    for (const item of originalItems) {
      if (!item.link || item.link === "#") continue;
      const itemTitle = (item.title || "").toLowerCase();
      let score = 0;
      for (const word of titleWords) {
        if (itemTitle.includes(word)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    }
    if (bestMatch && bestScore >= 2) {
      return { ...d, link: bestMatch.link };
    }
    return d;
  });
}

function containsChinese(text) {
  return /[\u3400-\u9fff]/.test(text || "");
}

function containsEnglish(text) {
  return /[A-Za-z]/.test(text || "");
}

function isBilingualText(text) {
  const value = (text || "").trim();
  return Boolean(value) && containsChinese(value) && containsEnglish(value);
}

function pickText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function formatBilingualTitle(item) {
  const zh = pickText(item.titleZh, item.title_zh, item.titleCN, item.title_cn);
  const en = pickText(item.titleEn, item.title_en, item.titleEN, item.title_en_us);
  const fallback = pickText(item.title);
  if (zh && en) return `${zh} / ${en}`;
  return pickText(fallback, zh, en, "无标题");
}

function formatBilingualSummary(item) {
  const zh = pickText(item.summaryZh, item.summary_zh, item.summaryCN, item.summary_cn);
  const en = pickText(item.summaryEn, item.summary_en, item.summaryEN, item.summary_en_us);
  const fallback = pickText(item.summary);
  if (zh && en) return `${zh} EN: ${en}`;
  return pickText(fallback, zh, en, "摘要生成失败");
}

function needsBilingualNormalization(items) {
  return items.some((item) => !isBilingualText(item.title) || !isBilingualText(item.summary));
}

function mapNewsDigestItems(digest, linkMap) {
  return digest.slice(0, 10).map((item, index) => {
    let link = item.url || "";
    if (!link && item.refIndex != null && linkMap) {
      link = linkMap.get(item.refIndex) || "";
    }
    return {
      rank: item.rank || index + 1,
      title: formatBilingualTitle(item),
      summary: formatBilingualSummary(item),
      sources: item.sources,
      link,
      relatedItems: [],
      _type: "digest",
    };
  });
}

function mapComplianceDigestItems(digest, linkMap) {
  return digest.slice(0, 10).map((item, index) => {
    let link = item.url || "";
    if (!link && item.refIndex != null && linkMap) {
      link = linkMap.get(item.refIndex) || "";
    }
    return {
      rank: item.rank || index + 1,
      title: formatBilingualTitle(item),
      summary: formatBilingualSummary(item),
      sources: item.sources,
      region: item.region || "",
      link,
      relatedItems: [],
      _type: "compliance_digest",
    };
  });
}

function buildLinkMap(items) {
  const map = new Map();
  items.forEach((item, i) => {
    const idx = i + 1;
    if (item.link && item.link !== "#") map.set(idx, item.link);
  });
  return map;
}

async function normalizeDigestBilingual(items, { baseUrl, modelName, apiKey, kind, emit }) {
  const example = kind === "compliance"
    ? '{"rank":1,"title":"中文标题 / English Title","summary":"中文摘要 EN: English summary","region":"涉及地区","sources":"来源1,来源2"}'
    : '{"rank":1,"title":"中文标题 / English Title","summary":"中文摘要 EN: English summary","sources":"来源1,来源2"}';

  emit?.("status", "检测到非双语结果，正在自动规范为中英双语...");

  const prompt = `你是资深双语新闻编辑。请将下面 JSON 数组中的 title 和 summary 统一改写为中英双语格式，并保持其他字段不变。

输出要求：
1. 只返回 JSON 数组，不要 markdown，不要解释
2. title 必须是 "中文标题 / English Title"
3. summary 必须先中文、后英文，格式为 "中文摘要 EN: English summary"
4. 中文必须自然准确，不能只是复制英文；英文也必须完整可读
5. 保持 rank、sources、region 等字段原值不变

返回示例：
${example}

原始 JSON：
${JSON.stringify(items)}`;

  try {
    const content = await callAI(baseUrl, modelName, apiKey, prompt);
    return parseJsonArray(content).slice(0, 10);
  } catch (err) {
    console.warn(`[Summarizer] ${kind} bilingual normalization failed:`, err.message);
    return items;
  }
}

/**
 * Top 10 热点摘要 — 流式版本，支持 SSE 推送进度。
 * @param {Array} newsItems
 * @param {function} [onProgress] - (event: {type, data}) => void
 */
export async function digestTop10(newsItems, onProgress) {
  const { baseUrl, modelName, apiKey } = getAIConfig();

  const emit = (type, data) => onProgress?.({ type, data });

  emit("status", "正在预处理新闻数据...");

  const unique = dedup(newsItems);
  const cappedItems = unique.slice(0, 500);

  emit("status", `去重后 ${unique.length} 条，取前 ${cappedItems.length} 条分析`);

  const linkMap = buildLinkMap(cappedItems);
  const titleList = cappedItems
    .map((item, i) => {
      const source = (item._source || "").replace("get_", "").replace(/_/g, " ");
      const url = item.link && item.link !== "#" ? ` | ${item.link}` : "";
      return `${i + 1}. [${source}] ${sanitizeForPrompt(item.title || "无标题")}${url}`;
    })
    .join("\n");

  const prompt = renderPromptTemplate(getDigestPromptTemplate("news"), cappedItems.length, titleList);

  console.log(`[Summarizer] Digest: ${cappedItems.length} items (deduped from ${newsItems.length}), prompt ~${prompt.length} chars`);

  emit("status", "正在调用 AI 分析（流式）...");

  let charCount = 0;
  const content = await callAI(baseUrl, modelName, apiKey, prompt, (delta, full) => {
    charCount += delta.length;
    if (charCount % 50 < delta.length) {
      emit("progress", `AI 已生成 ${charCount} 字符...`);
    }
  });

  emit("status", "AI 返回完成，正在解析结果...");

  try {
    const rawDigestHints = parseJsonArray(content).map(validateDigestItem);
    let digest = rawDigestHints;
    let result = mapNewsDigestItems(digest, linkMap);

    if (needsBilingualNormalization(result)) {
      digest = await normalizeDigestBilingual(result, {
        baseUrl,
        modelName,
        apiKey,
        kind: "news",
        emit,
      });
      result = mapNewsDigestItems(digest, linkMap);
    }

    result = attachRelatedItems(result, cappedItems, rawDigestHints);
    emit("done", `完成！共 ${result.length} 条摘要`);
    return result;
  } catch (parseErr) {
    console.error("[Summarizer] Digest parse error:", parseErr.message, "\nRaw:", content.substring(0, 500));
    throw new Error("AI 返回格式解析失败，请重试");
  }
}

/**
 * 合规 Top 10 — DPO 视角，聚焦隐私立法与执法动态
 */
export async function digestComplianceTop10(newsItems, onProgress) {
  const { baseUrl, modelName, apiKey } = getAIConfig();

  const emit = (type, data) => onProgress?.({ type, data });

  emit("status", "正在预处理合规数据...");

  const unique = dedup(newsItems);
  const cappedItems = unique.slice(0, 300);

  emit("status", `去重后 ${unique.length} 条，取前 ${cappedItems.length} 条分析`);

  const linkMap = buildLinkMap(cappedItems);
  const titleList = cappedItems
    .map((item, i) => {
      const source = (item._source || "").replace("compliance_", "").replace(/_/g, " ");
      const region = item._region ? `[${item._region}]` : "";
      const url = item.link && item.link !== "#" ? ` | ${item.link}` : "";
      return `${i + 1}. ${region}[${source}] ${sanitizeForPrompt(item.title || "无标题")}${url}`;
    })
    .join("\n");

  const prompt = renderPromptTemplate(getDigestPromptTemplate("compliance"), cappedItems.length, titleList);

  console.log(`[Summarizer] Compliance Digest: ${cappedItems.length} items (deduped from ${newsItems.length}), prompt ~${prompt.length} chars`);

  emit("status", "正在调用 AI 分析合规动态...");

  let charCount = 0;
  const content = await callAI(baseUrl, modelName, apiKey, prompt, (delta) => {
    charCount += delta.length;
    if (charCount % 50 < delta.length) {
      emit("progress", `AI 已生成 ${charCount} 字符...`);
    }
  });

  emit("status", "AI 返回完成，正在解析结果...");

  try {
    const rawDigestHints = parseJsonArray(content).map(validateDigestItem);
    let digest = rawDigestHints;
    let result = mapComplianceDigestItems(digest, linkMap);

    if (needsBilingualNormalization(result)) {
      digest = await normalizeDigestBilingual(result, {
        baseUrl,
        modelName,
        apiKey,
        kind: "compliance",
        emit,
      });
      result = mapComplianceDigestItems(digest, linkMap);
    }

    result = attachRelatedItems(result, cappedItems, rawDigestHints);
    emit("done", `完成！共 ${result.length} 条合规摘要`);
    return result;
  } catch (parseErr) {
    console.error("[Summarizer] Compliance digest parse error:", parseErr.message, "\nRaw:", content.substring(0, 500));
    throw new Error("AI 返回格式解析失败，请重试");
  }
}

export async function summarizeComplianceCommunityPulse(newsItems, onProgress) {
  const emit = (type, data) => onProgress?.({ type, data });
  const communityItems = (newsItems || []).filter((item) => {
    const source = String(item._source || "").toLowerCase();
    const text = `${item.title || ""} ${item.summary || ""} ${item.description || ""} ${item.link || ""}`.toLowerCase();
    const isCommunitySource =
      source.includes("forum_bambulab") ||
      source.includes("facebook_bambulab") ||
      source.includes("reddit_bambulab") ||
      source.includes("google_search_bambulab");
    return isCommunitySource || (text.includes("bambu") && (text.includes("privacy") || text.includes("security")));
  });

  if (communityItems.length === 0) {
    return {
      hasDiscussion: false,
      conclusion: "近期未发现针对 Bambu Lab 隐私或安全的社区讨论。",
      findings: [],
    };
  }

  const { baseUrl, modelName, apiKey } = getAIConfig();
  const capped = dedup(communityItems).slice(0, 120);
  emit("status", `正在分析社区舆情（样本 ${capped.length} 条）...`);

  const listText = capped
    .map((item, i) => {
      const source = (item._source || "").replace("compliance_", "").replace(/_/g, " ");
      const link = item.link && item.link !== "#" ? item.link : "";
      return `${i + 1}. [${source}] ${sanitizeForPrompt(item.title || "无标题")} | ${link}`;
    })
    .join("\n");

  const prompt = `你是隐私与安全情报分析师。请根据下面的社区帖子/讨论链接，判断近期是否存在针对 Bambu Lab 的隐私或安全讨论。

输出要求：
1) 仅返回 JSON 对象，不要 markdown，不要解释
2) JSON 结构：
{
  "hasDiscussion": true/false,
  "conclusionZh": "一句中文结论",
  "conclusionEn": "One-line English conclusion",
  "findings": [
    {"source":"来源站点","topic":"讨论主题中文","details":"讨论要点（中文，1-2句）","link":"原始链接"}
  ]
}
3) 若没有有效讨论，hasDiscussion=false，findings 为空数组
4) findings 最多 5 条，link 必须来自输入列表，不得编造

输入列表：
${listText}`;

  const content = await callAI(baseUrl, modelName, apiKey, prompt);
  try {
    const parsed = parseJsonObject(content);
    const findings = Array.isArray(parsed.findings)
      ? parsed.findings
        .map((item) => ({
          source: pickText(item.source, "Unknown"),
          topic: pickText(item.topic, "社区讨论"),
          details: pickText(item.details, ""),
          link: pickText(item.link, ""),
        }))
        .filter((item) => item.link && item.link !== "#")
        .slice(0, 5)
      : [];

    const conclusion = pickText(
      parsed.conclusionZh,
      parsed.conclusion,
      parsed.conclusionEn,
      parsed.hasDiscussion ? "近期存在针对 Bambu Lab 隐私或安全的社区讨论。" : "近期未发现针对 Bambu Lab 隐私或安全的社区讨论。"
    );

    return {
      hasDiscussion: Boolean(parsed.hasDiscussion && findings.length > 0),
      conclusion,
      findings,
    };
  } catch (err) {
    console.error("[Summarizer] Community pulse parse error:", err.message);
    const fallback = capped.slice(0, 3).map((item) => ({
      source: (item._source || "").replace("compliance_", "").replace(/_/g, " "),
      topic: item.title || "社区讨论",
      details: "检测到与 Bambu Lab 隐私或安全相关的社区信息，请人工复核。",
      link: item.link || "",
    })).filter((it) => it.link);

    return {
      hasDiscussion: fallback.length > 0,
      conclusion: fallback.length > 0
        ? "近期检测到 Bambu Lab 隐私/安全相关社区讨论，建议人工复核重点帖子。"
        : "近期未发现针对 Bambu Lab 隐私或安全的社区讨论。",
      findings: fallback,
    };
  }
}

/**
 * 逐条摘要（保留原有功能）
 */
export async function summarizeNews(newsItems) {
  const { baseUrl, modelName, apiKey } = getAIConfig();

  const BATCH_SIZE = 15;
  const batches = [];
  for (let i = 0; i < newsItems.length; i += BATCH_SIZE) {
    batches.push(newsItems.slice(i, i + BATCH_SIZE));
  }

  const allSummaries = [];
  for (const batch of batches) {
    const summaries = await summarizeBatch(batch, baseUrl, modelName, apiKey);
    allSummaries.push(...summaries);
  }
  return allSummaries;
}

async function summarizeBatch(items, baseUrl, modelName, apiKey) {
  const newsText = items
    .map((item, i) => {
      const parts = [`[${i + 1}] 标题: ${item.title || "无标题"}`];
      if (item.description) parts.push(`描述: ${item.description}`);
      if (item._source) parts.push(`来源: ${item._source}`);
      return parts.join("\n");
    })
    .join("\n\n");

  const prompt = `你是一位专业的新闻编辑。请对以下新闻逐条进行摘要，每条新闻用1-2句话概括核心要点。

要求：
1. 保持客观准确，提炼最关键的信息
2. 用中文输出
3. 严格按JSON数组格式返回，每个元素包含 index(序号)、title(原标题)、summary(摘要)

新闻列表：
${newsText}

请直接返回JSON数组，不要包含其他内容：`;

  const content = await callAI(baseUrl, modelName, apiKey, prompt);

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("AI 返回格式异常");

    const summaries = JSON.parse(jsonMatch[0]);

    return items.map((item, i) => {
      const matched = summaries.find((s) => s.index === i + 1);
      return {
        ...item,
        summary: matched?.summary || "摘要生成失败",
      };
    });
  } catch (parseErr) {
    console.error("[Summarizer] Parse error:", parseErr.message);
    return items.map((item) => ({
      ...item,
      summary: "摘要生成失败：AI 返回格式异常",
    }));
  }
}
