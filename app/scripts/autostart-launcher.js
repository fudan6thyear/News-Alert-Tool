import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { AUTOSTART_LOG_FILE_NAME } from "../services/autostart-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(PROJECT_ROOT, "app");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const AUTOSTART_LOG = path.join(LOGS_DIR, AUTOSTART_LOG_FILE_NAME);
const SERVICE_HOST_PID_FILE = path.join(LOGS_DIR, "service-host.pid");
const SERVICE_HOST_PATH = path.join(APP_DIR, "scripts", "service-host.js");
const PORT = Number(process.env.NEWS_ALERT_PORT || process.env.PORT || 3201);
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/status`;
const HEALTH_WAIT_MS = 90_000;
const HEALTH_POLL_MS = 2_000;
let logInitialized = false;
const require = createRequire(import.meta.url);

function ts() {
  return new Date().toISOString();
}

function ensureLogsDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function log(message) {
  ensureLogsDir();
  if (!logInitialized) {
    fs.writeFileSync(AUTOSTART_LOG, "", "utf-8");
    logInitialized = true;
  }
  const line = `${ts()} [AutostartLauncher] ${message}\n`;
  fs.appendFileSync(AUTOSTART_LOG, line, "utf-8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function readHostPid() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SERVICE_HOST_PID_FILE, "utf-8"));
    const pid = Number(parsed.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function checkHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return data?.ok === true;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

function getNpmCommandCandidates() {
  const nodeDir = path.dirname(process.execPath);
  if (process.platform === "win32") {
    return [path.join(nodeDir, "npm.cmd"), "npm.cmd", "npm"];
  }
  return [path.join(nodeDir, "npm"), "npm"];
}

function hasRequiredDependencies() {
  try {
    require.resolve("puppeteer", { paths: [APP_DIR] });
    return true;
  } catch {
    return false;
  }
}

function ensureDependencies() {
  if (fs.existsSync(path.join(APP_DIR, "node_modules")) && hasRequiredDependencies()) {
    log("node_modules present; skipping npm install");
    return { ok: true, skipped: true };
  }
  if (fs.existsSync(path.join(APP_DIR, "node_modules"))) {
    log("node_modules present but required packages are missing; running npm install");
  }

  for (const command of getNpmCommandCandidates()) {
    const result = spawnSync(command, ["install", "--no-audit", "--no-fund"], {
      cwd: APP_DIR,
      env: process.env,
      encoding: "utf-8",
      windowsHide: true,
    });
    if (result.error) {
      log(`npm install via ${command} failed to launch: ${result.error.message}`);
      continue;
    }
    if (result.status === 0) {
      log(`npm install succeeded via ${command}`);
      return { ok: true, skipped: false };
    }
    const stderr = String(result.stderr || "").trim().slice(-500);
    log(`npm install failed via ${command} with code ${result.status}; stderr=${stderr}`);
    return { ok: false, skipped: false, code: result.status };
  }

  log("npm install could not be started because npm was not found");
  return { ok: false, skipped: false, code: 1 };
}

function startServiceHost() {
  const child = spawn(process.execPath, [SERVICE_HOST_PATH], {
    cwd: APP_DIR,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid || null;
}

async function waitForHealthyHost(expectedHostPid) {
  const deadline = Date.now() + HEALTH_WAIT_MS;
  while (Date.now() < deadline) {
    const hostPid = readHostPid();
    const hostAlive = isProcessAlive(hostPid);
    const expectedSatisfied = !expectedHostPid || hostPid === expectedHostPid || isProcessAlive(expectedHostPid);
    if (hostAlive && expectedSatisfied && await checkHealth()) {
      return { ok: true, reason: "healthy", pid: hostPid };
    }
    if (hostPid && !isProcessAlive(hostPid)) {
      return { ok: false, reason: "host-exited", pid: hostPid };
    }
    if (expectedHostPid && !isProcessAlive(expectedHostPid)) {
      if (hostAlive && await checkHealth()) {
        return { ok: true, reason: "healthy-existing-host", pid: hostPid };
      }
    }
    await sleep(HEALTH_POLL_MS);
  }
  return { ok: false, reason: "timeout", pid: readHostPid() || expectedHostPid || null };
}

async function main() {
  const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
  const source = sourceArg ? sourceArg.split("=").slice(1).join("=") : "manual";

  log(`invoked; source=${source}; cwd=${process.cwd()}; node=${process.execPath}`);

  const hostPid = readHostPid();
  const hostAlive = isProcessAlive(hostPid);
  if (await checkHealth()) {
    if (hostAlive) {
      log(`service already healthy with host pid=${hostPid}; skipping launch`);
      return;
    }
    log("service healthy but no background host detected; continuing launch");
  }

  const install = ensureDependencies();
  if (!install.ok) {
    process.exitCode = install.code || 1;
    return;
  }

  const launchedPid = startServiceHost();
  log(`service host launch requested; pid=${launchedPid || "unknown"}`);

  const healthResult = await waitForHealthyHost(launchedPid);
  if (healthResult.ok) {
    log(`health wait result=healthy; hostPid=${healthResult.pid || launchedPid || "unknown"}`);
    return;
  }

  log(`health wait result=${healthResult.reason}; hostPid=${healthResult.pid || "unknown"}`);
  process.exitCode = 1;
}

main().catch((err) => {
  log(`fatal error: ${err?.stack || err?.message || err}`);
  process.exit(1);
});
