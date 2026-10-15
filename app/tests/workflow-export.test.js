import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  WORKFLOW_SCHEMA_VERSION,
  createWorkflowExportPayload,
  registerWorkflowExportRoute,
} from "../services/workflow-export.js";

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test("createWorkflowExportPayload returns stable schema, nodes, and edges", () => {
  const payload = createWorkflowExportPayload({
    now: "2026-04-23T00:00:00.000Z",
    config: {
      ai: { baseUrl: "https://example-ai.com", modelName: "gpt-4o-mini", apiKey: process.env.NEWS_ALERT_TEST_API_KEY || "test-api-key" },
      webhook: { enabled: true },
      recipientGroups: [{ id: "grp_news" }, { id: "grp_comp" }],
      schedule: { enabled: true, cron: "0 8 * * *" },
      schedules: [{ id: "task_daily", enabled: true, cron: "0 9 * * *" }],
      sources: {
        get_theverge_news: { enabled: true, limit: 10, recentDays: 3 },
        get_bbc_news: false,
      },
      complianceSources: {},
    },
    mergedComplianceSources: {
      gn_eu_ai_act: { name: "EU AI Act", type: "rss", region: "EU", enabled: true, limit: 30, recentDays: 3 },
      dataguidance_news: { name: "DataGuidance", type: "script", region: "Global", enabled: false, limit: 20, recentDays: 4 },
    },
  });

  assert.equal(payload.workflowDefinition.schemaVersion, WORKFLOW_SCHEMA_VERSION);
  assert.equal(payload.workflowDefinition.generatedAt, "2026-04-23T00:00:00.000Z");
  assert.deepEqual(
    payload.workflowDefinition.nodes.map((node) => node.id),
    [
      "scheduleTrigger",
      "newsSources",
      "complianceSources",
      "fetchUnifiedSnapshot",
      "filterRecentDays",
      "prepareDigestBundle",
      "sendEmail",
      "sendComplianceWebhook",
    ]
  );
  assert.deepEqual(
    payload.workflowDefinition.edges.map((edge) => edge.id),
    [
      "edge_schedule_to_fetch",
      "edge_news_to_fetch",
      "edge_compliance_to_fetch",
      "edge_fetch_to_filter",
      "edge_filter_to_digest",
      "edge_digest_to_email",
      "edge_digest_to_webhook",
    ]
  );
  assert.equal(payload.workflowDefinition.configSummary.schedule.activeTaskCount, 1);
  assert.equal(payload.workflowDefinition.configSummary.newsSources.enabledCount, 1);
  assert.equal(payload.workflowDefinition.configSummary.complianceSources.enabledCount, 1);
  assert.equal(payload.workflowConfig.newsSources.enabledCount, 1);
  assert.equal(payload.workflowConfig.complianceSources.typeBreakdown.rss, 1);
  assert.equal(payload.workflowConfig.complianceSources.typeBreakdown.script, 1);
});

test("registerWorkflowExportRoute serves JSON payload on /api/workflow", async () => {
  const app = express();
  registerWorkflowExportRoute(app, {
    getWorkflowExportPayload: () => ({
      workflowDefinition: {
        schemaVersion: "test",
        generatedAt: "2026-04-23T00:00:00.000Z",
        nodes: [],
        edges: [],
        entrypoints: [],
      },
      workflowConfig: {
        ai: { configured: false },
      },
    }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/workflow`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /application\/json/);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.workflowDefinition.schemaVersion, "test");
  });
});

test("workflow route registration does not affect existing /api/export text responses", async () => {
  const app = express();
  app.get("/api/export", (req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send("txt-export-ok");
  });
  registerWorkflowExportRoute(app, {
    getWorkflowExportPayload: () => ({
      workflowDefinition: {
        schemaVersion: "test",
        generatedAt: "2026-04-23T00:00:00.000Z",
        nodes: [],
        edges: [],
        entrypoints: [],
      },
      workflowConfig: {},
    }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/export`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/plain/);
    assert.equal(await response.text(), "txt-export-ok");
  });
});
