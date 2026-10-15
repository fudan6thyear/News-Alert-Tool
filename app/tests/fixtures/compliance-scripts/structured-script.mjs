#!/usr/bin/env node

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, index, list) => {
    if (!token.startsWith("--")) return pairs;
    const key = token.slice(2);
    const next = list[index + 1];
    pairs.push([key, next && !next.startsWith("--") ? next : "true"]);
    return pairs;
  }, [])
);

console.log("fixture: structured start");
console.log("::NEWS_ALERT_RESULT_START::");
console.log(JSON.stringify({
  contractVersion: 1,
  status: "success",
  items: [
    {
      title: "Structured fixture article",
      link: "https://example.com/structured",
      publishTime: args.start || "2026-04-10T00:00:00.000Z",
      summary: "Structured fixture summary",
      sourceKey: "structured_fixture",
      sourceName: "Structured Fixture",
      sourceListUrl: "https://example.com/structured-feed",
      sourcePage: 0,
      rawPayload: args,
    },
  ],
  diagnostics: {
    rawCount: 1,
    uniqueCount: 1,
    notices: ["structured_fixture"],
  },
  error: null,
}));
console.log("::NEWS_ALERT_RESULT_END::");
