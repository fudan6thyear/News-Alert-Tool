import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PROMPTS } from "./prompt-templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "../data/config.json");

const DEFAULT_SOURCE_LIMIT = 30;

const DEFAULT_CONFIG = {
  ai: { baseUrl: "", modelName: "", apiKey: "" },
  prompts: { ...DEFAULT_PROMPTS },
  webhook: { enabled: false, url: "", linkRenderMode: "markdown" },
  email: {
    senderEmail: "",
    senderPassword: "",
    smtpHost: "smtp.163.com",
    smtpPort: 465,
  },
  recipientGroups: [],
  schedule: { enabled: false, cron: "0 8 * * *" },
  schedules: [],
  headlessCredentials: {},
  sources: {},
  complianceSources: {},
};

let cachedConfig = null;

export function normalizeSourceVal(val) {
  if (val === undefined || val === null) return { enabled: true, limit: DEFAULT_SOURCE_LIMIT, recentDays: 3 };
  if (typeof val === "boolean") return { enabled: val, limit: DEFAULT_SOURCE_LIMIT, recentDays: 3 };
  return {
    enabled: val.enabled !== false,
    limit: val.limit ?? DEFAULT_SOURCE_LIMIT,
    recentDays: val.recentDays ?? 3,
  };
}

function migrateRecipientGroups(parsed) {
  if (parsed.recipientGroups && parsed.recipientGroups.length > 0) return;

  const groups = [];
  const newsEmails = parsed.email?.newsReceiverEmails || parsed.email?.receiverEmails || [];
  const compEmails = parsed.email?.complianceReceiverEmails || parsed.email?.receiverEmails || [];

  if (newsEmails.length > 0) {
    groups.push({
      id: "grp_news_default",
      name: "新闻订阅组",
      color: "#2563eb",
      emails: [...new Set(newsEmails)],
    });
  }
  if (compEmails.length > 0) {
    const isDifferent = JSON.stringify([...newsEmails].sort()) !== JSON.stringify([...compEmails].sort());
    if (isDifferent || groups.length === 0) {
      groups.push({
        id: "grp_comp_default",
        name: "合规订阅组",
        color: "#7c3aed",
        emails: [...new Set(compEmails)],
      });
    }
  }

  if (groups.length > 0) {
    parsed.recipientGroups = groups;
    const schedules = parsed.schedules || [];
    for (const task of schedules) {
      if (!task.newsTargetGroups && !task.complianceTargetGroups) {
        task.newsTargetGroups = groups.filter((g) => g.id.includes("news")).map((g) => g.id);
        task.complianceTargetGroups = groups.filter((g) => g.id.includes("comp")).map((g) => g.id);
        if (task.newsTargetGroups.length === 0) task.newsTargetGroups = groups.map((g) => g.id);
        if (task.complianceTargetGroups.length === 0) task.complianceTargetGroups = groups.map((g) => g.id);
      }
    }
  }
}

export function getConfig() {
  if (cachedConfig) return cachedConfig;

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      migrateRecipientGroups(parsed);
      cachedConfig = {
        ...DEFAULT_CONFIG,
        ...parsed,
        ai: { ...DEFAULT_CONFIG.ai, ...(parsed.ai || {}) },
        prompts: { ...DEFAULT_CONFIG.prompts, ...(parsed.prompts || {}) },
        webhook: { ...DEFAULT_CONFIG.webhook, ...(parsed.webhook || {}) },
        email: { ...DEFAULT_CONFIG.email, ...(parsed.email || {}) },
        schedule: { ...DEFAULT_CONFIG.schedule, ...(parsed.schedule || {}) },
        headlessCredentials: { ...DEFAULT_CONFIG.headlessCredentials, ...(parsed.headlessCredentials || {}) },
        recipientGroups: parsed.recipientGroups || [],
        complianceSources: parsed.complianceSources || {},
      };
    } else {
      cachedConfig = { ...DEFAULT_CONFIG };
    }
  } catch (err) {
    console.error("[Config] Failed to parse config.json, using defaults:", err.message);
    cachedConfig = { ...DEFAULT_CONFIG };
  }
  return cachedConfig;
}

export function resolveGroupEmails(groupIds) {
  const config = getConfig();
  const groups = config.recipientGroups || [];
  const emails = new Set();
  for (const id of groupIds || []) {
    const g = groups.find((gr) => gr.id === id);
    if (g) g.emails.forEach((e) => emails.add(e));
  }
  return [...emails];
}

export function saveConfig(newConfig) {
  const cur = getConfig();
  const mergedHeadlessCredentials = newConfig.headlessCredentials === undefined
    ? cur.headlessCredentials
    : Object.fromEntries(
      [...new Set([
        ...Object.keys(cur.headlessCredentials || {}),
        ...Object.keys(newConfig.headlessCredentials || {}),
      ])].map((key) => [
        key,
        {
          ...(cur.headlessCredentials?.[key] || {}),
          ...(newConfig.headlessCredentials?.[key] || {}),
        },
      ])
    );
  const merged = {
    ...cur,
    ...newConfig,
    ai: { ...cur.ai, ...newConfig.ai },
    prompts: { ...cur.prompts, ...newConfig.prompts },
    webhook: { ...cur.webhook, ...newConfig.webhook },
    email: { ...cur.email, ...newConfig.email },
    schedule: { ...cur.schedule, ...newConfig.schedule },
    headlessCredentials: mergedHeadlessCredentials,
    recipientGroups: newConfig.recipientGroups !== undefined ? newConfig.recipientGroups : cur.recipientGroups,
    schedules: newConfig.schedules !== undefined ? newConfig.schedules : cur.schedules,
    sources: newConfig.sources !== undefined ? { ...cur.sources, ...newConfig.sources } : cur.sources,
    complianceSources: newConfig.complianceSources !== undefined
      ? { ...cur.complianceSources, ...newConfig.complianceSources }
      : cur.complianceSources,
  };

  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf-8");
  cachedConfig = merged;
  return merged;
}

export function resetConfigCache() {
  cachedConfig = null;
}
