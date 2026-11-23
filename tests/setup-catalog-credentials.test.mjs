// Spec 007: setup and catalog details, credential paths, job-folder pruning (tests 1 to 14).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { main, writeConfig } from "../scripts/grok-companion.mjs";
import * as attachModule from "../scripts/lib/attach.mjs";
import * as scrubModule from "../scripts/lib/scrub.mjs";
import { createJobStore } from "../scripts/lib/jobs.mjs";
import { createMedia } from "../scripts/lib/media.mjs";
import { loadCatalog, KINDS } from "../scripts/lib/models.mjs";
import { riskyDiff } from "../scripts/lib/risk.mjs";
import { harness, newHome } from "./support/harness.mjs";

const last = (run) => JSON.parse(run.lines.at(-1));
const dirs = [];
test.after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
function tempDir(prefix) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(dir); return dir; }
const catalogFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/catalog-2026-11-21.json", import.meta.url), "utf8"));
const kindOf = Object.fromEntries(Object.entries(KINDS).map(([kind, p]) => [p, kind]));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const IMAGE_PART = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };
const ALL_KINDS = ["language", "image", "video"];
const ALL_LIVE = { language: { source: "live" }, image: { source: "live" }, video: { source: "live" } };
const REJECTED = "xAI rejected the API key (catalog request returned 400, 401 or 403)";
const cacheFile = (home) => path.join(home, ".grok-companion", "models.json");
const DAY = 24 * 60 * 60 * 1000;

async function warmHome() {
  const home = newHome();
  assert.equal(await main(["ask", "warm"], harness({}, { catalog: "fixture", home }).deps), 0);
  return home;
}
// Moves the listed cached kinds back two days: expired (over 24 hours) but still usable as stale (under 7 days).
function ageCache(home, kinds = ALL_KINDS) {
  const data = JSON.parse(fs.readFileSync(cacheFile(home), "utf8"));
  for (const kind of kinds) data.kinds[kind].fetchedAt -= 2 * DAY;
  fs.writeFileSync(cacheFile(home), JSON.stringify(data));
}
// Counts the reads of each path while fn runs.
function countReads(fn) {
  const original = fs.readFileSync;
  const reads = [];
  fs.readFileSync = (target, ...rest) => { reads.push(String(target)); return original(target, ...rest); };
  try { return { result: fn(), reads }; } finally { fs.readFileSync = original; }
}

test("1. setup with every kind live reports { source: 'live' } per kind and no message", async () => {
  const run = harness({}, { catalog: "fixture" });
  assert.equal(await main(["setup"], run.deps), 0);
  const out = last(run);
  assert.deepEqual(out.catalogSources, ALL_LIVE);
  assert.deepEqual(Object.keys(out), ["keyPresent", "apiReachable", "catalogSources", "models", "routes", "stopReviewGate", "gateRepos", "imageDefaultOverride"]);
});

test("2. setup with one kind failing with network: exit 0, cache-stale when warm, fallback when cold", async () => {
  const stale = harness({}, { home: await warmHome(), catalog: { fail: ["language"] } });
  assert.equal(await main(["setup"], stale.deps), 0);
  assert.equal(last(stale).apiReachable, false);
  assert.deepEqual(last(stale).catalogSources, { language: { source: "cache-stale", error_class: "network" }, image: { source: "live" }, video: { source: "live" } });
  const cold = harness({}, { catalog: { fail: ["video"] } });
  assert.equal(await main(["setup"], cold.deps), 0);
  assert.deepEqual(last(cold).catalogSources.video, { source: "fallback", error_class: "network" });
  assert.equal(last(cold).routes.video.routeSource, "fallback");
});

test("3. setup exits 2 with the full report and a last message field only when every kind is auth", async () => {
  for (const [home, source] of [[await warmHome(), "cache-stale"], [newHome(), "fallback"]]) {
    const run = harness({}, { home, catalog: { fail: ALL_KINDS, error_class: "auth" } });
    assert.equal(await main(["setup"], run.deps), 2, source);
    const out = last(run);
    assert.equal(out.keyPresent, true);
    assert.ok(out.routes.fast, source);
    for (const kind of ALL_KINDS) assert.deepEqual(out.catalogSources[kind], { source, error_class: "auth" }, `${source} ${kind}`);
    assert.equal(Object.keys(out).at(-1), "message");
    assert.equal(out.message, REJECTED);
  }
  const incorrect = harness({}, { catalog: "fixture" });
  incorrect.deps.api.requestAuthenticated = async (p) => { incorrect.catalogCalls.push(p); throw Object.assign(new Error("Incorrect API key provided."), { error_class: "usage" }); };
  assert.equal(await main(["setup"], incorrect.deps), 2);
  assert.equal(last(incorrect).message, REJECTED);
  const one = harness({}, { catalog: { fail: ["video"], error_class: "auth" } });
  assert.equal(await main(["setup"], one.deps), 0);
  assert.deepEqual(last(one).catalogSources.video, { source: "fallback", error_class: "auth" });
  assert.equal("message" in last(one), false);
  const keyless = harness({}, { catalog: "fixture", env: { XAI_API_KEY: "" } });
  assert.equal(await main(["setup"], keyless.deps), 2);
  assert.equal("message" in last(keyless), false);
  assert.equal(keyless.catalogCalls.length, 0);
});

test("4. an unknown --model refetches only its kind from a warm cache; a live load never refetches", async () => {
  const warm = harness({}, { catalog: "fixture", home: await warmHome() });
  assert.equal(await main(["ask", "q", "--model", "grok-nope"], warm.deps), 8);
  assert.deepEqual(warm.catalogCalls, ["/language-models"]);
  assert.equal(warm.calls.length, 0);
  const offline = harness({}, { catalog: "fail", home: await warmHome() });
  assert.equal(await main(["ask", "q", "--model", "grok-nope"], offline.deps), 0);
  assert.equal(offline.catalogCalls.length, 1);
  assert.equal(offline.calls[0].model, "grok-nope");
  assert.equal(last(offline).modelVerified, false);
  const live = harness({}, { catalog: "fixture" });
  assert.equal(await main(["ask", "q", "--model", "grok-nope"], live.deps), 8);
  assert.equal(live.catalogCalls.length, 3);
});

test("5. at most one refetch per run, of one kind, and only from the fresh cache", async () => {
  const pins = { GROK_COMPANION_MODEL_FAST: "grok-nope-1", GROK_COMPANION_MODEL_STRONG: "grok-nope-2", GROK_COMPANION_MODEL_CODING: "grok-nope-3" };
  const warm = harness({}, { catalog: "fixture", home: await warmHome(), env: pins });
  assert.equal(await main(["rescue", "--coding", "scope"], warm.deps), 8);
  assert.deepEqual(warm.catalogCalls, ["/language-models"]);
  const aged = await warmHome();
  ageCache(aged);
  const partial = harness({}, { home: aged, catalog: { fail: ["language"] } });
  assert.equal(await main(["ask", "q", "--model", "grok-nope"], partial.deps), 0);
  assert.equal(partial.catalogCalls.length, 3);
  assert.equal(last(partial).modelVerified, false);
  const agedSetup = await warmHome();
  ageCache(agedSetup);
  const setup = harness({}, { home: agedSetup, env: pins, catalog: { fail: ["language"] } });
  assert.equal(await main(["setup"], setup.deps), 0);
  assert.equal(setup.catalogCalls.length, 3);
  const mixed = await warmHome();
  ageCache(mixed, ["image"]);
  const run = harness({}, { catalog: "fixture", home: mixed });
  assert.equal(await main(["ask", "q", "--model", "grok-nope"], run.deps), 8);
  assert.deepEqual(run.catalogCalls, ["/image-generation-models", "/language-models"]);
  const raw = JSON.parse(JSON.stringify(catalogFixture));
  raw.language.models.push({ ...raw.language.models.find((model) => model.id === "grok-4.7"), id: "grok-4.9", aliases: [] });
  const listed = harness({}, { catalog: "fixture", home: await warmHome() });
  listed.deps.api.requestAuthenticated = async (p) => { listed.catalogCalls.push(p); return raw[kindOf[p]]; };
  assert.equal(await main(["ask", "q", "--model", "grok-4.9"], listed.deps), 0);
  assert.equal(listed.catalogCalls.length, 1);
  assert.equal(listed.calls[0].model, "grok-4.9");
  assert.equal(last(listed).modelVerified, true);
});

test("6. an env pin is trimmed, and a pin of spaces only is no pin", async () => {
  const pinned = harness({}, { catalog: "fixture", env: { GROK_COMPANION_MODEL_STRONG: " grok-4.6 " } });
  assert.equal(await main(["adversarial-review", "scope"], pinned.deps), 0);
  assert.equal(pinned.calls[0].model, "grok-4.6");
  assert.equal(last(pinned).routeSource, "env");
  const blank = harness({}, { catalog: "fixture", env: { GROK_COMPANION_MODEL_STRONG: "   " } });
  assert.equal(await main(["adversarial-review", "scope"], blank.deps), 0);
  assert.equal(blank.calls[0].model, "grok-4.7");
  assert.equal(last(blank).routeSource, "live");
});

const REFUSED = [".env", ".env.local", ".env.production", "x.env", "x.env.png", ".envrc", "server.key", "cert.pfx", "cert.p12", "a.ppk", "a.jks", "a.keystore",
  "id_ed25519", "id_ed25519.pub", "id_ecdsa", "id_dsa", ".npmrc", ".netrc", "_netrc", ".pypirc", "C:\\Users\\a\\.npmrc", "/home/a/.ssh/id_ed25519", "id_rsa", "key.pem", "a/credentials/x.png"];
const ALLOWED = ["a.environment.png", "my.envelope.txt", ".env-prod", ".env_local", ".env2", "keyboard.png", "monkey.jpg", "a.keys", "notes.npmrc.md", "key.txt", "src/index.js"];

test("7. preflight refuses the credential names of D1 and D2 and allows the rest", () => {
  for (const name of [...REFUSED, ...REFUSED.map((item) => item.toUpperCase())]) assert.equal(scrubModule.preflight("", { sourcePath: name }).ok, false, name);
  for (const name of ALLOWED) assert.equal(scrubModule.preflight("", { sourcePath: name }).ok, true, name);
});

test("8. every caller of the path check refuses the new names", async (t) => {
  const dir = tempDir("grok-spec7-");
  const file = (name, bytes = PNG) => { const target = path.join(dir, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); return target; };
  const refusal = (error) => error.message === "attachment rejected: credential file paths are not allowed";
  for (const name of ["cert.p12", "photo.key"]) {
    const target = file(name);
    const { reads } = countReads(() => assert.throws(() => attachModule.toParts([target]), refusal, name));
    assert.deepEqual(reads, [], name);
  }
  assert.equal(attachModule.toParts([file("a.environment.png")]).parts[0].type, "image_url");
  const image = file("id_ed25519.png");
  for (const argv of [["video", "scene", "--seconds", "1", "--confirm-cost", "--from-image", image], ["imagine", "apple", "--source", image]]) {
    const run = harness({ attach: attachModule }, { catalog: "fixture" });
    assert.equal(await main(argv, run.deps), 9, argv[0]);
    assert.equal(run.calls.length + run.jobsCreated.length, 0, argv[0]);
  }
  let uploads = 0;
  const media = createMedia({ apiClient: { requestAuthenticated: async () => { uploads += 1; return { text: "x" }; } } });
  for (const target of [file("id_ed25519/voice.mp3", "x"), file(".netrc", "x")]) {
    await assert.rejects(media.transcribeAudio({ file: target }), (error) => error.message === "credential file paths are not allowed", target);
  }
  await assert.rejects(media.transcribeAudio({ file: file("voice.key.mp3", "not audio") }), (error) => !/credential/.test(error.message));
  assert.equal(uploads, 0);
  const speak = harness({ scrub: scrubModule });
  assert.equal(await main(["speak", "--text-file", file(".npmrc", "hello")], speak.deps), 9);
  assert.equal(speak.calls.length, 0);
  if (process.platform !== "win32") { t.skip("trailing-dot names are Windows only"); return; }
  file("cert.pem");
  const dotted = path.join(dir, "cert.pem.");
  let real;
  try { real = fs.realpathSync.native(dotted); } catch { real = ""; }
  if (!real.endsWith("cert.pem")) { t.skip("the OS does not resolve the trailing dot here"); return; }
  assert.throws(() => attachModule.toParts([dotted]), refusal);
});

const diffFor = (file) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;\n`;

test("9. the risk rule uses the shared credential file names", () => {
  for (const file of ["config/x.env", "certs/a.p12", "a.ppk", ".npmrc", ".netrc", ".pypirc", "keys/id_ed25519", "config/.env.local", "a.pem", "a.key", "a.pfx", "src/apiKey.js"]) {
    assert.deepEqual(riskyDiff(diffFor(file)), { risky: true, reasons: ["secrets"] }, file);
  }
  for (const file of ["src/environment.js", "docs/a.environment.md", "config/.env-prod"]) assert.deepEqual(riskyDiff(diffFor(file)), { risky: false, reasons: [] }, file);
  const samples = [".env", "a.envrc", "id_dsa", "a.pem", "a.keystore", "_netrc", ".pypirc"];
  for (const pattern of scrubModule.CREDENTIAL_FILE_NAMES) {
    const hits = samples.filter((name) => pattern.test(name));
    assert.ok(hits.length > 0, String(pattern));
    for (const name of hits) assert.equal(scrubModule.preflight("", { sourcePath: name }).ok, false, name);
  }
});

const ZERO = { jobs: 0, claims: 0, answers: 0, locks: 0, temp: 0 };
const ago = (ms) => new Date(Date.now() - ms);
const age = (file, ms) => fs.utimesSync(file, ago(ms), ago(ms));
const endedPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

// A job in `state` with its job file aged `jobAge`, and a claim and an answer file aged `sideAge` (none when null).
function seed(jobs, state, { kind = "video", jobAge = 0, sideAge = null } = {}) {
  const id = jobs.createJob({ kind, request: {} });
  if (state !== "created") jobs.updateJob(id, { state });
  if (sideAge !== null) {
    jobs.claimJob(id);
    jobs.saveAnswer(id, { state: "done", result: { output: "paid answer" } });
    age(path.join(jobs.dir, `${id}.claim`), sideAge);
    age(path.join(jobs.dir, `${id}.answer.json`), sideAge);
  }
  age(path.join(jobs.dir, `${id}.json`), jobAge);
  return id;
}

test("10. sweep deletes old side files of finished or missing jobs, stale locks and temp files, and counts them", () => {
  const jobs = createJobStore({ dir: tempDir("grok-jobs-") });
  const finished = ["done", "failed", "abandoned"].map((state) => seed(jobs, state, { sideAge: 2 * 60 * 60 * 1000 }));
  const orphan = seed(jobs, "done", { sideAge: 2 * 60 * 60 * 1000 });
  fs.unlinkSync(path.join(jobs.dir, `${orphan}.json`));
  // (review fix) submission_unknown is never pruned: the request may have been billed.
  const unknown = seed(jobs, "submission_unknown", { sideAge: 2 * 60 * 60 * 1000 });
  const side = (name, content = "", ms = 2 * 60 * 60 * 1000) => { const file = path.join(jobs.dir, name); fs.writeFileSync(file, content); age(file, ms); return file; };
  // The old locks sit on jobs with no side files: a claim or answer beside a lock waits for the lock (review fix).
  const lockOwners = [seed(jobs, "done"), seed(jobs, "done")];
  const lock = side(`${lockOwners[0]}.json.lock`, String(endedPid()));
  // (review fix) An old lock with a live pid is stale after 30 seconds (staleLock), so it goes too.
  const liveOld = side(`${lockOwners[1]}.json.lock`, String(process.pid));
  const moved = side(`${finished[1]}.json.lock.0b0b0b0b-0000-4000-8000-000000000000.stale`, "1");
  const temporary = side(`${finished[2]}.json.0c0c0c0c-0000-4000-8000-000000000000.tmp`, "{}");
  const young = ["created", "running", "submitted", "unknown", "done"].map((state) => seed(jobs, state, { sideAge: 0 }));
  // (review fix) Younger than 1 hour, a lock stays whatever its pid (spec R8 side-file rule); so do a fresh .stale and .tmp beside a running job.
  const youngFiles = [side(`${young[4]}.json.lock`, String(endedPid()), 0), side(`${young[0]}.json.lock`, String(process.pid), 0), side(`${young[4]}.json.lock.0d0d0d0d-0000-4000-8000-000000000000.stale`, "1", 0), side(`${young[4]}.json.0e0e0e0e-0000-4000-8000-000000000000.tmp`, "{}", 0),
    side(`${young[1]}.json.lock.0f0f0f0f-0000-4000-8000-000000000000.stale`, "1", 0), side(`${young[1]}.json.0a0a0a0a-0000-4000-8000-000000000000.tmp`, "{}", 0)];
  // (review fix) A junction in the jobs folder is skipped, and its target is never touched.
  const target = tempDir("grok-target-");
  fs.writeFileSync(path.join(target, "keep.txt"), "x");
  const junction = path.join(jobs.dir, `${finished[0]}.json.0b0c0d0e-0000-4000-8000-000000000000.tmp`);
  fs.symlinkSync(target, junction, "junction");
  fs.lutimesSync(junction, ago(2 * 60 * 60 * 1000), ago(2 * 60 * 60 * 1000));
  assert.deepEqual(jobs.sweep(), { jobs: 0, claims: 4, answers: 4, locks: 3, temp: 1 });
  for (const id of [...finished, orphan]) {
    assert.equal(fs.existsSync(path.join(jobs.dir, `${id}.claim`)), false, id);
    assert.equal(fs.existsSync(path.join(jobs.dir, `${id}.answer.json`)), false, id);
  }
  for (const file of [lock, liveOld, moved, temporary]) assert.equal(fs.existsSync(file), false, file);
  assert.ok(fs.lstatSync(junction).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(target, "keep.txt")));
  for (const id of [...young, unknown]) {
    assert.ok(fs.existsSync(path.join(jobs.dir, `${id}.claim`)), id);
    assert.ok(fs.existsSync(path.join(jobs.dir, `${id}.answer.json`)), id);
  }
  for (const file of youngFiles) assert.ok(fs.existsSync(file), file);
  assert.deepEqual(jobs.sweep(), ZERO);
});

test("11. sweep deletes only finished job records older than 7 days, never a live job or a held lock", async () => {
  const dir = tempDir("grok-jobs-");
  const jobs = createJobStore({ dir, clock: () => ago(30 * DAY).toISOString() });
  const states = ["done", "failed", "abandoned"];
  const expired = states.map((state) => seed(jobs, state, { jobAge: 8 * DAY, sideAge: 8 * DAY }));
  const recent = states.map((state) => seed(jobs, state, { jobAge: 6 * DAY }));
  // (review fix) submission_unknown joins the jobs that are never pruned.
  const live = ["created", "running", "submitted", "unknown", "submission_unknown"].map((state) => seed(jobs, state, { jobAge: 30 * DAY, sideAge: 30 * DAY }));
  const unapplied = seed(jobs, "running", { kind: "text", jobAge: 30 * DAY, sideAge: 30 * DAY });
  const claimed = seed(jobs, "created", { kind: "text", jobAge: 30 * DAY });
  jobs.claimJob(claimed);
  age(path.join(dir, `${claimed}.claim`), 30 * DAY);
  const held = seed(jobs, "done", { jobAge: 8 * DAY, sideAge: 0 });
  const heldLock = path.join(dir, `${held}.json.lock`);
  fs.writeFileSync(heldLock, String(process.pid));
  const raced = seed(jobs, "done", { jobAge: 8 * DAY });
  const busy = seed(jobs, "done", { jobAge: 8 * DAY });
  const uuid = "0a1b2c3d-0000-4000-8000-000000000000";
  fs.mkdirSync(path.join(dir, `${uuid}.json`));
  age(path.join(dir, `${uuid}.json`), 8 * DAY);
  fs.mkdirSync(path.join(dir, `${uuid}.json.${uuid}.tmp`));
  age(path.join(dir, `${uuid}.json.${uuid}.tmp`), 2 * 60 * 60 * 1000);
  fs.writeFileSync(path.join(dir, `${uuid.replace("0a", "0b")}.json`), "{not json");
  age(path.join(dir, `${uuid.replace("0a", "0b")}.json`), 8 * DAY);
  // Another writer refreshes `raced` after the list and before the sweep's lock; (review fix) another holds `busy`'s lock at sweep time.
  const original = fs.openSync;
  fs.openSync = (target, ...rest) => {
    if (String(target).endsWith(`${busy}.json.lock`)) throw Object.assign(new Error("held"), { code: "EEXIST" });
    if (String(target).endsWith(`${raced}.json.lock`)) fs.utimesSync(path.join(dir, `${raced}.json`), new Date(), new Date());
    return original(target, ...rest);
  };
  let counts;
  try { counts = jobs.sweep(); } finally { fs.openSync = original; }
  assert.deepEqual(counts, { jobs: 3, claims: 3, answers: 3, locks: 0, temp: 0 });
  assert.ok(jobs.getJob(busy));
  for (const id of expired) {
    assert.equal(jobs.getJob(id), null, id);
    assert.deepEqual(fs.readdirSync(dir).filter((name) => name.startsWith(id)), [], id);
  }
  for (const id of [...recent, raced]) assert.ok(jobs.getJob(id), id);
  for (const id of [...live, unapplied]) {
    assert.ok(jobs.getJob(id), id);
    assert.ok(fs.existsSync(path.join(dir, `${id}.claim`)), id);
    assert.ok(fs.existsSync(path.join(dir, `${id}.answer.json`)), id);
  }
  assert.ok(fs.existsSync(path.join(dir, `${claimed}.claim`)));
  for (const name of [`${held}.json`, `${held}.claim`, `${held}.answer.json`, `${held}.json.lock`]) assert.ok(fs.existsSync(path.join(dir, name)), name);
  fs.unlinkSync(heldLock);
  assert.equal(jobs.updateJob(held, { note: "holder" }).note, "holder");
  const result = harness({ jobs });
  assert.equal(await main(["result", "--id", unapplied], result.deps), 0);
  assert.equal(result.lines.at(-1), "paid answer");
  const status = harness({ jobs });
  assert.equal(await main(["status", "--id", claimed], status.deps), 0);
  assert.equal(last(status).state, "submission_unknown");
  const failing = createJobStore({ dir: tempDir("grok-jobs-"), idFactory: () => "fixed-id" });
  fs.mkdirSync(path.join(failing.dir, "fixed-id.json"));
  assert.throws(() => failing.createJob({ kind: "video", request: {} }));
  assert.deepEqual(fs.readdirSync(failing.dir).filter((name) => name.endsWith(".tmp")), []);
});

test("12. a bare status prunes once and prints the counts first; no other command prunes", async () => {
  const counts = { jobs: 1, claims: 2, answers: 0, locks: 1, temp: 3 };
  const pruned = harness();
  pruned.deps.jobs.sweep = () => counts;
  assert.equal(await main(["status"], pruned.deps), 0);
  assert.deepEqual(pruned.lines.map((line) => JSON.parse(line)), [{ pruned: counts }, []]);
  const quiet = harness();
  assert.equal(await main(["status"], quiet.deps), 0);
  assert.deepEqual(quiet.lines, ["[]"]);
  assert.equal(quiet.sweeps.length, 1);
  const broken = harness();
  broken.deps.jobs.sweep = () => { throw new Error("disk"); };
  assert.equal(await main(["status"], broken.deps), 0);
  assert.deepEqual(broken.lines, ["[]"]);
  for (const argv of [["status", "--id", "local-1"], ["result", "--id", "local-1"], ["cancel", "--id", "local-1"], ["video", "scene", "--seconds", "1", "--confirm-cost"], ["ask", "x", "--background"]]) {
    const run = harness();
    await main(argv, run.deps);
    assert.equal(run.sweeps.length, 0, argv.join(" "));
  }
});

test("13. failed cache and config writes leave no temp file; no request function touches no cache file", async () => {
  const env = { XAI_API_KEY: "test-key-not-for-logs" };
  const request = async (p) => catalogFixture[kindOf[p]];
  const blocked = newHome();
  fs.mkdirSync(cacheFile(blocked), { recursive: true });
  assert.equal((await loadCatalog({ request, env, home: blocked })).kinds.language.source, "live");
  assert.deepEqual(fs.readdirSync(path.dirname(cacheFile(blocked))).filter((name) => name.endsWith(".tmp")), []);
  const broken = newHome();
  fs.mkdirSync(path.dirname(cacheFile(broken)), { recursive: true });
  fs.writeFileSync(cacheFile(broken), "{not json");
  const none = await loadCatalog({ env, home: broken });
  assert.equal(fs.readFileSync(cacheFile(broken), "utf8"), "{not json");
  for (const kind of ALL_KINDS) assert.deepEqual([none.kinds[kind].available, none.kinds[kind].error], [false, "network"], kind);
  const fresh = newHome();
  await loadCatalog({ env, home: fresh });
  assert.deepEqual(fs.readdirSync(fresh), []);
  const window = newHome();
  let time = 1_000_000_000_000;
  await loadCatalog({ request, env, home: window, now: () => time });
  time += 2 * DAY;
  await loadCatalog({ request: async () => { throw Object.assign(new Error("denied"), { error_class: "auth" }); }, env, home: window, now: () => time });
  const inside = await loadCatalog({ request, env, home: window, now: () => time + 60_000 });
  assert.deepEqual([inside.kinds.language.source, inside.kinds.language.error], ["cache-stale", "network"]);
  const config = newHome();
  fs.mkdirSync(path.join(config, ".grok-companion", "config.json"), { recursive: true });
  assert.throws(() => writeConfig(config, { gateRepos: [] }));
  assert.deepEqual(fs.readdirSync(path.join(config, ".grok-companion")).filter((name) => name.endsWith(".tmp")), []);
});


test("14. the video estimate names the image input charge for a local or https image, and only then", async () => {
  for (const image of ["C:/photo.png", "https://example.test/photo.png", null]) {
    const extra = image ? ["--from-image", image] : [];
    // Measured flat $0.01 per image job (spec 007 T10 step 4).
    const estimate = image ? "2 × $0.08 + $0.01 image input = $0.17" : "2 × $0.08 = $0.16";
    const stubs = { attach: { toParts: () => ({ parts: [IMAGE_PART], tokenEstimate: 1, totalBytes: 4 }) } };
    const refused = harness(stubs, { catalog: "fixture" });
    assert.equal(await main(["video", "scene", "--seconds", "2", ...extra], refused.deps), 9, String(image));
    assert.equal(last(refused).message, `video requires --confirm-cost after user approval. Estimate: ${estimate} (starting rate, unverified; the price varies by model and resolution). Nothing was sent.`);
    const confirmed = harness(stubs, { catalog: "fixture" });
    assert.equal(await main(["video", "scene", "--seconds", "2", "--confirm-cost", ...extra], confirmed.deps), 0, String(image));
    assert.equal(confirmed.lines[0], `${estimate} (unverified estimate; actual price depends on model grok-imagine-video-1.5)`);
  }
});

test("15. (review fix) sweep deletes only the store's own names and records, and only under the job lock", () => {
  const jobs = createJobStore({ dir: tempDir("grok-jobs-") });
  const plant = (name, content) => { const file = path.join(jobs.dir, name); fs.writeFileSync(file, content); age(file, 10 * DAY); return file; };
  const foreign = [plant("backup.tmp", "x"), plant("notes.stale", "x"), plant("report.claim", ""), plant("data.answer.json", "{}"), plant("package.json", '{"state":"done"}'), plant("report.json", '{"state":"failed"}'),
    plant("0c1d2e3f-0000-4000-8000-000000000000.json", JSON.stringify({ id: "another-id", kind: "video", state: "done", createdAt: "2026-01-01T00:00:00.000Z" }))];
  const unreadable = seed(jobs, "done", { sideAge: 10 * DAY });
  const held = seed(jobs, "done", { sideAge: 10 * DAY });
  fs.writeFileSync(path.join(jobs.dir, `${held}.json.lock`), String(process.pid));
  // The job file cannot be read (EPERM): existsSync then reports false, which must not count as missing.
  const [originalRead, originalExists] = [fs.readFileSync, fs.existsSync];
  const denied = (target) => String(target).endsWith(`${unreadable}.json`);
  fs.readFileSync = (target, ...rest) => { if (denied(target)) throw Object.assign(new Error("denied"), { code: "EPERM" }); return originalRead(target, ...rest); };
  fs.existsSync = (target) => !denied(target) && originalExists(target);
  let counts;
  try { counts = jobs.sweep(); } finally { [fs.readFileSync, fs.existsSync] = [originalRead, originalExists]; }
  assert.deepEqual(counts, ZERO);
  for (const file of foreign) assert.ok(fs.existsSync(file), file);
  for (const id of [unreadable, held]) for (const name of [`${id}.claim`, `${id}.answer.json`]) assert.ok(fs.existsSync(path.join(jobs.dir, name)), name);
});

test("15b. (review fix) listJobs skips a job file deleted between the listing and the read", () => {
  const jobs = createJobStore({ dir: tempDir("grok-jobs-") });
  const kept = jobs.createJob({ kind: "video", request: {} });
  const gone = jobs.createJob({ kind: "video", request: {} });
  const original = fs.readdirSync;
  fs.readdirSync = (...args) => { const names = original(...args); fs.unlinkSync(path.join(jobs.dir, `${gone}.json`)); return names; };
  let listed;
  try { listed = jobs.listJobs(); } finally { fs.readdirSync = original; }
  assert.deepEqual(listed.map((job) => job.id), [kept]);
});

test("15c. (review fix) riskyDiff reads a header path that git ends with a tab, quoted or not", () => {
  const plain = "diff --git a/my dir/.env b/my dir/.env\n--- a/my dir/.env\t\n+++ b/my dir/.env\t\n@@ -1 +1 @@\n-a\n+b\n";
  const quoted = "diff --git \"a/my dir/.env\" \"b/my dir/.env\"\n--- \"a/my dir/.env\"\t\n+++ \"b/my dir/.env\"\t\n@@ -1 +1 @@\n-a\n+b\n";
  for (const diff of [plain, quoted]) assert.deepEqual(riskyDiff(diff), { risky: true, reasons: ["secrets"] }, diff);
});
