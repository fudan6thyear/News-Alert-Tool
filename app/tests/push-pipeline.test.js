import test from "node:test";
import assert from "node:assert/strict";

import { mcpClient } from "../services/mcp-client.js";
import { classifyNewsFetchOutcome, fetchUnifiedSnapshot } from "../services/push-pipeline.js";

test("classifyNewsFetchOutcome reports MCP discovery failures explicitly", () => {
  const outcome = classifyNewsFetchOutcome({
    explicitSources: null,
    hasEnabledNewsSources: true,
    requestedSourceCount: 0,
    resolvedSourceCount: 0,
    discoveryError: "Failed to connect to MCP server",
    fetchedItemCount: 0,
    filteredItemCount: 0,
    filterDiagnostics: { totals: { beforeFilter: 0, afterFilter: 0, missingDate: 0, outsideRecentDays: 0 } },
  });

  assert.deepEqual(outcome, {
    status: "mcp_discovery_failed",
    reason: "Failed to connect to MCP server",
  });
});

test("classifyNewsFetchOutcome distinguishes empty manual selection", () => {
  const outcome = classifyNewsFetchOutcome({
    explicitSources: [],
    hasEnabledNewsSources: true,
    requestedSourceCount: 0,
    resolvedSourceCount: 0,
    discoveryError: "",
    fetchedItemCount: 0,
    filteredItemCount: 0,
    filterDiagnostics: { totals: { beforeFilter: 0, afterFilter: 0, missingDate: 0, outsideRecentDays: 0 } },
  });

  assert.deepEqual(outcome, {
    status: "no_requested_news_sources",
    reason: "manual request did not include any news sources",
  });
});

test("classifyNewsFetchOutcome distinguishes recentDays filtering from fetch failure", () => {
  const outcome = classifyNewsFetchOutcome({
    explicitSources: null,
    hasEnabledNewsSources: true,
    requestedSourceCount: 3,
    resolvedSourceCount: 3,
    discoveryError: "",
    fetchedItemCount: 7,
    filteredItemCount: 0,
    filterDiagnostics: { totals: { beforeFilter: 7, afterFilter: 0, missingDate: 0, outsideRecentDays: 7 } },
  });

  assert.deepEqual(outcome, {
    status: "filtered_out_by_recent_days",
    reason: "all fetched news items were filtered by recentDays",
  });
});

test("fetchUnifiedSnapshot skips MCP discovery when manual news selection is empty", async (t) => {
  const originalListTools = mcpClient.listTools;
  let listToolsCalls = 0;
  mcpClient.listTools = async () => {
    listToolsCalls += 1;
    throw new Error("listTools should not be called");
  };
  t.after(() => {
    mcpClient.listTools = originalListTools;
  });

  const result = await fetchUnifiedSnapshot({
    sources: [],
    skipCompliance: true,
  });

  assert.equal(listToolsCalls, 0);
  assert.deepEqual(
    {
      status: result.diagnostics.news.status,
      reason: result.diagnostics.news.reason,
    },
    {
      status: "no_requested_news_sources",
      reason: "manual request did not include any news sources",
    }
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.newsItems.length, 0);
});
