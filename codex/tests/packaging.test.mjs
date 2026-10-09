import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
test("portable CLI package resolves its entry point and onboarding skill without starting a server", () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const catalog = JSON.parse(fs.readFileSync(path.join(root, ".agents/plugins/marketplace.json"), "utf8"));
  assert.equal(plugin.license, "MIT");
  assert.equal(catalog.plugins[0].name, plugin.name);
  assert.equal(fs.existsSync(path.join(root, "mcp.json")), false);
  assert.ok(fs.existsSync(path.join(root, "scripts/grok-companion.mjs")));
  assert.equal(pkg.scripts.start, "node scripts/grok-companion.mjs");
  assert.equal(plugin.version, pkg.version);
  assert.ok(fs.existsSync(path.join(root, plugin.extensions["com.openai"].onboardingSkill)));
});
