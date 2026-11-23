// Spec 005: video cost gate, --max-tokens, strict flags and downloadArtifact (tests 1 to 11).
import test from "node:test";
import assert from "node:assert/strict";
import { main } from "../scripts/grok-companion.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMedia } from "../scripts/lib/media.mjs";
import { harness } from "./support/harness.mjs";

const last = (run) => JSON.parse(run.lines.at(-1));
const TEXT = ["ask", "review", "adversarial-review", "rescue", "transfer"];

test("5. bad --max-tokens and --max-sources values exit 9 before any request", async () => {
  for (const value of ["0", "-1", "131073", "1.5", "NaN", "1e3", "0x10"]) {
    const run = harness({}, { catalog: "fixture" });
    assert.equal(await main(["ask", "hello", "--max-tokens", value], run.deps), 9, value);
    assert.equal(last(run).message, "--max-tokens must be a positive integer up to 131072", value);
    assert.equal(run.calls.length + run.catalogCalls.length, 0, value);
  }
  const live = harness({}, { catalog: "fixture" });
  assert.equal(await main(["ask", "now", "--live", "--max-sources", "0"], live.deps), 9);
  assert.equal(last(live).message, "--max-sources must be a positive integer");
  assert.equal(live.calls.length, 0, "no respond call");
});

test("6. an unknown flag exits 9 before any request", async () => {
  const run = harness({}, { catalog: "fixture" });
  assert.equal(await main(["ask", "--unknown", "value", "hello"], run.deps), 9);
  assert.deepEqual(last(run), { error_class: "usage", message: "unsupported flag: --unknown", retryable: false });
  assert.equal(run.calls.length + run.catalogCalls.length, 0);
});

test("7. each command accepts exactly its own flags", async () => {
  const value = { file: "a.txt", "max-sources": "2", "max-tokens": "10", model: "grok-4.3", source: "a.png", out: "x", seconds: "2", "from-image": "https://imgen.x.ai/a.png", voice: "eve", language: "en", "text-file": "a.txt", id: "local-1", gate: "on" };
  const table = {
    ask: ["file", "live", "max-sources", "max-tokens", "model", "allow-long-context", "coding", "build-unavailable", "background"],
    imagine: ["source", "out", "model"],
    video: ["seconds", "confirm-cost", "from-image", "wait", "out", "model"],
    speak: ["voice", "language", "out", "text-file"],
    transcribe: ["file", "language", "model"],
    status: ["id"], cancel: ["id"], result: ["id", "out"], setup: ["gate"]
  };
  for (const command of TEXT.slice(1)) table[command] = table.ask;
  // Each accepted flag runs to success, except two whose own downstream check is asserted instead (review fix).
  const base = { video: ["video", "x", "--seconds", "2", "--confirm-cost"], transcribe: ["transcribe", "--file", "a.mp3"], status: ["status"], cancel: ["cancel"], result: ["result", "--id", "local-1"], setup: ["setup"] };
  const model = { imagine: "grok-imagine-image-2.0", video: "grok-imagine-video-1.5", transcribe: "grok-voice-transcribe-2.0" };
  const expected = { "speak --text-file": [9, "speak requires text or --text-file, not both"] };
  for (const [command, flags] of Object.entries(table)) {
    for (const flag of flags) {
      const run = harness({}, { catalog: "fixture", repo: path.join(os.tmpdir(), "grok-flag-repo") });
      const argv = [...(base[command] ?? [command, "x"])];
      if (!argv.includes(`--${flag}`)) argv.push(`--${flag}`, ...(value[flag] ? [flag === "model" && model[command] ? model[command] : value[flag]] : []));
      const [code, message] = expected[`${command} --${flag}`] ?? [0];
      assert.equal(await main(argv, run.deps), code, `${argv.join(" ")}: ${run.lines.at(-1)}`);
      if (message) assert.equal(last(run).message, message);
      if (flag === "background") assert.equal(run.workers.length, 1, command);
    }
  }
  for (const argv of [["ask", "x", "--confirm-cost"], ["imagine", "x", "--max-tokens", "10"], ["video", "x", "--live"], ["video", "x", "--background"], ["speak", "x", "--background"], ["status", "--out", "x"], ["ask", "x", "--gate", "on"]]) {
    const run = harness({}, { catalog: "fixture" });
    assert.equal(await main(argv, run.deps), 9, argv.join(" "));
    assert.equal(last(run).message, `${argv[0]} does not support ${argv.find((item) => item.startsWith("--"))}`);
    assert.equal(run.calls.length + run.catalogCalls.length + run.jobsCreated.length, 0, argv.join(" "));
  }
  const rescue = harness();
  assert.equal(await main(["rescue", "x", "--build-unavailable"], rescue.deps), 0);
});

test("8. a bare -- ends flag parsing", async () => {
  const run = harness();
  assert.equal(await main(["ask", "--", "what", "does", "--force", "do"], run.deps), 0);
  assert.equal(run.calls[0].messages.at(-1).content, "what does --force do");
});

test("4. --max-tokens reaches chat for every text command and respond for ask --live, and is absent without the flag", async () => {
  for (const command of TEXT) {
    const run = harness({}, { catalog: "fixture" });
    assert.equal(await main([command, "scope", "--max-tokens", "10"], run.deps), 0, command);
    assert.equal(run.calls[0].maxTokens, 10, command);
    const plain = harness({}, { catalog: "fixture" });
    assert.equal(await main([command, "scope"], plain.deps), 0, command);
    assert.ok(!("maxTokens" in plain.calls[0]), command);
  }
  const live = harness({}, { catalog: "fixture" });
  assert.equal(await main(["ask", "now", "--live", "--max-tokens", "10"], live.deps), 0);
  assert.equal(live.calls[0].maxTokens, 10);
  assert.ok(live.calls[0].tools, "the respond request");
  const plainLive = harness({}, { catalog: "fixture" });
  assert.equal(await main(["ask", "now", "--live"], plainLive.deps), 0);
  assert.ok(!("maxTokens" in plainLive.calls[0]));
});

test("1. video without --confirm-cost is refused with the computed total and sends nothing", async () => {
  const run = harness({}, { catalog: "fixture" });
  assert.equal(await main(["video", "scene", "--seconds", "4"], run.deps), 9);
  const out = last(run);
  assert.equal(out.error_class, "usage");
  assert.equal(out.retryable, false);
  assert.match(out.message, /--confirm-cost/);
  assert.ok(out.message.includes("4 × $0.08 = $0.32"), out.message);
  assert.match(out.message, /Nothing was sent\.$/);
  assert.equal(run.lines.length, 1, "no cost line");
  assert.equal(run.catalogCalls.length + run.calls.length + run.jobsCreated.length, 0);
});

test("2. --seconds and the preflight are checked before the gate, with or without --confirm-cost", async () => {
  for (const confirm of [[], ["--confirm-cost"]]) {
    const missing = harness({}, { catalog: "fixture" });
    assert.equal(await main(["video", "scene", ...confirm], missing.deps), 9);
    assert.equal(last(missing).message, "video requires --seconds");
    const tooLong = harness({}, { catalog: "fixture" });
    assert.equal(await main(["video", "scene", "--seconds", "99", ...confirm], tooLong.deps), 9);
    assert.equal(last(tooLong).message, "--seconds must be an integer from 1 to 30");
    const rejected = harness({ scrub: { preflight: () => ({ ok: false, reason: "secret" }), scrubDeep: (value) => value } }, { catalog: "fixture" });
    assert.equal(await main(["video", "scene", "--seconds", "2", ...confirm], rejected.deps), 9);
    assert.equal(last(rejected).message, "content rejected before dispatch: secret");
    for (const run of [missing, tooLong, rejected]) assert.equal(run.catalogCalls.length + run.calls.length + run.jobsCreated.length, 0);
  }
});

test("3. with --confirm-cost, video prints today's cost line, then submits once", async () => {
  const run = harness({}, { catalog: "fixture" });
  assert.equal(await main(["video", "scene", "--seconds", "2", "--confirm-cost"], run.deps), 0);
  assert.equal(run.lines[0], "2 × $0.08 = $0.16 (unverified estimate; actual price depends on model grok-imagine-video-1.5)");
  assert.equal(JSON.parse(run.lines[1]).state, "submitted");
  assert.equal(run.lines.length, 2);
  assert.equal(run.calls.length, 1);
  assert.equal(run.jobsCreated.length, 1);
  const wait = harness({}, { catalog: "fixture" });
  assert.equal(await main(["video", "scene", "--seconds", "2", "--confirm-cost", "--wait"], wait.deps), 0);
  assert.match(wait.lines[0], /^2 × \$0\.08 = \$0\.16 /);
  assert.equal(wait.calls.length, 1);
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
function downloadDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-download-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("9. downloadArtifact takes the next free name when another run claims the target first", async (t) => {
  const dir = downloadDir(t);
  const media = createMedia({ fetchImpl: async () => new Response(JPEG) });
  const original = fs.writeFileSync;
  let raced = false;
  fs.writeFileSync = (target, ...rest) => {
    if (!raced && String(target).endsWith("race.jpg")) { raced = true; original(target, "other run"); }
    return original(target, ...rest);
  };
  try {
    const saved = await media.downloadArtifact("https://imgen.x.ai/a.jpg", dir, { out: "race.jpg" });
    assert.ok(raced);
    assert.equal(saved.path, path.join(dir, "race-1.jpg"));
    assert.equal(fs.readFileSync(path.join(dir, "race.jpg"), "utf8"), "other run");
    assert.deepEqual(fs.readFileSync(saved.path), JPEG);
  } finally {
    fs.writeFileSync = original;
  }
});

test("10. downloadArtifact aborts a silent fetch at the timeout and cancels an oversized stream", { timeout: 5000 }, async (t) => {
  const dir = downloadDir(t);
  // Review fix: a body that sends one chunk and then stalls is also cut at the timeout.
  const stalled = createMedia({ fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(JPEG); } })) });
  await assert.rejects(stalled.downloadArtifact("https://imgen.x.ai/a.jpg", dir, { timeoutMs: 20 }), /timed out/);
  const silent = createMedia({ fetchImpl: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) });
  await assert.rejects(silent.downloadArtifact("https://imgen.x.ai/a.jpg", dir, { timeoutMs: 20 }), /timed out/);
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(64)); },
    cancel() { cancelled = true; }
  });
  const big = createMedia({ fetchImpl: async () => new Response(stream) });
  await assert.rejects(big.downloadArtifact("https://imgen.x.ai/a.jpg", dir, { maxBytes: 100 }), /too large/);
  assert.ok(cancelled, "the body is cancelled");
  assert.deepEqual(fs.readdirSync(dir), [], "no file is written");
});

test("11. downloadArtifact saves a bad --out name as grok-artifact and returns that path", async (t) => {
  const dir = downloadDir(t);
  const media = createMedia({ fetchImpl: async () => new Response(JPEG) });
  // The spec's "a:b" is the drive-relative path "b" on Windows, so a name that fails everywhere is used.
  const saved = await media.downloadArtifact("https://imgen.x.ai/a.jpg", dir, { out: "a?b" });
  assert.equal(saved.path, path.join(dir, "grok-artifact.jpg"));
  assert.deepEqual(fs.readFileSync(saved.path), JPEG);
  const url = await media.downloadArtifact("https://imgen.x.ai/a:b.jpg", dir);
  assert.equal(path.basename(url.path), "grok-artifact-1.jpg");
});

test("40. (review fix) prototype property names are unknown commands", async () => {
  for (const command of ["constructor", "toString"]) {
    const run = harness();
    assert.equal(await main([command, "--id", "x"], run.deps), 9, command);
    assert.equal(last(run).message, `unknown command: ${command}`);
  }
});

test("41. (review fix) downloadArtifact cancels a redirect body before following it", async (t) => {
  const dir = downloadDir(t);
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  const responses = [new Response(body, { status: 302, headers: { location: "https://imgen.x.ai/b.jpg" } }), new Response(JPEG)];
  const media = createMedia({ fetchImpl: async () => responses.shift() });
  const saved = await media.downloadArtifact("https://imgen.x.ai/a.jpg", dir);
  assert.deepEqual(fs.readFileSync(saved.path), JPEG);
  assert.ok(cancelled);
});
