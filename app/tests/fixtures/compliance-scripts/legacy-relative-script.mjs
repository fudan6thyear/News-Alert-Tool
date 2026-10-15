#!/usr/bin/env node
import fs from "node:fs";
import { buildLegacyRows } from "./legacy-relative-helper.mjs";

const START_ISO = "2026-03-01T00:00:00.000Z";
const END_ISO = new Date().toISOString();
const OUT = "legacy-relative-output.csv";

fs.writeFileSync(OUT, buildLegacyRows(START_ISO, END_ISO).join("\n"), "utf8");
console.log(`legacy relative fixture wrote ${OUT}`);
