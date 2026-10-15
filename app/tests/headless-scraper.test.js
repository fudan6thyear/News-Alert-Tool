import test from "node:test";
import assert from "node:assert/strict";

import {
  mapDataGuidanceApiArticles,
  resolveDataGuidanceContentUrl,
} from "../services/headless-scraper.js";

test("resolveDataGuidanceContentUrl returns absolute DataGuidance url", () => {
  assert.equal(
    resolveDataGuidanceContentUrl("/news/poland-uodo-announces-supreme-administrative-court-debt-deceased-person"),
    "https://www.dataguidance.com/news/poland-uodo-announces-supreme-administrative-court-debt-deceased-person"
  );
});

test("mapDataGuidanceApiArticles converts API payload into fetch items", () => {
  const items = mapDataGuidanceApiArticles([
    {
      publishedOn: "2026-04-13T12:48:46+01:00",
      url: "/news/poland-uodo-announces-supreme-administrative-court-debt-deceased-person",
      title: {
        en: "Poland: UODO announces Supreme Administrative Court ruling on debt enforcement of a deceased person",
      },
      authority: {
        en: "Polish data protection authority (UODO)",
      },
      augmentation: {
        synopsis: "The Supreme Administrative Court upheld UODO's decision on unlawful personal data processing.",
      },
    },
  ]);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    title: "Poland: UODO announces Supreme Administrative Court ruling on debt enforcement of a deceased person",
    link: "https://www.dataguidance.com/news/poland-uodo-announces-supreme-administrative-court-debt-deceased-person",
    description: "The Supreme Administrative Court upheld UODO's decision on unlawful personal data processing.",
    publish_time: "2026-04-13T11:48:46.000Z",
    author: "Polish data protection authority (UODO)",
  });
});

test("mapDataGuidanceApiArticles strips html when only html body is present", () => {
  const items = mapDataGuidanceApiArticles([
    {
      publishedOn: "2026-04-13T12:48:46+01:00",
      url: "/news/example-html-only",
      title: { en: "Example html-only article" },
      contentBody: {
        html: {
          en: "<p><strong>Summary</strong> with <em>markup</em> that should become plain text.</p>",
        },
      },
    },
  ]);

  assert.equal(items[0].description, "Summary with markup that should become plain text.");
});
