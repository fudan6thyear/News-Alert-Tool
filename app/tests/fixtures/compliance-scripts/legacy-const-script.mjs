#!/usr/bin/env node
import fs from "node:fs";

const START_ISO = "2026-03-01T00:00:00.000Z";
const END_ISO = new Date().toISOString();
const OUT = "legacy-output.csv";

const rows = [
  "publish_time,title,link,summary,source_key,source_name,source_list_url,source_page",
  `${START_ISO},Legacy fixture article,https://example.com/legacy,Legacy fixture summary,legacy_fixture,Legacy Fixture,https://example.com/legacy-feed,0`,
  `${END_ISO},Legacy fixture end article,https://example.com/legacy-end,Legacy fixture end summary,legacy_fixture,Legacy Fixture,https://example.com/legacy-feed,1`,
];

fs.writeFileSync(OUT, rows.join("\n"), "utf8");
console.log(`legacy fixture wrote ${OUT}`);
