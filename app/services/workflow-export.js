import { getConfig, normalizeSourceVal } from "./config.js";
import { getMergedComplianceSources } from "./compliance-sources.js";

export const WORKFLOW_SCHEMA_VERSION = "1.0.0";

const WORKFLOW_NODES = [
  {
    id: "scheduleTrigger",
    kind: "trigger",
    label: "Scheduler task trigger",
    implementation: "services/scheduler._execute",
  },
  {
    id: "newsSources",
    kind: "source",
    label: "MCP news sources",
    implementation: "services/mcp-client.fetchMultipleSources",
  },
  {
    id: "complianceSources",
    kind: "source",
    label: "Compliance sources",
    implementation: "services/compliance-sources.fetchAllComplianceSources",
  },
  {
    id: "fetchUnifiedSnapshot",
    kind: "processor",
    label: "Fetch unified snapshot",
    implementation: "services/push-pipeline.fetchUnifiedSnapshot",
  },
  {
    id: "filterRecentDays",
    kind: "processor",
    label: "Filter by recentDays",
    implementation: "services/push-pipeline.filterItemsByRecentDaysDetailed",
  },
  {
    id: "prepareDigestBundle",
    kind: "processor",
    label: "Prepare digest bundle",
    implementation: "services/push-pipeline.prepareDigestBundle",
  },
  {
    id: "sendEmail",
    kind: "delivery",
    label: "Send email digest",
    implementation: "services/email.sendEmail",
  },
  {
    id: "sendComplianceWebhook",
    kind: "delivery",
    label: "Send compliance webhook",
    implementation: "services/webhook.sendComplianceDigestWebhook",
  },
];

const WORKFLOW_EDGES = [
  {
    id: "edge_schedule_to_fetch",
    from: "scheduleTrigger",
    to: "fetchUnifiedSnapshot",
    description: "Scheduled tasks start the fetch stage",
  },
  {
    id: "edge_news_to_fetch",
    from: "newsSources",
    to: "fetchUnifiedSnapshot",
    description: "News source data enters unified snapshot",
  },
  {
    id: "edge_compliance_to_fetch",
    from: "complianceSources",
    to: "fetchUnifiedSnapshot",
    description: "Compliance source data enters unified snapshot",
  },
  {
    id: "edge_fetch_to_filter",
    from: "fetchUnifiedSnapshot",
    to: "filterRecentDays",
    description: "Fetched items are filtered by per-source recentDays",
  },
  {
    id: "edge_filter_to_digest",
    from: "filterRecentDays",
    to: "prepareDigestBundle",
    description: "Filtered data is summarized into digests",
  },
  {
    id: "edge_digest_to_email",
    from: "prepareDigestBundle",
    to: "sendEmail",
    description: "Digest bundle feeds email delivery",
  },
  {
    id: "edge_digest_to_webhook",
    from: "prepareDigestBundle",
    to: "sendComplianceWebhook",
    description: "Compliance digest feeds webhook delivery",
    condition: "task.sendComplianceWebhook !== false && complianceDigest.length > 0",
  },
];

function hasUsableAiConfig(config) {
  const ai = config.ai || {};
  return Boolean(String(ai.baseUrl || "").trim() && String(ai.modelName || "").trim() && String(ai.apiKey || "").trim());
}

function summarizeSchedules(config) {
  const schedules = Array.isArray(config.schedules) ? config.schedules : [];
  const activeTasks = schedules.filter((task) => task?.enabled);
  const legacyEnabled = Boolean(config.schedule?.enabled && config.schedule?.cron && schedules.length === 0);
  return {
    totalTasks: schedules.length,
    activeTaskCount: activeTasks.length,
    activeTaskIds: activeTasks.map((task) => task.id).filter(Boolean),
    legacyScheduleEnabled: legacyEnabled,
    legacyCron: legacyEnabled ? config.schedule?.cron || "" : "",
  };
}

function summarizeNewsSources(config) {
  const sourceEntries = Object.entries(config.sources || {}).map(([key, value]) => {
    const normalized = normalizeSourceVal(value);
    return {
      key,
      enabled: normalized.enabled,
      limit: normalized.limit,
      recentDays: normalized.recentDays,
    };
  });
  return {
    configuredCount: sourceEntries.length,
    enabledCount: sourceEntries.filter((entry) => entry.enabled).length,
    sources: sourceEntries,
  };
}

function summarizeComplianceSources(mergedComplianceSources) {
  const sourceEntries = Object.entries(mergedComplianceSources || {}).map(([key, value]) => ({
    key,
    name: value?.name || key,
    type: value?.type || "unknown",
    region: value?.region || "",
    enabled: value?.enabled !== false,
    limit: value?.limit ?? 20,
    recentDays: value?.recentDays ?? 3,
  }));
  const typeBreakdown = sourceEntries.reduce((acc, source) => {
    const type = source.type || "unknown";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  return {
    configuredCount: sourceEntries.length,
    enabledCount: sourceEntries.filter((entry) => entry.enabled).length,
    typeBreakdown,
    sources: sourceEntries,
  };
}

function withRuntimeMetadata(node, { schedule, newsSources, complianceSources, webhookEnabled }) {
  if (node.id === "scheduleTrigger") {
    return {
      ...node,
      metadata: {
        activeTaskCount: schedule.activeTaskCount,
        legacyScheduleEnabled: schedule.legacyScheduleEnabled,
      },
    };
  }
  if (node.id === "newsSources") {
    return {
      ...node,
      metadata: {
        enabledCount: newsSources.enabledCount,
      },
    };
  }
  if (node.id === "complianceSources") {
    return {
      ...node,
      metadata: {
        enabledCount: complianceSources.enabledCount,
        typeBreakdown: complianceSources.typeBreakdown,
      },
    };
  }
  if (node.id === "sendComplianceWebhook") {
    return {
      ...node,
      metadata: {
        webhookEnabled,
      },
    };
  }
  return node;
}

export function createWorkflowExportPayload(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const config = options.config || getConfig();
  const mergedComplianceSources = options.mergedComplianceSources || getMergedComplianceSources();
  const schedule = summarizeSchedules(config);
  const newsSources = summarizeNewsSources(config);
  const complianceSources = summarizeComplianceSources(mergedComplianceSources);
  const webhookEnabled = config.webhook?.enabled === true;

  const workflowDefinition = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    nodes: WORKFLOW_NODES.map((node) =>
      withRuntimeMetadata(node, {
        schedule,
        newsSources,
        complianceSources,
        webhookEnabled,
      })
    ),
    edges: WORKFLOW_EDGES,
    entrypoints: [
      {
        id: "apiFetch",
        type: "api",
        route: "/api/fetch",
        method: "POST",
        startsAt: "fetchUnifiedSnapshot",
      },
      {
        id: "apiDigestStream",
        type: "api",
        route: "/api/digest/stream",
        method: "GET",
        startsAt: "prepareDigestBundle",
      },
      {
        id: "schedulerTask",
        type: "scheduler",
        startsAt: "scheduleTrigger",
        activeTaskCount: schedule.activeTaskCount,
      },
    ],
    configSummary: {
      schedule: {
        activeTaskCount: schedule.activeTaskCount,
      },
      newsSources: {
        enabledCount: newsSources.enabledCount,
      },
      complianceSources: {
        enabledCount: complianceSources.enabledCount,
      },
      delivery: {
        webhookEnabled,
      },
    },
  };

  const workflowConfig = {
    ai: {
      configured: hasUsableAiConfig(config),
      modelName: config.ai?.modelName || "",
      baseUrlConfigured: Boolean(String(config.ai?.baseUrl || "").trim()),
    },
    schedule,
    newsSources,
    complianceSources,
    delivery: {
      webhookEnabled,
      recipientGroupCount: Array.isArray(config.recipientGroups) ? config.recipientGroups.length : 0,
    },
  };

  return {
    workflowDefinition,
    workflowConfig,
  };
}

export function registerWorkflowExportRoute(app, options = {}) {
  const getPayload = options.getWorkflowExportPayload || createWorkflowExportPayload;
  app.get("/api/workflow", (req, res) => {
    try {
      const payload = getPayload();
      res.json({ ok: true, ...payload });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });
}
