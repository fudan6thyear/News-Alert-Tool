import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_COMPLIANCE_SOURCES,
  mergeSavedComplianceSource,
} from "../services/compliance-sources.js";

test("dataguidance source does not fall back to Google News", () => {
  const source = DEFAULT_COMPLIANCE_SOURCES.dataguidance_news;
  assert.equal(source.fallbackOnEmpty, undefined);
  assert.equal(source.fallback, undefined);
});

test("default compliance sources retain community feeds and add script-backed sources", () => {
  const scriptSources = Object.entries(DEFAULT_COMPLIANCE_SOURCES)
    .filter(([, value]) => value.type === "script")
    .map(([key]) => key);

  assert.ok(scriptSources.includes("dataguidance_news"));
  assert.ok(scriptSources.includes("edpb_news"));
  assert.ok(scriptSources.includes("eu_commission_news"));
  assert.ok(scriptSources.includes("iapp_news"));
  assert.ok(scriptSources.includes("beuc_position_papers"));
  assert.ok(scriptSources.includes("ecommerce_europe_news"));
  assert.ok(scriptSources.includes("somi_noyb_news"));
  assert.ok(scriptSources.includes("ico_news"));
  assert.ok(scriptSources.includes("cnil_news"));
  assert.ok(scriptSources.includes("irish_dpc_news"));
  assert.equal(scriptSources.length, 32);

  assert.equal(DEFAULT_COMPLIANCE_SOURCES.gn_eu_ai_act.type, "rss");
  assert.equal(DEFAULT_COMPLIANCE_SOURCES.gn_eu_data_act.type, "rss");
  assert.equal(DEFAULT_COMPLIANCE_SOURCES.gn_cn_tech_us_eu_enforcement.type, "rss");
  assert.equal(DEFAULT_COMPLIANCE_SOURCES.gn_data_transfer_eu_us.type, "rss");
  assert.equal(DEFAULT_COMPLIANCE_SOURCES.gn_privacy_legislation_enforcement.type, "rss");
  assert.equal(DEFAULT_COMPLIANCE_SOURCES.gn_bambulab_privacy_concerns.type, "rss");
  assert.equal(DEFAULT_COMPLIANCE_SOURCES.reddit_bambulab_privacy_security.type, "rss");
  assert.equal(DEFAULT_COMPLIANCE_SOURCES.forum_bambulab_privacy_security.type, "rss");
  assert.equal(DEFAULT_COMPLIANCE_SOURCES.facebook_bambulab_privacy_security.type, "rss");

  assert.equal("ie_dpc_latest_news" in DEFAULT_COMPLIANCE_SOURCES, false);
  assert.equal("ie_dpc_press_releases" in DEFAULT_COMPLIANCE_SOURCES, false);
  assert.equal("bundeskartellamt_updates" in DEFAULT_COMPLIANCE_SOURCES, false);
  assert.equal("autorite_concurrence_news" in DEFAULT_COMPLIANCE_SOURCES, false);
  assert.equal("agcm_media" in DEFAULT_COMPLIANCE_SOURCES, false);
  assert.equal("garante_privacy_comunicati" in DEFAULT_COMPLIANCE_SOURCES, false);
  assert.equal("garante_privacy_newsletter" in DEFAULT_COMPLIANCE_SOURCES, false);
  assert.equal("ccpc_business_news" in DEFAULT_COMPLIANCE_SOURCES, false);
  assert.equal("somi_news" in DEFAULT_COMPLIANCE_SOURCES, false);
});

test("mergeSavedComplianceSource only keeps user-tunable fields from persisted config", () => {
  const merged = mergeSavedComplianceSource(
    {
      type: "script",
      url: "https://example.com/new-script-source",
      enabled: true,
      limit: 20,
      recentDays: 3,
    },
    {
      type: "rss",
      url: "https://example.com/old-rss-source",
      enabled: false,
      limit: 7,
      recentDays: 9,
      fallbackOnEmpty: true,
    }
  );

  assert.deepEqual(merged, {
    type: "script",
    url: "https://example.com/new-script-source",
    enabled: false,
    limit: 7,
    recentDays: 9,
  });
});
