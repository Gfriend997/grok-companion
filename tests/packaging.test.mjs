import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

test("plugin manifests and hooks parse as JSON", () => {
  for (const file of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "hooks/hooks.json"]) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8")), file);
  }
});

test("routing policy is key-aware, versioned, and explicitly overrides image routing", () => {
  const run = (env) => spawnSync(process.execPath, ["scripts/print-routing-policy.mjs"], { encoding: "utf8", env: { ...process.env, ...env } });
  const absent = run({ XAI_API_KEY: "" });
  assert.equal(absent.status, 0);
  assert.match(absent.stdout, /grok-companion-routing-v2/);
  assert.match(absent.stdout, /Gemini/);
  const present = run({ XAI_API_KEY: "test-key" });
  assert.equal(present.status, 0);
  assert.match(present.stdout, /Grok is available/);
  assert.match(present.stdout, /overrides prior companion policy/);
});

test("stop-review gate is disabled by default", () => {
  const result = spawnSync(process.execPath, ["scripts/stop-review-gate-hook.mjs"], { encoding: "utf8", env: { ...process.env, GROK_STOP_REVIEW_GATE: "" } });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});
