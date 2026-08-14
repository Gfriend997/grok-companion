import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJobStore, pollWithBackoff } from "../scripts/lib/jobs.mjs";

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
