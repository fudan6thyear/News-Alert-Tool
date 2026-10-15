import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const PROJECT_DIR = path.resolve(APP_DIR, "..");
const MCP_SERVER_SCRIPT = path.resolve(PROJECT_DIR, "dist/index.cjs");
const runtimeRequire = createRequire(import.meta.url);

const CONNECT_TIMEOUT_MS = 30_000;

const TOOL_LIMIT_PARAMS = {
  get_zhihu_trending: "limit",
  get_douban_rank: "count",
  get_ifanr_news: "limit",
  get_sspai_rank: "limit",
  get_tencent_news_trending: "page_size",
};
const MCP_RUNTIME_DEPENDENCIES = [
  "dayjs",
  "dayjs/locale/zh-cn.js",
  "axios",
  "fast-xml-parser",
  "es-toolkit",
  "zod",
  "@modelcontextprotocol/sdk/server/mcp.js",
  "@modelcontextprotocol/sdk/server/stdio.js",
  "@modelcontextprotocol/sdk/types.js",
];

function splitNodePath(value) {
  return String(value || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildMcpServerBootstrap(baseEnv = process.env) {
  const moduleRoots = [
    path.join(APP_DIR, "node_modules"),
    path.join(PROJECT_DIR, "node_modules"),
    ...splitNodePath(baseEnv.NODE_PATH),
  ].filter((entry, index, arr) => arr.indexOf(entry) === index);

  return {
    command: process.execPath,
    args: [MCP_SERVER_SCRIPT],
    cwd: APP_DIR,
    serverScript: MCP_SERVER_SCRIPT,
    env: {
      ...baseEnv,
      NODE_PATH: moduleRoots.join(path.delimiter),
    },
  };
}

export function findMissingMcpRuntimeDependencies(
  baseEnv = process.env,
  resolver = (specifier, options) => runtimeRequire.resolve(specifier, options)
) {
  const bootstrap = buildMcpServerBootstrap(baseEnv);
  const resolutionPaths = [
    APP_DIR,
    PROJECT_DIR,
    ...splitNodePath(bootstrap.env.NODE_PATH),
  ].filter((entry, index, arr) => arr.indexOf(entry) === index);

  return MCP_RUNTIME_DEPENDENCIES.filter((specifier) => {
    try {
      resolver(specifier, { paths: resolutionPaths });
      return false;
    } catch {
      return true;
    }
  });
}

class MCPClientService {
  constructor() {
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.connected = false;
    this._startTime = null;
    this._reconnecting = false;
    this._connectPromise = null;
    this._connectAttempt = 0;
  }

  getStatus() {
    return {
      connected: this.connected,
      startTime: this._startTime,
      uptime: this._startTime ? Date.now() - this._startTime : 0,
    };
  }

  async connect() {
    if (this.connected) return;
    if (this._connectPromise) return this._connectPromise;

    const attempt = ++this._connectAttempt;
    const missingDependencies = findMissingMcpRuntimeDependencies(process.env);
    if (missingDependencies.length > 0) {
      throw new Error(`Missing MCP runtime dependencies: ${missingDependencies.join(", ")}`);
    }
    const bootstrap = buildMcpServerBootstrap();
    const transport = new StdioClientTransport({
      command: bootstrap.command,
      args: bootstrap.args,
      cwd: bootstrap.cwd,
      env: bootstrap.env,
    });
    const client = new Client({ name: "news-alert", version: "1.0.0" });

    const promise = (async () => {
      try {
        const connectPromise = client.connect(transport);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("MCP connect timeout")), CONNECT_TIMEOUT_MS)
        );
        await Promise.race([connectPromise, timeoutPromise]);
        if (attempt !== this._connectAttempt) {
          try {
            await client.close();
          } catch {
            // ignore close errors
          }
          throw new Error("Superseded MCP connect");
        }
        this.transport = transport;
        this.client = client;
        this.connected = true;
        this._startTime = Date.now();
        console.log("[MCP] Connected to mcp-trends-hub server");

        if (transport.process) {
          transport.process.on("exit", (code) => {
            console.warn(`[MCP] Child process exited with code ${code}`);
            if (attempt === this._connectAttempt) {
              this.connected = false;
              this._startTime = null;
              this.client = null;
              this.transport = null;
            }
          });
        }
      } catch (err) {
        try {
          await client.close();
        } catch {
          // ignore close errors
        }
        if (attempt === this._connectAttempt) {
          this.connected = false;
          this.client = null;
          this.transport = null;
          this._startTime = null;
        }
        throw new Error(`Failed to connect to MCP server: ${err.message}`);
      } finally {
        if (this._connectPromise === promise) {
          this._connectPromise = null;
        }
      }
    })();

    this._connectPromise = promise;
    return promise;
  }

  async disconnect() {
    this._connectAttempt += 1;
    this._connectPromise = null;
    if (!this.connected && !this.client) return;
    const client = this.client;
    const transport = this.transport;
    this.connected = false;
    this._startTime = null;
    this.client = null;
    this.transport = null;
    try {
      if (client) await client.close();
    } catch {
      // ignore close errors
    }
    if (transport?.process && !transport.process.killed) {
      try {
        transport.process.kill();
      } catch {
        // ignore process kill errors
      }
    }
  }

  async reconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    try {
      await this.disconnect();
      await this.connect();
    } finally {
      this._reconnecting = false;
    }
  }

  async ensureConnected() {
    if (!this.connected) {
      await this.connect();
    }
  }

  async listTools() {
    await this.ensureConnected();
    try {
      const resp = await this.client.listTools();
      this.tools = resp.tools || [];
      return this.tools;
    } catch (err) {
      console.error("[MCP] listTools failed, reconnecting...", err.message);
      await this.reconnect();
      const resp = await this.client.listTools();
      this.tools = resp.tools || [];
      return this.tools;
    }
  }

  async callTool(name, args = {}) {
    await this.ensureConnected();
    try {
      const result = await this.client.callTool({ name, arguments: args });
      return this._parseResult(result, name);
    } catch (err) {
      console.error(`[MCP] callTool(${name}) failed, reconnecting...`, err.message);
      await this.reconnect();
      const result = await this.client.callTool({ name, arguments: args });
      return this._parseResult(result, name);
    }
  }

  _stripHtml(html) {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&#0?38;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  _parseResult(result, sourceName) {
    if (!result || !result.content) return [];

    const textFields = new Set(["title", "description", "author", "category"]);

    return result.content
      .filter((item) => item.type === "text" && item.text)
      .map((item) => {
        const parsed = {};
        const regex = /<(\w+)>([\s\S]*?)<\/\1>/g;
        let match;
        while ((match = regex.exec(item.text)) !== null) {
          const key = match[1];
          let value = match[2];
          if (textFields.has(key) && /<[a-z][\s\S]*>/i.test(value)) {
            value = this._stripHtml(value);
          }
          parsed[key] = value;
        }
        parsed._source = sourceName;
        return parsed;
      });
  }

  async fetchMultipleSources(sourceConfigs) {
    await this.ensureConnected();
    const allResults = [];
    const errors = [];

    for (const cfg of sourceConfigs) {
      const name = typeof cfg === "string" ? cfg : cfg.name;
      const limit = typeof cfg === "string" ? 0 : (cfg.limit || 0);

      try {
        console.log(`[MCP] Fetching ${name}${limit ? ` (limit ${limit})` : ""}...`);
        const args = {};
        if (limit && TOOL_LIMIT_PARAMS[name]) {
          args[TOOL_LIMIT_PARAMS[name]] = limit;
        }
        let items = await this.callTool(name, args);
        if (limit && items.length > limit) {
          items = items.slice(0, limit);
        }
        items.forEach((item) => { item._group = "news"; });
        allResults.push(...items);
      } catch (err) {
        console.error(`[MCP] Error fetching ${name}:`, err.message);
        errors.push({ source: name, error: err.message });
      }
    }

    return { items: allResults, errors };
  }
}

function cleanup() {
  if (mcpClient.connected) {
    mcpClient.disconnect().catch(() => {});
  }
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

export const mcpClient = new MCPClientService();
