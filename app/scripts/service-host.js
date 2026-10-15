import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(PROJECT_ROOT, "app");
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");
const PID_FILE = path.join(LOGS_DIR, "service-host.pid");
const STDOUT_LOG = path.join(LOGS_DIR, "stdout.log");
const STDERR_LOG = path.join(LOGS_DIR, "stderr.log");
const STOP_FLAG_FILE = path.join(LOGS_DIR, "service-stop.flag");

const PORT = Number(process.env.NEWS_ALERT_PORT || process.env.PORT || 3201);
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/status`;
const RESTART_DELAY_MS = 10_000;
const MAX_FAST_CRASHES = 10;
const FAST_CRASH_WINDOW_MS = 60_000;
const STARTUP_HEALTH_MS = 120_000;
const STARTUP_HEALTH_POLL_MS = 2000;
const HEALTH_FETCH_TIMEOUT_MS = 5000;
const PERIODIC_HEALTH_MS = 30_000;
const MAX_CONSECUTIVE_HEALTH_FAILURES = 3;

let child = null;
let stopping = false;
let fastCrashCount = 0;

function ensureLogsDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function ts() {
  return new Date().toISOString();
}

function normalizeForMatch(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
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

function loadExistingPidMeta() {
  if (!fs.existsSync(PID_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(PID_FILE, "utf-8"));
    const pid = Number(parsed.pid);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return {
      pid,
      port: Number(parsed.port) || null,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
    };
  } catch {
    return null;
  }
}

function loadExistingPid() {
  return loadExistingPidMeta()?.pid ?? null;
}

function writePidFile() {
  fs.writeFileSync(
    PID_FILE,
    JSON.stringify(
      {
        pid: process.pid,
        port: PORT,
        startedAt: ts(),
      },
      null,
      2
    ),
    "utf-8"
  );
}

function cleanupPidFile() {
  const existingPid = loadExistingPid();
  if (existingPid === process.pid && fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

function consumeStopFlag() {
  if (!fs.existsSync(STOP_FLAG_FILE)) return false;
  try {
    fs.unlinkSync(STOP_FLAG_FILE);
  } catch {
    // best effort
  }
  return true;
}

async function checkHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return Boolean(data && data.ok === true);
  } catch {
    clearTimeout(timer);
    return false;
  }
}

function inspectProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "win32") {
      const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if ($null -eq $p) { exit 1 }; [pscustomobject]@{ CommandLine = $p.CommandLine; CreationDate = if ($p.CreationDate) { $p.CreationDate.ToString("o") } else { "" } } | ConvertTo-Json -Compress`;
      const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
        encoding: "utf8",
        windowsHide: true,
      }).trim();
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        commandLine: parsed.CommandLine || "",
        createdAt: parsed.CreationDate || "",
      };
    }

    const raw = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    return raw ? { commandLine: raw, createdAt: "" } : null;
  } catch {
    return null;
  }
}

function canReclaimExistingHost(meta) {
  if (!meta?.pid || !isProcessAlive(meta.pid)) return false;
  const identity = inspectProcessIdentity(meta.pid);
  if (!identity) return false;

  const commandLine = normalizeForMatch(identity.commandLine);
  if (!commandLine.includes("service-host.js")) return false;

  const recordedStart = Date.parse(meta.startedAt || "");
  const actualStart = Date.parse(identity.createdAt || "");
  if (!Number.isFinite(recordedStart) || !Number.isFinite(actualStart)) return false;

  return Math.abs(recordedStart - actualStart) <= 120_000;
}

async function acquireHostLock() {
  ensureLogsDir();
  const existing = loadExistingPidMeta();
  const existingPid = existing?.pid ?? null;

  if (existingPid && existingPid !== process.pid && !isProcessAlive(existingPid)) {
    try {
      fs.unlinkSync(PID_FILE);
    } catch {
      // best effort
    }
  }

  if (existingPid && existingPid !== process.pid && isProcessAlive(existingPid)) {
    const healthy = await checkHealth();
    const startedAtMs = Date.parse(existing?.startedAt || "");
    const withinStartupGrace = Number.isFinite(startedAtMs)
      && Date.now() - startedAtMs < STARTUP_HEALTH_MS;
    if (healthy) {
      console.log(`[ServiceHost] Already running with PID ${existingPid} (service healthy).`);
      process.exit(0);
    }
    if (withinStartupGrace) {
      console.log(`[ServiceHost] Existing host ${existingPid} is still in startup grace period.`);
      process.exit(0);
    }
    if (!canReclaimExistingHost(existing)) {
      console.error(`[ServiceHost] Refusing to reclaim unverified PID ${existingPid}.`);
      process.exit(1);
    }
    console.log(`[ServiceHost] PID ${existingPid} is alive but service unhealthy; reclaiming lock.`);
    try {
      process.kill(existingPid, "SIGTERM");
    } catch {
      // ignore
    }
    await wait(2000);
    if (isProcessAlive(existingPid)) {
      try {
        process.kill(existingPid, "SIGKILL");
      } catch {
        // ignore
      }
      await wait(500);
    }
    try {
      if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
  }

  writePidFile();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once("error", (err) => {
      resolve(err.code === "EADDRINUSE");
    });

    tester.once("listening", () => {
      tester.close(() => resolve(false));
    });

    tester.listen(port, "127.0.0.1");
  });
}

function createLogStream(filePath) {
  return fs.createWriteStream(filePath, { flags: "a" });
}

function appendHostLine(stream, line, isErr = false) {
  const prefix = "[ServiceHost] ";
  const text = `${ts()} ${prefix}${line}\n`;
  try {
    stream.write(text);
  } catch {
    // ignore
  }
  if (isErr) console.error(prefix + line);
  else console.log(prefix + line);
}

function createTimestampedLineWriter(writeStream) {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk.toString("utf8");
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? "";
      for (const line of parts) {
        writeStream.write(`${ts()} ${line}\n`, "utf8");
      }
    },
    flush() {
      if (pending.length) {
        writeStream.write(`${ts()} ${pending}\n`, "utf8");
        pending = "";
      }
    },
  };
}

function isChildRunning(c) {
  return c && c.exitCode === null && c.signalCode === null;
}

function waitForChildExit(c) {
  if (!c) return Promise.resolve({ code: null, signal: null });
  if (!isChildRunning(c)) {
    return Promise.resolve({ code: c.exitCode, signal: c.signalCode });
  }
  return new Promise((resolve) => {
    c.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForStartupHealthOrExit(c) {
  const deadline = Date.now() + STARTUP_HEALTH_MS;
  while (Date.now() < deadline) {
    if (stopping) return { ok: false, reason: "stopping" };
    if (!isChildRunning(c)) {
      return { ok: false, reason: "exited" };
    }
    if (await checkHealth()) {
      return { ok: true };
    }
    await wait(STARTUP_HEALTH_POLL_MS);
  }
  if (!isChildRunning(c)) return { ok: false, reason: "exited" };
  return { ok: false, reason: "timeout" };
}

async function spawnServer(outStream, errStream) {
  if (await checkPortInUse(PORT)) {
    appendHostLine(outStream, `Port ${PORT} is busy, waiting for takeover window...`);
    await wait(RESTART_DELAY_MS);
    return true;
  }

  const serverPath = path.join(APP_DIR, "server.js");
  const startedAt = Date.now();

  appendHostLine(outStream, `Starting server on port ${PORT}...`);

  child = spawn(process.execPath, [serverPath], {
    cwd: APP_DIR,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const outWriter = createTimestampedLineWriter(outStream);
  const errWriter = createTimestampedLineWriter(errStream);
  child.stdout.on("data", (chunk) => outWriter.push(chunk));
  child.stderr.on("data", (chunk) => errWriter.push(chunk));
  child.stdout.on("end", () => outWriter.flush());
  child.stderr.on("end", () => errWriter.flush());

  const startup = await waitForStartupHealthOrExit(child);

  if (startup.reason === "exited") {
    outWriter.flush();
    errWriter.flush();
    const exitCode = child.exitCode;
    const exitSignal = child.signalCode;
    child = null;

    if (stopping) return false;

    const crashedQuickly = Date.now() - startedAt < FAST_CRASH_WINDOW_MS;
    fastCrashCount = crashedQuickly ? fastCrashCount + 1 : 0;

    appendHostLine(
      errStream,
      `server.js exited before healthy (code=${exitCode ?? "null"}, signal=${exitSignal ?? "none"}).`,
      true
    );

    if (consumeStopFlag()) {
      appendHostLine(outStream, "Stop flag detected, shutting down host.");
      return false;
    }

    if (await checkPortInUse(PORT)) {
      appendHostLine(outStream, `Port ${PORT} is still active, waiting before retry.`);
      await wait(RESTART_DELAY_MS);
      return true;
    }

    if (fastCrashCount >= MAX_FAST_CRASHES) {
      appendHostLine(errStream, `Reached ${MAX_FAST_CRASHES} fast crashes, stopping host.`, true);
      return false;
    }

    appendHostLine(outStream, `Restarting in ${RESTART_DELAY_MS / 1000}s...`);
    await wait(RESTART_DELAY_MS);
    return true;
  }

  if (!startup.ok) {
    outWriter.flush();
    errWriter.flush();
    if (startup.reason === "timeout") {
      appendHostLine(errStream, "Child did not become healthy within startup window; terminating.", true);
    }
    const exitingChild = child;
    if (isChildRunning(exitingChild)) {
      exitingChild.kill();
      await wait(1500);
      if (isChildRunning(exitingChild)) exitingChild.kill("SIGKILL");
    }
    await waitForChildExit(exitingChild);
    child = null;

    if (stopping) return false;

    const crashedQuicklyAfterFail = Date.now() - startedAt < FAST_CRASH_WINDOW_MS;
    fastCrashCount = crashedQuicklyAfterFail ? fastCrashCount + 1 : 0;

    if (consumeStopFlag()) {
      appendHostLine(outStream, "Stop flag detected, shutting down host.");
      return false;
    }

    if (fastCrashCount >= MAX_FAST_CRASHES) {
      appendHostLine(errStream, `Reached ${MAX_FAST_CRASHES} fast crashes, stopping host.`, true);
      return false;
    }

    appendHostLine(outStream, `Restarting in ${RESTART_DELAY_MS / 1000}s...`);
    await wait(RESTART_DELAY_MS);
    return true;
  }

  appendHostLine(outStream, "Child passed startup health check.");

  let consecutiveFailures = 0;
  let healthCheckInFlight = false;
  const healthTimer = setInterval(async () => {
    if (!child || stopping || !isChildRunning(child) || healthCheckInFlight) return;
    healthCheckInFlight = true;
    const ok = await checkHealth();
    healthCheckInFlight = false;
    if (ok) {
      consecutiveFailures = 0;
      return;
    }
    consecutiveFailures += 1;
    appendHostLine(
      errStream,
      `Periodic health check failed (${consecutiveFailures}/${MAX_CONSECUTIVE_HEALTH_FAILURES}).`,
      true
    );
    if (consecutiveFailures >= MAX_CONSECUTIVE_HEALTH_FAILURES) {
      clearInterval(healthTimer);
      appendHostLine(errStream, "Too many consecutive health failures; terminating child.", true);
      if (isChildRunning(child)) {
        child.kill();
      }
    }
  }, PERIODIC_HEALTH_MS);

  const exitInfo = await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  clearInterval(healthTimer);
  outWriter.flush();
  errWriter.flush();
  child = null;

  if (stopping) return false;

  const crashedQuickly = Date.now() - startedAt < FAST_CRASH_WINDOW_MS;
  fastCrashCount = crashedQuickly ? fastCrashCount + 1 : 0;

  appendHostLine(
    errStream,
    `server.js exited (code=${exitInfo.code ?? "null"}, signal=${exitInfo.signal ?? "none"}).`,
    true
  );

  if (consumeStopFlag()) {
    appendHostLine(outStream, "Stop flag detected, shutting down host.");
    return false;
  }

  if (await checkPortInUse(PORT)) {
    appendHostLine(outStream, `Port ${PORT} is still active, waiting before retry.`);
    await wait(RESTART_DELAY_MS);
    return true;
  }

  if (fastCrashCount >= MAX_FAST_CRASHES) {
    appendHostLine(errStream, `Reached ${MAX_FAST_CRASHES} fast crashes, stopping host.`, true);
    return false;
  }

  appendHostLine(outStream, `Restarting in ${RESTART_DELAY_MS / 1000}s...`);
  await wait(RESTART_DELAY_MS);
  return true;
}

async function run() {
  await acquireHostLock();

  const outStream = createLogStream(STDOUT_LOG);
  const errStream = createLogStream(STDERR_LOG);

  try {
    let shouldContinue = true;
    while (shouldContinue && !stopping) {
      shouldContinue = await spawnServer(outStream, errStream);
    }
  } finally {
    outStream.end();
    errStream.end();
    cleanupPidFile();
  }
}

async function stopHost() {
  if (stopping) return;
  stopping = true;

  if (!child) return;

  child.kill();
  await wait(1500);

  if (child) {
    child.kill("SIGKILL");
  }
}

process.on("SIGINT", () => {
  stopHost().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  stopHost().finally(() => process.exit(0));
});

process.on("exit", cleanupPidFile);

run().catch((err) => {
  console.error("[ServiceHost] Fatal error:", err);
  cleanupPidFile();
  process.exit(1);
});
