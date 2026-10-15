import cron from "node-cron";
import { getConfig, saveConfig } from "./config.js";
import { sendEmail } from "./email.js";
import { sendComplianceDigestWebhook } from "./webhook.js";
import { fetchUnifiedSnapshot, prepareDigestBundle } from "./push-pipeline.js";

function formatSnapshotWarnings(errors = []) {
  return (errors || [])
    .map((entry) => {
      if (!entry) return "";
      if (typeof entry === "string") return entry;
      if (typeof entry === "object") {
        const source = entry.source ? `[${entry.source}] ` : "";
        const message = entry.error || entry.message || JSON.stringify(entry);
        return `${source}${message}`;
      }
      return String(entry);
    })
    .filter(Boolean)
    .join(" | ");
}

function formatDiagnosticsSummary(diagnostics) {
  const compliance = diagnostics?.compliance?.sources || [];
  const news = diagnostics?.news?.sources || [];
  const summary = [...news, ...compliance]
    .filter((entry) => entry && (entry.beforeFilter || entry.afterFilter || entry.fallbackUsed))
    .map((entry) => {
      const fallback = entry.fallbackReason ? `,fallbackReason=${entry.fallbackReason}` : "";
      return `${entry.source}:${entry.beforeFilter || 0}->${entry.afterFilter || 0},missing=${entry.missingDate || 0},outside=${entry.outsideRecentDays || 0},fallback=${entry.fallbackUsed || 0}${fallback}`;
    })
    .join(" | ");
  return summary;
}

class SchedulerService {
  constructor() {
    this.tasks = new Map();
    this._runningTasks = new Set();
  }

  startTask(task) {
    this.stopTask(task.id);
    if (!task.enabled) return;

    const cronExprs = this._resolveCrons(task);
    if (!cronExprs.length) return;

    const jobs = [];
    for (const expr of cronExprs) {
      if (!cron.validate(expr)) {
        console.error(`[Scheduler] Invalid cron for "${task.name}": ${expr}`);
        continue;
      }
      jobs.push(
        cron.schedule(expr, () => this._execute(task.id), { timezone: "Asia/Shanghai" })
      );
    }
    if (jobs.length) {
      this.tasks.set(task.id, { jobs, taskDef: task });
      console.log(`[Scheduler] Started "${task.name}" (${cronExprs.join(' | ')})`);
    }
  }

  _resolveCrons(task) {
    if (task.type === "daily" && Array.isArray(task.times) && task.times.length > 0) {
      return task.times
        .filter((t) => typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t))
        .map((t) => {
          const [h, m] = t.split(":");
          return `${parseInt(m)} ${parseInt(h)} * * *`;
        });
    }
    return task.cron ? [task.cron] : [];
  }

  stopTask(id) {
    const entry = this.tasks.get(id);
    if (entry) {
      for (const job of entry.jobs) job.stop();
      this.tasks.delete(id);
    }
  }

  stopAll() {
    for (const [id] of this.tasks) this.stopTask(id);
  }

  reloadAll() {
    this.stopAll();
    const config = getConfig();
    const schedules = config.schedules || [];
    for (const task of schedules) {
      if (task.enabled) this.startTask(task);
    }
    console.log(`[Scheduler] Loaded ${schedules.filter((t) => t.enabled).length} active task(s)`);
  }

  async _execute(taskId) {
    if (this._runningTasks.has(taskId)) {
      console.log(`[Scheduler] Task ${taskId} already running, skipping...`);
      return;
    }
    this._runningTasks.add(taskId);
    const config = getConfig();
    const taskDef = (config.schedules || []).find((t) => t.id === taskId);
    const taskName = taskDef?.name || taskId;
    console.log(`[Scheduler] Executing "${taskName}"...`);

    try {
      const snapshot = await fetchUnifiedSnapshot();
      const mcpItems = snapshot.newsItems;
      const complianceItems = snapshot.complianceItems;
      if (snapshot.errors.length > 0) {
        console.warn(`[Scheduler] "${taskName}" fetch warnings: ${formatSnapshotWarnings(snapshot.errors)}`);
      }
      const diagnosticsSummary = formatDiagnosticsSummary(snapshot.diagnostics);
      if (diagnosticsSummary) {
        console.log(`[Scheduler] "${taskName}" diagnostics: ${diagnosticsSummary}`);
      }

      if (mcpItems.length === 0 && complianceItems.length === 0) {
        console.log(`[Scheduler] "${taskName}": no items fetched, skipping email`);
        updateTaskRunInfo(taskId, "success (no items)");
        return;
      }

      const bundle = await prepareDigestBundle({
        type: "all",
        newsItems: mcpItems,
        complianceItems,
      });
      const newsDigest = bundle.newsDigest;
      const complianceDigest = bundle.complianceDigest;
      const complianceCommunityPulse = bundle.communityPulse;

      await sendEmail({
        newsItems: mcpItems,
        newsDigest,
        complianceItems,
        complianceDigest,
        newsTargetGroups: taskDef?.newsTargetGroups,
        complianceTargetGroups: taskDef?.complianceTargetGroups,
      });

      const shouldSendWebhook = taskDef?.sendComplianceWebhook !== false;
      if (shouldSendWebhook && complianceDigest.length > 0) {
        try {
          const fetchTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
          await sendComplianceDigestWebhook({
            taskName,
            fetchTime,
            complianceDigest,
            communityPulse: complianceCommunityPulse,
          });
          console.log(`[Scheduler] "${taskName}" webhook sent`);
        } catch (err) {
          console.error(`[Scheduler] "${taskName}" webhook failed: ${err.message}`);
        }
      }

      updateTaskRunInfo(taskId, "success");
      console.log(`[Scheduler] "${taskName}" completed`);
    } catch (err) {
      updateTaskRunInfo(taskId, `error: ${err.message}`);
      console.error(`[Scheduler] "${taskName}" failed:`, err.message);
    } finally {
      this._runningTasks.delete(taskId);
    }
  }

  getStatus() {
    const config = getConfig();
    const schedules = config.schedules || [];
    return {
      totalTasks: schedules.length,
      activeTasks: schedules.filter((t) => t.enabled).length,
      runningTasks: this._runningTasks.size,
      runningJobs: this.tasks.size,
    };
  }

  initFromConfig() {
    const config = getConfig();
    if (config.schedules && config.schedules.length > 0) {
      this.reloadAll();
    } else if (config.schedule?.enabled && config.schedule?.cron) {
      const legacy = {
        id: "legacy_1",
        name: "默认任务",
        type: "daily",
        time: cronToTime(config.schedule.cron),
        cron: config.schedule.cron,
        enabled: true,
        locked: false,
        lastRun: null,
        lastStatus: null,
      };
      saveConfig({ schedules: [legacy] });
      this.startTask(legacy);
    }
  }
}

function cronToTime(expr) {
  if (typeof expr !== "string") return "08:00";
  const parts = expr.trim().split(/\s+/);
  if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    const m = parts[0].padStart(2, "0");
    const h = parts[1].padStart(2, "0");
    return `${h}:${m}`;
  }
  return "08:00";
}

function updateTaskRunInfo(taskId, status) {
  const config = getConfig();
  const schedules = [...(config.schedules || [])];
  const idx = schedules.findIndex((t) => t.id === taskId);
  if (idx !== -1) {
    schedules[idx] = {
      ...schedules[idx],
      lastRun: new Date().toISOString(),
      lastStatus: status,
    };
    saveConfig({ schedules });
  }
}

export const scheduler = new SchedulerService();
