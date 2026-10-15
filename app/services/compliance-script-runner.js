import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT_RUNTIME_HELPER_URL = pathToFileURL(
  path.resolve(WORKSPACE_ROOT, "script-runtime/news-alert-script-utils.mjs")
).href;
const RESULT_START = "::NEWS_ALERT_RESULT_START::";
const RESULT_END = "::NEWS_ALERT_RESULT_END::";

function normalizeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function toCleanString(value) {
  return String(value ?? "").trim();
}

function toNumberOrDefault(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveScriptPath(scriptPath) {
  if (!scriptPath) throw new Error("Missing scriptPath for script-backed source");
  return path.isAbsolute(scriptPath) ? scriptPath : path.resolve(WORKSPACE_ROOT, scriptPath);
}

function buildCommandArgs(sourceConfig, { startIso, endIso, outputPath }) {
  const args = [];
  const mode = sourceConfig.dateArgMode || "start-end";
  if (mode === "date-from-to") {
    args.push("--date-from", startIso, "--date-to", endIso);
  } else {
    args.push("--start", startIso, "--end", endIso);
  }
  const outputArgName = sourceConfig.outputArgName === undefined ? "out" : sourceConfig.outputArgName;
  if (outputArgName) args.push(`--${outputArgName}`, outputPath);
  for (const extraArg of sourceConfig.extraArgs || []) {
    args.push(String(extraArg));
  }
  return args;
}

function canAutoPatchLegacyScript(sourceText) {
  return (
    !sourceText.includes("parseScriptRuntimeArgs(") &&
    /const START_ISO = ["'][^"']+["'];/.test(sourceText) &&
    /const END_ISO = new Date\(\)\.toISOString\(\);/.test(sourceText) &&
    /const OUT = ["'][^"']+["'];/.test(sourceText)
  );
}

function patchLegacyScriptSource(sourceText) {
  const replacementRegex = /const START_ISO = ["']([^"']+)["'];\s*const END_ISO = new Date\(\)\.toISOString\(\);\s*const OUT = ["']([^"']+)["'];/;
  if (!replacementRegex.test(sourceText)) {
    throw new Error("Legacy script is missing START_ISO/END_ISO/OUT block");
  }

  const importLine = `import { parseScriptRuntimeArgs as __parseNewsAlertArgs, resolveScriptPath as __resolveNewsAlertPath } from ${JSON.stringify(SCRIPT_RUNTIME_HELPER_URL)};`;
  let patched = sourceText;
  if (patched.startsWith("#!/")) {
    const newlineIndex = patched.indexOf("\n");
    patched = `${patched.slice(0, newlineIndex + 1)}${importLine}\n${patched.slice(newlineIndex + 1)}`;
  } else {
    patched = `${importLine}\n${patched}`;
  }

  return patched.replace(
    replacementRegex,
    (_, defaultStartIso, defaultOut) =>
      `const { startIso: START_ISO, endIso: END_ISO, out: OUT } = __parseNewsAlertArgs(process.argv.slice(2), { defaultStartIso: ${JSON.stringify(defaultStartIso)}, defaultOut: __resolveNewsAlertPath(import.meta.url, ${JSON.stringify(defaultOut)}) });`
  );
}

async function prepareScriptExecution(scriptPath, sourceConfig, tempDir) {
  const sourceText = await fs.readFile(scriptPath, "utf8");
  if (!canAutoPatchLegacyScript(sourceText)) {
    return {
      scriptPath,
      executionMode: "direct_script",
      cwd: path.dirname(scriptPath),
      patchedScriptPath: null,
    };
  }

  const patchedPath = path.join(
    path.dirname(scriptPath),
    `.__news-alert-patched-${process.pid}-${Date.now()}-${path.basename(scriptPath)}`
  );
  await fs.writeFile(patchedPath, patchLegacyScriptSource(sourceText), "utf8");
  return {
    scriptPath: patchedPath,
    executionMode: "patched_legacy_script",
    cwd: path.dirname(scriptPath),
    patchedScriptPath: patchedPath,
  };
}

function normalizeStructuredItem(item, defaults = {}) {
  const summary = toCleanString(item?.summary || item?.description || item?.excerpt || item?.leadText);
  return {
    title: toCleanString(item?.title),
    link: toCleanString(item?.link || item?.url),
    summary,
    description: summary,
    publish_time: normalizeDate(item?.publishTime || item?.publish_time || item?.published || item?.date),
    author: toCleanString(item?.author),
    source_key: toCleanString(item?.sourceKey || item?.source_key || defaults.source_key),
    source_name: toCleanString(item?.sourceName || item?.source_name || defaults.source_name),
    source_list_url: toCleanString(item?.sourceListUrl || item?.source_list_url || defaults.source_list_url),
    source_page: toNumberOrDefault(item?.sourcePage ?? item?.source_page, 0),
    rawPayload: item?.rawPayload || item,
  };
}

function normalizeCsvItem(item, defaults = {}) {
  const summary = toCleanString(item?.summary || item?.description || item?.excerpt || item?.lead_text);
  return {
    title: toCleanString(item?.title),
    link: toCleanString(item?.link || item?.url),
    summary,
    description: summary,
    publish_time: normalizeDate(item?.publish_time || item?.publishTime || item?.published || item?.date),
    author: toCleanString(item?.author),
    source_key: toCleanString(item?.source_key || defaults.source_key),
    source_name: toCleanString(item?.source_name || defaults.source_name),
    source_list_url: toCleanString(item?.source_list_url || defaults.source_list_url),
    source_page: toNumberOrDefault(item?.source_page, 0),
    rawPayload: item,
  };
}

function normalizeItems(items, defaults, normalizer) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizer(item, defaults))
    .filter((item) => item.title && item.link && item.publish_time);
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }

  return rows;
}

async function readCsvItems(outputPath, defaults) {
  const text = await fs.readFile(outputPath, "utf8");
  const rows = parseCsv(text);
  if (rows.length <= 1) return [];
  const [headers, ...records] = rows;
  return normalizeItems(
    records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""]))),
    defaults,
    normalizeCsvItem
  );
}

export function buildScriptDateWindow(recentDays = 3, now = new Date()) {
  const parsedRecentDays = Number(recentDays);
  const end = normalizeDate(now) || new Date().toISOString();
  const safeRecentDays = Number.isFinite(parsedRecentDays) && parsedRecentDays > 0 ? parsedRecentDays : 3;
  const start = new Date(new Date(end).getTime() - safeRecentDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    startIso: start,
    endIso: end,
  };
}

export function parseStructuredScriptResult(stdout) {
  const startIdx = stdout.indexOf(RESULT_START);
  const endIdx = stdout.indexOf(RESULT_END);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
    throw new Error("Structured stdout markers not found");
  }
  const payloadText = stdout
    .slice(startIdx + RESULT_START.length, endIdx)
    .trim();
  if (!payloadText) throw new Error("Structured stdout payload is empty");
  return JSON.parse(payloadText);
}

export async function runComplianceScriptSource(key, sourceConfig, options = {}) {
  const recentDays = options.recentDays ?? sourceConfig.recentDays ?? 3;
  const { startIso, endIso } = buildScriptDateWindow(recentDays, options.now);
  const sourceScriptPath = resolveScriptPath(sourceConfig.scriptPath);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `news-alert-${key}-`));
  const outputPath = path.join(tempDir, `${key}.csv`);
  let preparedScript = null;

  try {
    preparedScript = await prepareScriptExecution(sourceScriptPath, sourceConfig, tempDir);
    const commandArgs = [preparedScript.scriptPath, ...buildCommandArgs(sourceConfig, { startIso, endIso, outputPath })];

    const defaults = {
      source_key: key,
      source_name: sourceConfig.name || key,
      source_list_url: sourceConfig.url || "",
    };

    const child = spawn(process.execPath, commandArgs, {
      cwd: preparedScript.cwd,
      env: {
        ...process.env,
        NEWS_ALERT_DISABLE_SAMPLE_OUT: "1",
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });

    if (exitCode !== 0) {
      throw new Error(`Script ${key} failed with exit ${exitCode}: ${stderr || stdout || "unknown error"}`);
    }

    let items = [];
    let outputMode = "structured_stdout";
    try {
      const payload = parseStructuredScriptResult(stdout);
      items = normalizeItems(payload.items, defaults, normalizeStructuredItem);
    } catch {
      outputMode = "csv_fallback";
      items = await readCsvItems(outputPath, defaults);
    }

    const limit = Number.isFinite(Number(sourceConfig.limit)) ? Number(sourceConfig.limit) : 20;
    return {
      items: items.slice(0, limit),
      diagnostics: {
        fetchType: "script",
        outputMode,
        outputPath,
        executionMode: preparedScript.executionMode,
        commandArgs: commandArgs.slice(1),
        scriptPath: sourceScriptPath,
        stderr: stderr.trim(),
        stdoutPreview: stdout.trim().slice(0, 500),
      },
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    if (preparedScript?.patchedScriptPath) {
      await fs.rm(preparedScript.patchedScriptPath, { force: true }).catch(() => {});
    }
  }
}
