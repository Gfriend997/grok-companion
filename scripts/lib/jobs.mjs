import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scrubDeep } from "./scrub.mjs";

const STATES = new Set(["created", "submitted", "submission_unknown", "running", "done", "failed", "unknown", "abandoned"]);

function safeId(id) {
  if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) throw new Error("invalid job id");
  return id;
}

function mapState(state) {
  if (["done", "failed", "running"].includes(state)) return state;
  if (["queued", "pending", "processing"].includes(state)) return "running";
  return "unknown";
}

export async function pollWithBackoff(pollFn, { now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), deadlineMs = 30 * 60 * 1000, random = Math.random } = {}) {
  const started = now();
  let delay = 2000;
  while (now() - started <= deadlineMs) {
    const result = await pollFn();
    const state = mapState(result?.state);
    if (["done", "failed", "unknown"].includes(state)) return { ...result, state };
    const requested = Number(result?.retryAfterMs);
    const wait = Number.isFinite(requested) && requested >= 0 ? requested : Math.min(60_000, Math.round(delay * (0.75 + random() * 0.5)));
    await sleep(wait);
    delay = Math.min(60_000, delay * 2);
  }
  return { state: "unknown" };
}

const TERMINAL = ["done", "failed", "abandoned", "submission_unknown"];
const LOCK_STALE_MS = 30_000;
// A lock with no pid yet may be a writer between its open and its pid write, so it gets a short grace.
const LOCK_PID_GRACE_MS = 1000;

// Stale: older than 30 s, its pid has ended, or it has held no valid pid past the grace. Throws ENOENT when gone.
function staleLock(file) {
  const age = Date.now() - fs.statSync(file).mtimeMs;
  if (age > LOCK_STALE_MS) return true;
  const text = fs.readFileSync(file, "utf8");
  if (!/^[1-9][0-9]*$/.test(text)) return age > LOCK_PID_GRACE_MS;
  try { process.kill(Number(text), 0); return false; } catch (error) { return error.code === "ESRCH"; }
}

export function createJobStore({ dir = process.env.GROK_JOBS_DIR || path.join(os.homedir(), ".grok-companion", "jobs"), clock = () => new Date().toISOString(), idFactory = () => crypto.randomUUID() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const fileFor = (id) => path.join(dir, `${safeId(id)}.json`);
  const read = (id) => {
    const file = fileFor(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  };
  const write = (job) => {
    const next = scrubDeep({ ...job, updatedAt: clock() });
    const target = fileFor(next.id);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, target);
    return next;
  };
  // Every write holds <id>.json.lock (created wx, holding the pid). With expectedState or unlessTerminal,
  // a mismatch returns the stored job unchanged.
  function update(id, patch, { expectedState, unlessTerminal = false } = {}) {
    const lock = `${fileFor(id)}.lock`;
    let descriptor;
    for (let attempt = 0; descriptor === undefined && attempt < 100; attempt++) {
      try { descriptor = fs.openSync(lock, "wx", 0o600); }
      catch (error) {
        if (!["EEXIST", "EPERM", "EACCES"].includes(error.code)) throw error;
        let stale;
        try { stale = staleLock(lock); }
        catch (cause) {
          if (cause.code === "ENOENT") continue;
          if (!["EPERM", "EACCES"].includes(cause.code)) throw cause;
        }
        // Take over by moving the lock aside first: of two takers only one rename succeeds,
        // and a lock that a winner replaced in the meantime is handed back, never deleted.
        if (stale) {
          const moved = `${lock}.${crypto.randomUUID()}.stale`;
          try { fs.renameSync(lock, moved); } catch (cause) { if (cause.code === "ENOENT") continue; throw cause; }
          let stillStale = false;
          try { stillStale = staleLock(moved); } catch { /* unreadable: hand it back */ }
          if (!stillStale) { try { fs.linkSync(moved, lock); } catch { /* a newer lock exists */ } }
          try { fs.unlinkSync(moved); } catch { /* already gone */ }
          if (stillStale) continue;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      try { fs.writeSync(descriptor, String(process.pid)); } catch (error) {
        fs.closeSync(descriptor);
        try { fs.unlinkSync(lock); } catch { /* already gone */ }
        throw error;
      }
    }
    if (descriptor === undefined) throw new Error("job is busy; retry the local operation");
    try {
      const prior = read(id);
      if (!prior) throw new Error("job not found");
      if (expectedState && prior.state !== expectedState) return prior;
      if (unlessTerminal && TERMINAL.includes(prior.state)) return prior;
      return write({ ...prior, ...patch });
    } finally {
      fs.closeSync(descriptor);
      // Only our own lock is released; a lock taken over after it went stale belongs to someone else.
      try { if (fs.readFileSync(lock, "utf8") === String(process.pid)) fs.unlinkSync(lock); } catch { /* already gone */ }
    }
  }

  // A background answer whose job write stayed busy (spec 006 R11); applied by status and result.
  const answerFile = (id) => path.join(dir, `${safeId(id)}.answer.json`);
  function saveAnswer(id, patch) {
    fs.writeFileSync(answerFile(id), JSON.stringify(scrubDeep(patch)), { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  function readAnswer(id) {
    try { return JSON.parse(fs.readFileSync(answerFile(id), "utf8")); } catch { return null; }
  }

  function createJob({ kind, request }) {
    const id = safeId(String(idFactory()).toLowerCase());
    const createdAt = clock();
    write({ id, kind, createdAt, state: "created", providerJobId: null, request: scrubDeep(request ?? {}), idempotencyKey: crypto.randomUUID(), result: null, error: null });
    return id;
  }

  function recordSubmission(id, providerJobId) {
    if (!providerJobId) throw new Error("provider job id is required");
    return update(id, { providerJobId, state: providerJobId === "submission_unknown" ? "submission_unknown" : "submitted" });
  }

  async function refresh(id, pollFn) {
    const job = read(id);
    if (!job) throw new Error("job not found");
    if (TERMINAL.includes(job.state)) return job;
    try {
      const provider = await pollFn(job.providerJobId, job);
      const state = mapState(provider?.state);
      return update(id, {
        state,
        result: state === "done" ? { artifactPath: null, url: provider?.url ?? null, usageTicks: provider?.usageTicks ?? null } : job.result,
        error: state === "failed" ? scrubDeep(provider?.error ?? "provider job failed") : null
      }, { unlessTerminal: true });
    } catch (error) {
      return update(id, { state: "unknown", error: "polling failed" }, { unlessTerminal: true });
    }
  }

  // One worker per job: the claim file is created with wx, so only the first claim succeeds.
  const claimFile = (id) => path.join(dir, `${safeId(id)}.claim`);
  function claimJob(id) {
    try { fs.writeFileSync(claimFile(id), "", { flag: "wx", mode: 0o600 }); return true; } catch (error) { if (error?.code === "EEXIST") return false; throw error; }
  }
  const isClaimed = (id) => fs.existsSync(claimFile(id));

  function listJobs() {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json") && !name.endsWith(".answer.json")).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function cancelJob(id, cancelFn) {
    const job = read(id);
    if (!job) throw new Error("job not found");
    if (cancelFn && job.providerJobId) {
      try {
        const confirmed = await cancelFn(job.providerJobId, job);
        if (confirmed) return update(id, { state: "abandoned", cancellation: "confirmed" }, { unlessTerminal: true });
      } catch { /* Local abandonment is the only safe fallback. */ }
    }
    return update(id, { state: "abandoned", cancellation: "local-abandon" }, { unlessTerminal: true });
  }

  function gc(ttlDays = 7) {
    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith(".json"))) {
      const target = path.join(dir, name);
      if (fs.statSync(target).mtimeMs < cutoff) { fs.unlinkSync(target); removed += 1; }
    }
    return removed;
  }
  return { dir, createJob, recordSubmission, refresh, listJobs, getJob: read, updateJob: update, claimJob, isClaimed, cancelJob, saveAnswer, readAnswer, gc };
}

let defaultStore;
function productionStore() {
  defaultStore ??= createJobStore();
  return defaultStore;
}
export const createJob = (...args) => productionStore().createJob(...args);
export const recordSubmission = (...args) => productionStore().recordSubmission(...args);
export const refresh = (...args) => productionStore().refresh(...args);
export const listJobs = (...args) => productionStore().listJobs(...args);
export const getJob = (...args) => productionStore().getJob(...args);
export const updateJob = (...args) => productionStore().updateJob(...args);
export const claimJob = (...args) => productionStore().claimJob(...args);
export const isClaimed = (...args) => productionStore().isClaimed(...args);
export const cancelJob = (...args) => productionStore().cancelJob(...args);
export const saveAnswer = (...args) => productionStore().saveAnswer(...args);
export const readAnswer = (...args) => productionStore().readAnswer(...args);
export const gc = (...args) => productionStore().gc(...args);
