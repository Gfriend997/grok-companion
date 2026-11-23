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
  assert.match(absent.stdout, /grok-companion-routing-v3/);
  assert.match(absent.stdout, /Gemini/);
  const present = run({ XAI_API_KEY: "test-key" });
  assert.equal(present.status, 0);
  assert.match(present.stdout, /Grok is available/);
  assert.match(present.stdout, /overrides prior companion policy/);
  assert.match(present.stdout, /--confirm-cost/);
  assert.match(present.stdout, /stop-review gate/);
});

test("speak and transcribe slash commands exist and the version is 0.1.5", () => {
  for (const file of ["commands/speak.md", "commands/transcribe.md"]) assert.ok(fs.existsSync(file), file);
  assert.equal(JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8")).version, "0.1.5");
});
