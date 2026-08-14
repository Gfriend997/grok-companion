import test from "node:test";
import assert from "node:assert/strict";
import { preflight, scrubDeep, scrubText } from "../scripts/lib/scrub.mjs";

const xaiKey = "x" + "ai-" + "a".repeat(32);

test("scrubText masks provider keys and reports their count", () => {
  const result = scrubText(`keep ${xaiKey} out`);
  assert.equal(result.text, "keep [REDACTED] out");
  assert.equal(result.maskedMatches, 1);
});

test("scrubDeep masks strings inside job records", () => {
  assert.deepEqual(scrubDeep({ request: { text: xaiKey }, list: ["ok", xaiKey] }), {
    request: { text: "[REDACTED]" },
    list: ["ok", "[REDACTED]"]
  });
});

test("preflight rejects secret-shaped text", () => {
  assert.deepEqual(preflight(xaiKey), { ok: false, reason: "secret-shaped content detected" });
});

test("preflight rejects credential paths", () => {
  assert.deepEqual(preflight("safe", { sourcePath: ".env.production" }), {
    ok: false,
    reason: "credential file paths are not allowed"
  });
});

test("preflight accepts ordinary source text", () => {
  assert.deepEqual(preflight("export const answer = 42;", { sourcePath: "src/index.js" }), { ok: true });
});
