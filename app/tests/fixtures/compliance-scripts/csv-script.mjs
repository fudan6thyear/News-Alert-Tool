#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, index, list) => {
    if (!token.startsWith("--")) return pairs;
    const key = token.slice(2);
    const next = list[index + 1];
    pairs.push([key, next && !next.startsWith("--") ? next : "true"]);
    return pairs;
  }, [])
);

const outPath = args.out ? path.resolve(args.out) : path.resolve("fixture-output.csv");
const rows = [
  "publish_time,title,link,summary,source_key,source_name,source_list_url,source_page",
  `${args.start || "2026-04-11T00:00:00.000Z"},CSV fixture article,https://example.com/csv,CSV fixture summary,csv_fixture,CSV Fixture,https://example.com/csv-feed,0`,
];

fs.writeFileSync(outPath, rows.join("\n"), "utf8");
console.log(`fixture: csv wrote ${outPath}`);
