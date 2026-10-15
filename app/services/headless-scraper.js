import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getConfig } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE_DIR = path.resolve(__dirname, "../data/cookies");
const DATAGUIDANCE_BASE_URL = "https://www.dataguidance.com";
function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return normalizeText(String(value || "").replace(/<[^>]*>/g, " "));
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectDate(value) {
  if (!value) return "";
  const text = normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const parsedWithTime = new Date(text);
  if (
    Number.isFinite(parsedWithTime.getTime())
    && (/[T:]/.test(text) || /\b(?:GMT|UTC)\b/i.test(text) || /[+-]\d{2}:?\d{2}\b/.test(text))
  ) {
    return parsedWithTime.toISOString();
  }

  const lower = text.toLowerCase();
  const relative = lower.match(/\b(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks)\s+ago\b/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const ms = unit.startsWith("minute")
      ? 60 * 1000
      : unit.startsWith("hour")
        ? 60 * 60 * 1000
        : unit.startsWith("day")
          ? 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - amount * ms).toISOString();
  }
  if (/\byesterday\b/i.test(text)) return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (/\btoday\b/i.test(text)) return new Date().toISOString();

  const iso = text.match(/(20\d{2})[-/._](\d{1,2})[-/._](\d{1,2})(?=[^0-9]|$)/);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0)).toISOString();
  }
  const dmy = text.match(/(\d{1,2})[-/._](\d{1,2})[-/._](20\d{2})(?=[^0-9]|$)/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0)).toISOString();
  }
  const textMonth = text.match(/\b(\d{1,2})\.?\s+([A-Za-z]+)\s+(20\d{2})\b/);
  if (textMonth) {
    const [, d, monthRaw, y] = textMonth;
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
    const month = monthMap[monthRaw.toLowerCase()];
    if (month) {
      return new Date(Date.UTC(Number(y), month - 1, Number(d), 0, 0, 0)).toISOString();
    }
  }
  const parsed = new Date(text);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  return "";
}

function extractMeaningfulDescription(text, title, dateText) {
  let value = normalizeText(text);
  if (!value) return "";
  if (title) value = value.replace(title, "").trim();
  if (dateText) value = value.replace(dateText, "").trim();
  value = value.replace(/\b(OPINION|ANALYSIS|FEATURE|NEWS|REPORT)\b/gi, "").trim();
  return value.length >= 24 ? value.slice(0, 320) : "";
}

export function resolveDataGuidanceContentUrl(value) {
  const href = String(value || "").trim();
  if (!href) return "";
  try {
    return new URL(href, DATAGUIDANCE_BASE_URL).href;
  } catch {
    return "";
  }
}

export function mapDataGuidanceApiArticles(entries) {
  const mapped = (Array.isArray(entries) ? entries : []).map((entry) => {
    const title = normalizeText(entry?.title?.en || entry?.title || "");
    const link = resolveDataGuidanceContentUrl(entry?.url || entry?.permalink || entry?.externalLink || "");
    const description = extractMeaningfulDescription(
      entry?.augmentation?.synopsis
        || entry?.contentBody?.text?.en
        || stripHtml(entry?.contentBody?.html?.en || "")
        || "",
      title,
      entry?.publishedOn || entry?.displayDate || ""
    );
    const publish_time = detectDate(entry?.publishedOn || entry?.displayDate || entry?.createdAt || "");
    const author = normalizeText(entry?.authority?.en || entry?.authority || "");
    return { title, link, description, publish_time, author };
  }).filter((item) => item.title && item.link);
  return dedupeBy(mapped, (item) => item.link);
}

async function importPuppeteer() {
  const mod = await import("puppeteer");
  return mod.default || mod;
}

async function ensureCookieDir() {
  await fs.mkdir(COOKIE_DIR, { recursive: true });
}

function getCookiePath(site) {
  return path.join(COOKIE_DIR, `${site}.json`);
}

async function loadCookies(site) {
  try {
    const raw = await fs.readFile(getCookiePath(site), "utf8");
    const cookies = JSON.parse(raw);
    return Array.isArray(cookies) ? cookies : [];
  } catch {
    return [];
  }
}

async function saveCookies(site, page) {
  await ensureCookieDir();
  const cookies = await page.cookies();
  await fs.writeFile(getCookiePath(site), JSON.stringify(cookies, null, 2), "utf8");
}

async function clearCookies(site) {
  try {
    await fs.unlink(getCookiePath(site));
  } catch {
    // ignore missing cookie files
  }
}

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1800 });
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(30000);
  return page;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function dismissCommonBanners(page) {
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
    const textMatchers = [/accept only necessary/i, /allow all/i, /accept/i, /close/i, /dismiss/i];
    for (const el of candidates) {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (textMatchers.some((rx) => rx.test(text))) {
        el.click();
        break;
      }
    }
  }).catch(() => {});
}

async function applyCookies(page, site, url) {
  const cookies = await loadCookies(site);
  if (!cookies.length) return false;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.setCookie(...cookies);
  await page.reload({ waitUntil: "networkidle2" });
  return true;
}

function getHeadlessCredentials(key) {
  return getConfig().headlessCredentials?.[key] || null;
}

async function loginDataGuidance(page, sourceConfig) {
  const credentials = getHeadlessCredentials(sourceConfig.credentialsKey || "dataguidance");
  if (!credentials?.email || !credentials?.password) {
    throw new Error("Missing DataGuidance headless credentials");
  }

  await page.goto(sourceConfig.loginUrl || "https://www.dataguidance.com/login", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });
  await dismissCommonBanners(page);
  await page.waitForSelector("#user_email, input[autocomplete='email']");

  await page.locator("#user_email, input[autocomplete='email']").fill(credentials.email);
  await page.locator("#user_password, input[autocomplete='current-password']").fill(credentials.password);
  await page.focus("#user_email, input[autocomplete='email']");
  await page.keyboard.press("Tab");
  await page.focus("#user_password, input[autocomplete='current-password']");
  await page.waitForFunction(() => {
    const email = document.querySelector("#user_email, input[autocomplete='email']");
    const password = document.querySelector("#user_password, input[autocomplete='current-password']");
    const form = email?.closest("form");
    const isValid = (el) => el && /\bng-valid\b/.test(el.className || "");
    return isValid(email) && isValid(password) && (!form || isValid(form));
  }, { timeout: 10000 }).catch(() => {});

  const waitForLoginResponse = () =>
    page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/portal/login")
        && response.request().method() === "POST",
      { timeout: 30000 }
    ).catch(() => null);

  let loginResponse = waitForLoginResponse();
  await page.focus("#user_password, input[autocomplete='current-password']");
  await page.keyboard.press("Enter");
  let response = await loginResponse;

  if (!response) {
    loginResponse = waitForLoginResponse();
    await page.evaluate(() => {
      const form = document.querySelector("form");
      const submitButton = document.querySelector("button[type='submit']");
      if (form && typeof form.requestSubmit === "function") form.requestSubmit(submitButton || undefined);
      else if (submitButton instanceof HTMLElement) submitButton.click();
    }).catch(() => {});
    response = await loginResponse;
  }

  if (response && response.status() >= 400) {
    throw new Error(`DataGuidance login failed with status ${response.status()}`);
  }

  await page.waitForFunction(() => !location.href.includes("/login"), { timeout: 30000 }).catch(() => {});

  await dismissCommonBanners(page);
  const stillOnLogin = page.url().includes("/login")
    && await page.$("#user_password, input[autocomplete='current-password']");
  if (stillOnLogin) {
    const inlineError = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[role='alert'], .error, .errors, .alert, .notice, [id*='Error']"))
        .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
        .find(Boolean) || ""
    ).catch(() => "");
    throw new Error(inlineError ? `DataGuidance login did not complete: ${inlineError}` : "DataGuidance login did not complete");
  }
  await saveCookies(sourceConfig.credentialsKey || "dataguidance", page);
}

async function ensureDataGuidanceSession(page, sourceConfig) {
  const cookieKey = sourceConfig.credentialsKey || "dataguidance";
  const usedCookies = await applyCookies(page, cookieKey, sourceConfig.loginUrl || "https://www.dataguidance.com/login");
  if (!usedCookies) {
    await page.goto(sourceConfig.loginUrl || "https://www.dataguidance.com/login", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
  }
  if (page.url().includes("/login")) {
    const hasPasswordField = await page.$("#user_password, input[autocomplete='current-password']");
    if (hasPasswordField) {
      await loginDataGuidance(page, sourceConfig);
    }
  }
}

async function enrichWithPublicFetch(items) {
  for (const item of items) {
    if (item.description && item.description.length >= 24) continue;
    try {
      const resp = await fetch(item.link, {
        headers: { "User-Agent": "NewsAlert/1.0" },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
        || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
      const paragraph = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((match) => stripHtml(match[1]))
        .find((text) => text.length >= 40 && !/^By\s/i.test(text));
      const timeText = [...html.matchAll(/<time[^>]*>([\s\S]*?)<\/time>/gi)]
        .map((match) => stripHtml(match[1]))
        .find(Boolean)
        || "";
      if (meta?.[1]) item.description = normalizeText(meta[1]).slice(0, 320);
      else if (paragraph) item.description = paragraph.slice(0, 320);
      if (!item.publish_time && timeText) item.publish_time = detectDate(timeText);
    } catch {
      // leave the item as-is
    }
  }
  return items;
}

async function scrapeIappNews(browser, sourceConfig) {
  const page = await createPage(browser);
  try {
    await page.goto(sourceConfig.url, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2000);

    let items = await page.evaluate((limit) => {
      const cards = Array.from(document.querySelectorAll("[data-testid='articleCard'], .chakra-linkbox"));
      const results = [];
      const seen = new Set();
      for (const card of cards) {
        const anchor = card.querySelector('a[href*="/news/a/"]');
        if (!anchor) continue;
        const href = anchor.href;
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const title = (card.querySelector("h3")?.textContent || anchor.textContent || "").replace(/\s+/g, " ").trim();
        const dateText = Array.from(card.querySelectorAll("p, span"))
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
          .find((text) => /\b20\d{2}\b/.test(text)) || "";
        const text = (card.innerText || "").replace(/\s+/g, " ").trim();
        const badge = card.querySelector("[data-testid*='badge']")?.textContent?.trim() || "";
        results.push({
          title,
          link: href,
          description: [badge].filter(Boolean).join(" "),
          publish_time: dateText,
          _rawSummary: text,
        });
        if (results.length >= limit) break;
      }
      return results;
    }, sourceConfig.limit || 20);

    items = items.map((item) => {
      const dateText = item.publish_time;
      return {
        title: item.title,
        link: item.link,
        description: extractMeaningfulDescription(item._rawSummary, item.title, dateText) || item.description,
        publish_time: detectDate(dateText),
      };
    });

    items = await enrichWithPublicFetch(items);
    return dedupeBy(items, (item) => item.link).slice(0, sourceConfig.limit || 20);
  } finally {
    await page.close().catch(() => {});
  }
}

function sortItemsByPublishTime(items) {
  items.sort((a, b) => {
    const aTs = a.publish_time ? new Date(a.publish_time).getTime() : 0;
    const bTs = b.publish_time ? new Date(b.publish_time).getTime() : 0;
    return bTs - aTs;
  });
  return items;
}

async function scrollDataGuidanceListing(page, linkPatterns) {
  let lastCount = -1;
  let stablePasses = 0;
  let passCount = 0;
  let maxUniqueLinks = 0;

  while (passCount < 8 && stablePasses < 2) {
    maxUniqueLinks = await page.evaluate((patterns) => {
      const normalized = Array.isArray(patterns) && patterns.length ? patterns : ["/news/", "/resource/", "/info/"];
      const unique = new Set();
      for (const anchor of document.querySelectorAll("a[href]")) {
        const href = anchor.href || "";
        if (normalized.some((pattern) => href.includes(pattern))) {
          unique.add(href);
        }
      }
      return unique.size;
    }, linkPatterns);

    if (maxUniqueLinks === lastCount) stablePasses += 1;
    else stablePasses = 0;
    lastCount = maxUniqueLinks;

    await page.evaluate(() => {
      window.scrollBy(0, Math.max(window.innerHeight, 900));
    }).catch(() => {});
    await sleep(1200);
    passCount += 1;
  }

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  return { passCount, maxUniqueLinks };
}

async function enrichDataGuidanceArticles(browser, sourceConfig, items, diagnostics) {
  const page = await createPage(browser);
  try {
    await ensureDataGuidanceSession(page, sourceConfig);
    for (const item of items) {
      const needsDate = !item.publish_time;
      const needsDescription = !item.description || item.description.length < 24;
      if (!needsDate && !needsDescription) continue;

      diagnostics.articleBackfillAttempts += 1;
      try {
        await page.goto(item.link, { waitUntil: "networkidle2", timeout: 60000 });
        await dismissCommonBanners(page);
        await sleep(1200);

        const articleData = await page.evaluate(() => {
          const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
          const collectTexts = (selector) =>
            Array.from(document.querySelectorAll(selector))
              .map((el) => normalize(el.getAttribute("content") || el.getAttribute("datetime") || el.textContent))
              .filter(Boolean);

          const descriptionCandidates = [
            ...collectTexts('meta[name="description"], meta[property="og:description"]'),
            ...collectTexts('[aria-label="Article introduction"]'),
            ...Array.from(document.querySelectorAll("article p, main p, .article p, .article-intro, .article-summary"))
              .map((el) => normalize(el.textContent))
              .filter((text) => text.length >= 40),
          ];

          const dateSignals = [
            ...collectTexts("time, [datetime]"),
            ...collectTexts('[aria-label*="date" i], [class*="date" i], [class*="time" i], [data-testid*="date" i]'),
            normalize(document.body?.innerText || "").slice(0, 2000),
          ];

          return {
            description: descriptionCandidates.find(Boolean) || "",
            dateSignals,
          };
        });

        const backfilledDate = detectDate(articleData.dateSignals.join(" | "));
        if (!item.publish_time && backfilledDate) {
          item.publish_time = backfilledDate;
          item._dateSource = "article";
          diagnostics.articleDateBackfills += 1;
        }
        if (needsDescription && articleData.description) {
          item.description = stripHtml(articleData.description).slice(0, 320);
        }
      } catch {
        diagnostics.articleBackfillFailures += 1;
      }
    }
  } finally {
    await page.close().catch(() => {});
  }
}

async function fetchDataGuidanceApiBatch(page, limit, offset = 0) {
  const result = await page.evaluate(async ({ batchLimit, batchOffset }) => {
    const apiUrl = new URL("/api/v1/kb/content/articles", location.origin);
    apiUrl.searchParams.set("limit", String(batchLimit));
    apiUrl.searchParams.set("article_types", "news_post");
    apiUrl.searchParams.set("order", "DESC_publishedOn");
    if (batchOffset > 0) apiUrl.searchParams.set("offset", String(batchOffset));

    const response = await fetch(apiUrl.toString(), { credentials: "include" });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      data: Array.isArray(json?.data) ? json.data : [],
      bodySnippet: String(text || "").slice(0, 500),
    };
  }, { batchLimit: limit, batchOffset: offset });

  if (!result.ok) {
    throw new Error(`DataGuidance articles API ${result.status}: ${result.bodySnippet}`);
  }
  return result.data;
}

async function fetchDataGuidanceApiArticles(page, sourceConfig, diagnostics) {
  const configuredLimit = Math.max(1, Number(sourceConfig.limit) || 20);
  const hardCap = Math.max(20, Math.min(configuredLimit, Number(sourceConfig.apiHardCap) || 200));
  const pageSize = Math.max(10, Math.min(hardCap, Number(sourceConfig.apiPageSize) || 100));
  const rawEntries = [];
  let offset = 0;
  let batches = 0;

  while (rawEntries.length < hardCap && batches < 10) {
    const remaining = hardCap - rawEntries.length;
    const batch = await fetchDataGuidanceApiBatch(page, Math.min(pageSize, remaining), offset);
    batches += 1;
    if (!batch.length) break;
    rawEntries.push(...batch);
    offset += batch.length;
    if (batch.length < Math.min(pageSize, remaining)) break;
  }

  diagnostics.apiFetch = true;
  diagnostics.apiBatches = batches;
  diagnostics.apiRawCount = rawEntries.length;
  return mapDataGuidanceApiArticles(rawEntries).slice(0, hardCap);
}

async function scrapeDataGuidanceNews(browser, sourceConfig) {
  const page = await createPage(browser);
  const diagnostics = {
    apiFetch: false,
    apiBatches: 0,
    apiRawCount: 0,
    articleBackfillAttempts: 0,
    articleBackfillFailures: 0,
    articleDateBackfills: 0,
    finalMissingDate: 0,
  };
  try {
    await ensureDataGuidanceSession(page, sourceConfig);
    let items = await fetchDataGuidanceApiArticles(page, sourceConfig, diagnostics);
    if (items.some((item) => !item.publish_time || !item.description)) {
      await enrichDataGuidanceArticles(browser, sourceConfig, items, diagnostics);
    }
    diagnostics.finalMissingDate = items.filter((item) => !item.publish_time).length;
    sortItemsByPublishTime(items);
    return {
      items: items.slice(0, sourceConfig.limit || 20),
      diagnostics,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function fetchHeadlessDetailed(key, sourceConfig) {
  const puppeteer = await importPuppeteer();
  const launchOptions = {
    headless: "new",
  };
  const executablePath = String(process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }
  if (process.env.PUPPETEER_NO_SANDBOX === "1") {
    launchOptions.args = ["--no-sandbox", "--disable-setuid-sandbox"];
  }
  const browser = await puppeteer.launch(launchOptions);
  try {
    if ((sourceConfig.headlessSite || key) === "iapp") {
      const items = await scrapeIappNews(browser, sourceConfig);
      return {
        items,
        diagnostics: {
          listingExtracted: items.length,
          finalMissingDate: items.filter((item) => !item.publish_time).length,
        },
      };
    }
    if ((sourceConfig.headlessSite || key) === "dataguidance") {
      return await scrapeDataGuidanceNews(browser, sourceConfig);
    }
    throw new Error(`Unsupported headless source: ${key}`);
  } catch (err) {
    if ((sourceConfig.headlessSite || key) === "dataguidance") {
      await clearCookies(sourceConfig.credentialsKey || "dataguidance");
    }
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function fetchHeadless(key, sourceConfig) {
  const result = await fetchHeadlessDetailed(key, sourceConfig);
  return result.items;
}
