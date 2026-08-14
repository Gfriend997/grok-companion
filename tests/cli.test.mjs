import test from "node:test";
import assert from "node:assert/strict";
import { main, selectModel } from "../scripts/grok-companion.mjs";

function harness(overrides = {}) {
  const lines = [];
  const calls = [];
  const deps = {
    env: { XAI_API_KEY: "hidden-key" },
    stdout: { write: (line) => lines.push(String(line).trim()) },
    scrub: { preflight: () => ({ ok: true }), scrubDeep: (value) => value },
    attach: { toParts: () => ({ parts: [], tokenEstimate: 1, totalBytes: 0 }) },
    api: {
      chat: async (request) => { calls.push(request); return { content: "answer", usage: { total_tokens: 3 } }; },
      respond: async (request) => { calls.push(request); return { content: "fresh", citations: [{ url: "https://example.test", title: "Example" }], usage: { num_sources_used: 1 } }; },
      listModels: async () => [{ id: "grok-4.3", contextLength: 1000000 }]
    },
    media: {
      generateImage: async (request) => { calls.push(request); return { b64: "AA==" }; },
      createVideoJob: async (request) => { calls.push(request); return { providerJobId: "p1" }; },
      pollVideo: async () => ({ state: "done", progress: 100, url: "https://vidgen.x.ai/v.mp4", usageTicks: 1 }),
      downloadArtifact: async () => ({ path: "out.jpg", mime: "image/jpeg", bytes: 2 })
    },
    jobs: {
      createJob: () => "local-1", recordSubmission: () => {}, refresh: async () => ({ state: "done" }), listJobs: () => [], getJob: () => ({ id: "local-1", state: "done" }), cancelJob: async () => ({ id: "local-1", state: "abandoned" })
    },
    ...overrides
  };
  return { deps, lines, calls };
}

test("selectModel covers every routing-table row and explicit override", () => {
  const rows = [
    ["ask", {}, "grok-4.3"], ["ask", { live: true }, "grok-4.6"], ["review", {}, "grok-4.3"],
    ["adversarial-review", {}, "grok-4.6"], ["rescue", {}, "grok-4.6"], ["rescue", { coding: true }, "grok-build-0.1"], ["transfer", {}, "grok-4.3"]
  ];
  for (const [kind, flags, expected] of rows) assert.equal(selectModel(kind, flags, 10).model, expected);
  assert.deepEqual(selectModel("ask", { model: "custom" }, 10), { model: "custom", fallbackApplied: false });
});

test("ask sends one selected request body and preflight rejection never reaches the client", async () => {
  const good = harness();
  assert.equal(await main(["ask", "hello"], good.deps), 0);
  assert.deepEqual(good.calls[0], { model: "grok-4.3", messages: [{ role: "user", content: "hello" }] });
  const bad = harness({ scrub: { preflight: () => ({ ok: false, reason: "secret" }), scrubDeep: (v) => v } });
  assert.equal(await main(["ask", "blocked"], bad.deps), 9);
  assert.equal(bad.calls.length, 0);
});

test("live ask uses responses and returns the untrusted-content envelope", async () => {
  const run = harness();
  assert.equal(await main(["ask", "now", "--live"], run.deps), 0);
  assert.equal(run.calls[0].model, "grok-4.6");
  assert.match(run.lines.join("\n"), /\[UNTRUSTED-EXTERNAL-CONTENT\]/);
  assert.match(run.lines.join("\n"), /https:\/\/example.test/);
});

test("all delegation commands have a happy path", async () => {
  const rows = [
    ["review", [], "grok-4.3"],
    ["adversarial-review", [], "grok-4.6"],
    ["rescue", [], "grok-4.6"],
    ["rescue", ["--coding"], "grok-build-0.1"],
    ["transfer", [], "grok-4.3"]
  ];
  for (const [command, flags, model] of rows) {
    const run = harness();
    assert.equal(await main([command, "scope", ...flags], run.deps), 0, command);
    assert.equal(run.calls.length, 1, command);
    assert.equal(run.calls[0].model, model, `${command} request model`);
  }
});

test("imagine, video, and job management commands have happy paths", async () => {
  const image = harness();
  assert.equal(await main(["imagine", "apple"], image.deps), 0);
  const video = harness();
  assert.equal(await main(["video", "apple", "--seconds", "2"], video.deps), 0);
  assert.match(video.lines[0], /^2 × \$0\.08 = \$0\.16$/);
  for (const command of [["status"], ["result", "--id", "local-1"], ["cancel", "--id", "local-1"]]) {
    const run = harness();
    assert.equal(await main(command, run.deps), 0);
    assert.doesNotThrow(() => JSON.parse(run.lines.at(-1)));
  }
});

test("video requires seconds and long context needs explicit approval", async () => {
  assert.equal(await main(["video", "apple"], harness().deps), 9);
  const run = harness({ attach: { toParts: () => ({ parts: [], tokenEstimate: 200000, totalBytes: 0 }) } });
  assert.equal(await main(["ask", "long", "--file", "a.txt"], run.deps), 9);
});

test("setup reports key presence without exposing it", async () => {
  const run = harness();
  assert.equal(await main(["setup"], run.deps), 0);
  assert.ok(!run.lines.join("\n").includes("hidden-key"));
});

test("each structured error class maps to its required exit code", async () => {
  const exits = { auth: 2, quota: 3, rate_limit: 4, moderation: 5, network: 6, submission_unknown: 7, capability_unavailable: 8, usage: 9 };
  for (const [error_class, expected] of Object.entries(exits)) {
    const error = Object.assign(new Error("safe failure"), { error_class, retryable: false });
    const run = harness({ api: { chat: async () => { throw error; } } });
    assert.equal(await main(["ask", "x"], run.deps), expected, error_class);
    assert.equal(JSON.parse(run.lines.at(-1)).error_class, error_class);
  }
});
