/**
 * Cross-platform auto-start setup for News Alert.
 *
 * Usage:
 *   node scripts/autostart.js install    # enable auto-start on login
 *   node scripts/autostart.js uninstall  # disable auto-start
 *   node scripts/autostart.js status     # check current state
 */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  WINDOWS_AUTOSTART_SCRIPT_NAME,
  getAutostartLogPath,
  writeWindowsStartupVbs,
} from "../services/autostart-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SERVICE_NAME = "NewsAlert";
const LABEL = "com.news-alert.service";

function vbsEsc(str) {
  return str.replace(/"/g, '""');
}

function xmlEsc(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getWindowsStartupDir() {
  return path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

function getMacLaunchAgentsDir() {
  return path.join(os.homedir(), "Library", "LaunchAgents");
}

// ── Windows ──

function windowsInstall() {
  const startupDir = getWindowsStartupDir();
  const vbsPath = path.join(startupDir, WINDOWS_AUTOSTART_SCRIPT_NAME);
  const batPath = path.join(PROJECT_ROOT, "start-service.bat");
  const launcherPath = path.join(PROJECT_ROOT, "run-background.vbs");

  if (!fs.existsSync(batPath)) {
    console.error(`[Error] start-service.bat not found at: ${batPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(launcherPath)) {
    console.error(`[Error] run-background.vbs not found at: ${launcherPath}`);
    process.exit(1);
  }

  writeWindowsStartupVbs(vbsPath, PROJECT_ROOT);

  const started = spawnSync("wscript.exe", [launcherPath], {
    cwd: PROJECT_ROOT,
    stdio: "ignore",
    windowsHide: true,
  });

  console.log(`[OK] Auto-start installed for Windows.`);
  console.log(`     VBS file: ${vbsPath}`);
  console.log(`     Startup log: ${getAutostartLogPath(PROJECT_ROOT)}`);
  console.log(`     Service will start silently on next login.`);
  if (started.status === 0) {
    console.log(`     Background host launch was requested for the current session. Check the startup log to confirm health.`);
  } else if (started.error) {
    console.log(`     Background host launch failed: ${started.error.message}`);
  }
}

function windowsUninstall() {
  const vbsPath = path.join(getWindowsStartupDir(), WINDOWS_AUTOSTART_SCRIPT_NAME);
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
    console.log(`[OK] Auto-start removed. Deleted: ${vbsPath}`);
  } else {
    console.log("[Info] Auto-start was not installed.");
  }
}

function windowsStatus() {
  const vbsPath = path.join(getWindowsStartupDir(), WINDOWS_AUTOSTART_SCRIPT_NAME);
  if (fs.existsSync(vbsPath)) {
    console.log(`[Status] Auto-start is ENABLED (Windows Startup folder).`);
    console.log(`         File: ${vbsPath}`);
    console.log(`         Log:  ${getAutostartLogPath(PROJECT_ROOT)}`);
  } else {
    console.log(`[Status] Auto-start is NOT installed.`);
    console.log(`         Run "npm run autostart" to enable.`);
  }
}

// ── macOS ──

function macInstall() {
  const agentsDir = getMacLaunchAgentsDir();
  const plistPath = path.join(agentsDir, `${LABEL}.plist`);
  const shPath = path.join(PROJECT_ROOT, "start-service.sh");

  if (!fs.existsSync(shPath)) {
    console.error(`[Error] start-service.sh not found at: ${shPath}`);
    process.exit(1);
  }

  try {
    fs.chmodSync(shPath, 0o755);
  } catch {
    // non-critical on some systems
  }

  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }

  const nodePath = process.execPath;
  const serverJs = path.join(PROJECT_ROOT, "app", "server.js");
  const logOut = path.join(PROJECT_ROOT, "logs", "stdout.log");
  const logErr = path.join(PROJECT_ROOT, "logs", "stderr.log");

  const logsDir = path.join(PROJECT_ROOT, "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEsc(LABEL)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xmlEsc(nodePath)}</string>
        <string>${xmlEsc(serverJs)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEsc(path.join(PROJECT_ROOT, "app"))}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${xmlEsc(logOut)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEsc(logErr)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${xmlEsc(path.dirname(nodePath))}:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
`;

  fs.writeFileSync(plistPath, plist, "utf-8");
  console.log(`[OK] Auto-start installed for macOS.`);
  console.log(`     Plist: ${plistPath}`);
  console.log(`     Logs:  ${logsDir}/`);
  console.log("");
  console.log(`     To start immediately: launchctl load ${plistPath}`);
  console.log(`     To stop:              launchctl unload ${plistPath}`);
}

function macUninstall() {
  const plistPath = path.join(getMacLaunchAgentsDir(), `${LABEL}.plist`);
  if (fs.existsSync(plistPath)) {
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore" });
    } catch {
      // might not be loaded
    }
    fs.unlinkSync(plistPath);
    console.log(`[OK] Auto-start removed. Deleted: ${plistPath}`);
  } else {
    console.log("[Info] Auto-start was not installed.");
  }
}

function macStatus() {
  const plistPath = path.join(getMacLaunchAgentsDir(), `${LABEL}.plist`);
  if (fs.existsSync(plistPath)) {
    console.log(`[Status] Auto-start is ENABLED (macOS LaunchAgent).`);
    console.log(`         Plist: ${plistPath}`);
  } else {
    console.log(`[Status] Auto-start is NOT installed.`);
    console.log(`         Run "npm run autostart" to enable.`);
  }
}

// ── Main ──

const platform = os.platform();
const action = process.argv[2] || "install";

if (!["install", "uninstall", "status"].includes(action)) {
  console.log("Usage: node scripts/autostart.js [install|uninstall|status]");
  process.exit(1);
}

console.log(`[News Alert] Auto-start ${action} (${platform})\n`);

if (platform === "win32") {
  if (action === "install") windowsInstall();
  else if (action === "uninstall") windowsUninstall();
  else windowsStatus();
} else if (platform === "darwin") {
  if (action === "install") macInstall();
  else if (action === "uninstall") macUninstall();
  else macStatus();
} else {
  console.log(`[Warning] Auto-start setup is not supported on ${platform}.`);
  console.log("You can manually add start-service.sh to your system's init/cron.");
  process.exit(0);
}
