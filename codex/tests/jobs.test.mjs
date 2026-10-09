import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJobStore, pollWithBackoff } from "../scripts/lib/jobs.mjs";
import { spawn } from "node:child_process";

function store() {
  return createJobStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "grok-jobs-")) });
}

test("submission is atomically persisted and secret-safe", () => {
  const jobs = store();
  const id = jobs.createJob({ kind: "video", request: { prompt: "x" + "ai-" + "a".repeat(32) } });
  jobs.recordSubmission(id, "provider-1");
  const saved = jobs.getJob(id);
  assert.equal(saved.state, "submitted");
  assert.equal(saved.providerJobId, "provider-1");
  assert.equal(fs.readdirSync(jobs.dir).some((name) => name.includes(".tmp")), false);
  assert.equal(JSON.stringify(saved).includes("x" + "ai-"), false);
});

test("submission unknown is retained and never polled", async () => {
  const jobs = store();
  const id = jobs.createJob({ kind: "video", request: {} });
  jobs.recordSubmission(id, "submission_unknown");
  let called = false;
  const job = await jobs.refresh(id, async () => { called = true; return { state: "done" }; });
  assert.equal(job.state, "submission_unknown");
  assert.equal(called, false);
});

test("refresh maps provider states and remains readable after restart", async () => {
  const jobs = store();
  const id = jobs.createJob({ kind: "video", request: {} });
  jobs.recordSubmission(id, "provider-2");
  await jobs.refresh(id, async () => ({ state: "done", url: "https://vidgen.x.ai/file.mp4", usageTicks: 10 }));
  const resumed = createJobStore({ dir: jobs.dir });
  assert.deepEqual(resumed.getJob(id).result, { artifactPath: null, url: "https://vidgen.x.ai/file.mp4", usageTicks: 10 });
  assert.equal(resumed.getJob(id).state, "done");
});

test("concurrent atomic updates preserve valid JSON", async () => {
  const jobs = store();
  const id = jobs.createJob({ kind: "video", request: {} });
  jobs.recordSubmission(id, "provider-3");
  await Promise.all(Array.from({ length: 10 }, (_, index) => jobs.refresh(id, async () => ({ state: "running", progress: index }))));
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(jobs.dir, `${id}.json`), "utf8")));
});

test("cancel is local-abandon without server support and after remote failure", async () => {
  const jobs = store();
  const id = jobs.createJob({ kind: "video", request: {} });
  assert.equal((await jobs.cancelJob(id)).cancellation, "local-abandon");
  const second = jobs.createJob({ kind: "video", request: {} });
  assert.equal((await jobs.cancelJob(second, async () => { throw new Error("not supported"); })).cancellation, "local-abandon");
});

test("gc removes expired job records", () => {
  const jobs = store();
  const id = jobs.createJob({ kind: "video", request: {} });
  const file = path.join(jobs.dir, `${id}.json`);
  fs.utimesSync(file, new Date("2020-01-01"), new Date("2020-01-01"));
  assert.equal(jobs.gc(7), 1);
  assert.equal(jobs.getJob(id), null);
});

test("polling honors Retry-After and marks a job unknown at its deadline", async () => {
  const waits = [];
  const result = await pollWithBackoff(async () => ({ state: "running", retryAfterMs: 7 }), { now: (() => { let n = 0; return () => n++ * 10; })(), sleep: async (ms) => waits.push(ms), deadlineMs: 15 });
  assert.equal(result.state, "unknown");
  assert.deepEqual(waits, [7]);
});

test("late video polling never overwrites abandonment", async () => {
  for (const reject of [false, true]) {
    const jobs = store();
    const id = jobs.createJob({ kind: "video", request: {} });
    jobs.recordSubmission(id, "provider");
    let finish;
    const polling = jobs.refresh(id, () => new Promise((resolve, fail) => { finish = reject ? fail : resolve; }));
    await jobs.cancelJob(id);
    finish(reject ? new Error("poll failed") : { state: "done", url: "https://vidgen.x.ai/a.mp4" });
    await polling;
    assert.equal(jobs.getJob(id).state, "abandoned");
  }
});

test("concurrent processes update one job without lock handoff failures", { timeout: 10000 }, async () => {
  const jobs = store();
  const id = jobs.createJob({ kind: "video", request: {} });
  const moduleURL = new URL("../scripts/lib/jobs.mjs", import.meta.url).href;
  const source = `import { createJobStore } from ${JSON.stringify(moduleURL)}; const jobs=createJobStore({dir:${JSON.stringify(jobs.dir)}}); for(let i=0;i<40;i++) jobs.updateJob(${JSON.stringify(id)},{progress:i});`;
  await Promise.all(Array.from({ length: 3 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", value => { stderr += value; });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(stderr)));
  })));
  assert.equal(jobs.getJob(id).progress, 39);
});
