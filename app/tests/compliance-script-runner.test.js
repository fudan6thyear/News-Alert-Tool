import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildScriptDateWindow,
  parseStructuredScriptResult,
  runComplianceScriptSource,
} from "../services/compliance-script-runner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures", "compliance-scripts");

test("buildScriptDateWindow derives start and end from recentDays", () => {
  const window = buildScriptDateWindow(3, "2026-04-14T12:00:00.000Z");
  assert.deepEqual(window, {
    startIso: "2026-04-11T12:00:00.000Z",
    endIso: "2026-04-14T12:00:00.000Z",
  });
});

test("parseStructuredScriptResult extracts payload between markers", () => {
  const payload = parseStructuredScriptResult([
    "noise before",
    "::NEWS_ALERT_RESULT_START::",
    JSON.stringify({
      contractVersion: 1,
      status: "success",
      items: [
        {
          title: "Example",
          link: "https://example.com/1",
          publishTime: "2026-04-10T00:00:00.000Z",
          summary: "Summary",
        },
      ],
      diagnostics: { rawCount: 1, uniqueCount: 1 },
      error: null,
    }),
    "::NEWS_ALERT_RESULT_END::",
  ].join("\n"));

  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].title, "Example");
});

test("runComplianceScriptSource returns normalized items from structured stdout", async () => {
  const fixturePath = path.join(fixtureDir, "structured-script.mjs");
  const result = await runComplianceScriptSource("structured_fixture", {
    name: "Structured Fixture",
    scriptPath: fixturePath,
    url: "https://example.com/structured-feed",
    type: "script",
    enabled: true,
    recentDays: 5,
    limit: 10,
  }, {
    recentDays: 5,
    now: "2026-04-14T12:00:00.000Z",
  });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    title: "Structured fixture article",
    link: "https://example.com/structured",
    summary: "Structured fixture summary",
    description: "Structured fixture summary",
    publish_time: "2026-04-09T12:00:00.000Z",
    author: "",
    source_key: "structured_fixture",
    source_name: "Structured Fixture",
    source_list_url: "https://example.com/structured-feed",
    source_page: 0,
    rawPayload: {
      start: "2026-04-09T12:00:00.000Z",
      end: "2026-04-14T12:00:00.000Z",
      out: result.diagnostics.outputPath,
    },
  });
});

test("runComplianceScriptSource falls back to csv output when stdout is not structured", async () => {
  const fixturePath = path.join(fixtureDir, "csv-script.mjs");
  const result = await runComplianceScriptSource("csv_fixture", {
    name: "CSV Fixture",
    scriptPath: fixturePath,
    url: "https://example.com/csv-feed",
    type: "script",
    enabled: true,
    recentDays: 2,
    limit: 10,
  }, {
    recentDays: 2,
    now: "2026-04-14T12:00:00.000Z",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "CSV fixture article");
  assert.equal(result.items[0].summary, "CSV fixture summary");
  assert.equal(result.items[0].description, "CSV fixture summary");
  assert.equal(result.items[0].publish_time, "2026-04-12T12:00:00.000Z");
  assert.equal(result.items[0].source_key, "csv_fixture");
  assert.equal(result.items[0].source_name, "CSV Fixture");
  assert.equal(result.items[0].source_list_url, "https://example.com/csv-feed");
  assert.equal(result.diagnostics.fetchType, "script");
  assert.equal(result.diagnostics.outputMode, "csv_fallback");
});

test("runComplianceScriptSource can adapt legacy scripts with hardcoded date and output constants", async () => {
  const fixturePath = path.join(fixtureDir, "legacy-const-script.mjs");
  const result = await runComplianceScriptSource("legacy_fixture", {
    name: "Legacy Fixture",
    scriptPath: fixturePath,
    url: "https://example.com/legacy-feed",
    type: "script",
    enabled: true,
    recentDays: 2,
    limit: 10,
  }, {
    recentDays: 2,
    now: "2026-04-14T12:00:00.000Z",
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].publish_time, "2026-04-12T12:00:00.000Z");
  assert.equal(result.items[1].publish_time, "2026-04-14T12:00:00.000Z");
  assert.equal(result.diagnostics.executionMode, "patched_legacy_script");
});

test("runComplianceScriptSource preserves relative imports for patched legacy scripts and cleans temp output", async () => {
  const fixturePath = path.join(fixtureDir, "legacy-relative-script.mjs");
  const result = await runComplianceScriptSource("relative_fixture", {
    name: "Relative Fixture",
    scriptPath: fixturePath,
    url: "https://example.com/relative-feed",
    type: "script",
    enabled: true,
    recentDays: 2,
    limit: 10,
  }, {
    recentDays: 2,
    now: "2026-04-14T12:00:00.000Z",
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, "Relative legacy article");
  await assert.rejects(fs.access(result.diagnostics.outputPath));
});
