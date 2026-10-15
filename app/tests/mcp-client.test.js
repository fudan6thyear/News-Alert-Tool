import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  buildMcpServerBootstrap,
  findMissingMcpRuntimeDependencies,
} from "../services/mcp-client.js";

test("buildMcpServerBootstrap uses app context and app node_modules", () => {
  const bootstrap = buildMcpServerBootstrap({ PATH: "C:\\Windows\\System32" });

  assert.match(bootstrap.serverScript, /News_Alert[\\/]dist[\\/]index\.cjs$/);
  assert.match(bootstrap.cwd, /News_Alert[\\/]app$/);
  assert.equal(
    bootstrap.env.NODE_PATH.split(path.delimiter).includes(path.join(bootstrap.cwd, "node_modules")),
    true
  );
});

test("buildMcpServerBootstrap preserves existing NODE_PATH entries", () => {
  const bootstrap = buildMcpServerBootstrap({
    PATH: "C:\\Windows\\System32",
    NODE_PATH: ["C:\\shared\\node_modules", "D:\\deps"].join(path.delimiter),
  });

  const parts = bootstrap.env.NODE_PATH.split(path.delimiter);
  assert.equal(parts.includes("C:\\shared\\node_modules"), true);
  assert.equal(parts.includes("D:\\deps"), true);
});

test("findMissingMcpRuntimeDependencies reports unresolved external runtime packages", () => {
  const missing = findMissingMcpRuntimeDependencies(undefined, (specifier) => {
    if (specifier === "zod" || specifier === "@modelcontextprotocol/sdk/server/mcp.js") {
      return `resolved:${specifier}`;
    }
    throw new Error(`missing:${specifier}`);
  });

  assert.deepEqual(missing, [
    "dayjs",
    "dayjs/locale/zh-cn.js",
    "axios",
    "fast-xml-parser",
    "es-toolkit",
    "@modelcontextprotocol/sdk/server/stdio.js",
    "@modelcontextprotocol/sdk/types.js",
  ]);
});

test("findMissingMcpRuntimeDependencies resolves against injected NODE_PATH roots", () => {
  const seenPaths = [];
  findMissingMcpRuntimeDependencies(
    { NODE_PATH: ["C:\\shared\\node_modules", "D:\\deps"].join(path.delimiter) },
    (_specifier, options) => {
      seenPaths.push(...(options?.paths || []));
      return "resolved";
    }
  );

  assert.equal(seenPaths.includes("C:\\shared\\node_modules"), true);
  assert.equal(seenPaths.includes("D:\\deps"), true);
});
