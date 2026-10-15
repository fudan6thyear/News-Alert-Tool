import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  emitStructuredScriptResult,
  parseScriptRuntimeArgs,
} from "../../../script-runtime/news-alert-script-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("parseScriptRuntimeArgs accepts shared start/end flags", () => {
  const args = parseScriptRuntimeArgs([
    "--start", "2026-04-01T00:00:00.000Z",
    "--end", "2026-04-14T00:00:00.000Z",
    "--out", "sample.csv",
  ], {
    defaultStartIso: "2026-03-01T00:00:00.000Z",
    defaultOut: "fallback.csv",
  });

  assert.deepEqual(args, {
    startIso: "2026-04-01T00:00:00.000Z",
    endIso: "2026-04-14T00:00:00.000Z",
    out: "sample.csv",
  });
});

test("parseScriptRuntimeArgs accepts legacy date-from/date-to flags", () => {
  const args = parseScriptRuntimeArgs([
    "--date-from", "2026-04-01T00:00:00.000Z",
    "--date-to", "2026-04-14T00:00:00.000Z",
  ], {
    defaultStartIso: "2026-03-01T00:00:00.000Z",
    defaultOut: "fallback.csv",
  });

  assert.deepEqual(args, {
    startIso: "2026-04-01T00:00:00.000Z",
    endIso: "2026-04-14T00:00:00.000Z",
    out: "fallback.csv",
  });
});

test("emitStructuredScriptResult normalizes csv-style items into News Alert payload", () => {
  const payload = emitStructuredScriptResult([
    {
      publish_time: "2026-04-13T12:00:00.000Z",
      title: "Example title",
      link: "https://example.com/item",
      summary: "Example summary",
      source_key: "example_source",
      source_name: "Example Source",
      source_list_url: "https://example.com/feed",
      source_page: 2,
      extra_field: "preserved in raw payload",
    },
  ]);

  assert.deepEqual(payload, {
    contractVersion: 1,
    status: "success",
    items: [
      {
        title: "Example title",
        link: "https://example.com/item",
        publishTime: "2026-04-13T12:00:00.000Z",
        summary: "Example summary",
        sourceKey: "example_source",
        sourceName: "Example Source",
        sourceListUrl: "https://example.com/feed",
        sourcePage: 2,
        rawPayload: {
          publish_time: "2026-04-13T12:00:00.000Z",
          title: "Example title",
          link: "https://example.com/item",
          summary: "Example summary",
          source_key: "example_source",
          source_name: "Example Source",
          source_list_url: "https://example.com/feed",
          source_page: 2,
          extra_field: "preserved in raw payload",
        },
      },
    ],
    diagnostics: {
      rawCount: 1,
      uniqueCount: 1,
      notices: ["structured_stdout"],
    },
    error: null,
  });
});

test("danish regulator script keeps a news-only path filter without hardcoding quarter-specific dates", async () => {
  const scriptPath = path.resolve(__dirname, "../../..", "丹麦监管机构Datatilsynet 脚本", "fetch_danish_dpa_all_v1.mjs");
  const source = await fs.readFile(scriptPath, "utf8");

  assert.equal(source.includes("\\/presse-og-nyheder\\/nyhedsarkiv\\/"), true);
  assert.equal(source.includes("\\/presse-og-nyheder\\/nyhedsarkiv\\/2026\\/"), false);
  assert.equal(source.includes("\\/2026\\/(jan|feb|mar)\\/"), false);
  assert.equal(source.includes("const publish_time = new Date(m[2]).toISOString();"), false);
});

test("dutch AP script validates pubDate before converting it to ISO", async () => {
  const scriptPath = path.resolve(__dirname, "../../..", "荷兰监管机构AP 脚本", "fetch_dutch_ap_all_v1.mjs");
  const source = await fs.readFile(scriptPath, "utf8");

  assert.equal(source.includes("const publish_time = new Date(pubDateRaw).toISOString();"), false);
});

test("romanian ANSPDCP script supports runtime out path and avoids legacy URL patching", async () => {
  const scriptPath = path.resolve(__dirname, "../../..", "罗马尼亚监管机构ANSPDCP 脚本", "fetch_romanian_anspdcp_all_v1.mjs");
  const source = await fs.readFile(scriptPath, "utf8");

  assert.equal(source.includes("parseScriptRuntimeArgs("), true);
  assert.equal(source.includes("const END_ISO = new Date().toISOString();"), false);
  assert.equal(source.includes("new URL(OUT, SCRIPT_DIR)"), false);
});
