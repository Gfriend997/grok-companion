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

// Takes over a stale lock by moving it aside first: of two takers only one rename succeeds, and a lock
// that a winner replaced in the meantime is handed back, never deleted. Returns "removed", "gone" or "kept".
function takeOverStale(lock) {
  const moved = `${lock}.${crypto.randomUUID()}.stale`;
  try { fs.renameSync(lock, moved); } catch (cause) { if (cause.code === "ENOENT") return "gone"; throw cause; }
  let stillStale = false;
  try { stillStale = staleLock(moved); } catch { /* unreadable: hand it back */ }
  if (!stillStale) { try { fs.linkSync(moved, lock); } catch { /* a newer lock exists */ } }
  try { fs.unlinkSync(moved); } catch { /* already gone */ }
  return stillStale ? "removed" : "kept";
}

// One try at the lock: its descriptor, holding this pid, or undefined when another writer has it.
function openLock(lock) {
  let descriptor;
  try { descriptor = fs.openSync(lock, "wx", 0o600); }
  catch (error) { if (["EEXIST", "EPERM", "EACCES"].includes(error.code)) return undefined; throw error; }
  try { fs.writeSync(descriptor, String(process.pid)); } catch (error) {
    fs.closeSync(descriptor);
    try { fs.unlinkSync(lock); } catch { /* already gone */ }
    throw error;
  }
  return descriptor;
}

function releaseLock(lock, descriptor) {
  fs.closeSync(descriptor);
  // Only our own lock is released; a lock taken over after it went stale belongs to someone else.
  try { if (fs.readFileSync(lock, "utf8") === String(process.pid)) fs.unlinkSync(lock); } catch { /* already gone */ }
}

const HOUR_MS = 60 * 60 * 1000;
const RECORD_KEEP_MS = 7 * 24 * HOUR_MS;
// Pruned states (review fix): submission_unknown is kept, because its request may have been billed.
const PRUNABLE = ["done", "failed", "abandoned"];
// The exact names the store writes for a job id (createJob uses crypto.randomUUID); nothing else is pruned.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SIDE_FILE = new RegExp(`^(${UUID})\\.(claim|answer\\.json|json\\.lock|json\\.lock\\.${UUID}\\.stale|json\\.${UUID}\\.tmp)$`);
const RECORD_FILE = new RegExp(`^(${UUID})\\.json$`);

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
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporary, target);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* ignore */ }
      throw error;
    }
    return next;
  };
  // Every write holds <id>.json.lock (created wx, holding the pid). With expectedState or unlessTerminal,
  // a mismatch returns the stored job unchanged.
  function update(id, patch, { expectedState, unlessTerminal = false } = {}) {
    const lock = `${fileFor(id)}.lock`;
    let descriptor;
    for (let attempt = 0; descriptor === undefined && attempt < 100; attempt++) {
      descriptor = openLock(lock);
      if (descriptor !== undefined) break;
      let stale;
      try { stale = staleLock(lock); }
      catch (cause) {
        if (cause.code === "ENOENT") continue;
        if (!["EPERM", "EACCES"].includes(cause.code)) throw cause;
      }
      if (stale && takeOverStale(lock) !== "kept") continue;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    if (descriptor === undefined) throw new Error("job is busy; retry the local operation");
    try {
      const prior = read(id);
      if (!prior) throw new Error("job not found");
      if (expectedState && prior.state !== expectedState) return prior;
      if (unlessTerminal && TERMINAL.includes(prior.state)) return prior;
      return write({ ...prior, ...patch });
    } finally {
      releaseLock(lock, descriptor);
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
    // A file deleted between the listing and the read (a concurrent sweep) is skipped.
    const readListed = (name) => { try { return [JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))]; } catch (error) { if (error.code === "ENOENT") return []; throw error; } };
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json") && !name.endsWith(".answer.json")).flatMap(readListed).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

  // Spec 007 R8 (D4, D10): deletes finished job records older than 7 days, and side files older than 1 hour
  // that no live job needs. A created, running, submitted, unknown or submission_unknown job keeps its record, claim and answer.
  // Never throws: a file that cannot be read or deleted is skipped.
  function sweep() {
    const counts = { jobs: 0, claims: 0, answers: 0, locks: 0, temp: 0 };
    const now = Date.now();
    // Age of a regular file; a folder, link or junction throws, so it is skipped.
    const age = (file) => { const stat = fs.lstatSync(file); if (!stat.isFile()) throw new Error("not a regular file"); return now - stat.mtimeMs; };
    const remove = (file, kind) => { fs.unlinkSync(file); counts[kind] += 1; };
    const removeIfPresent = (file, kind) => { try { remove(file, kind); } catch (error) { if (error.code !== "ENOENT") throw error; } };
    // Only ENOENT means missing; any other read error throws, so the file is skipped.
    const stored = (id) => { try { return JSON.parse(fs.readFileSync(fileFor(id), "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
    // A record the store wrote itself: its id matches the file name and it has the fields createJob always writes.
    const ownRecord = (job, id) => job?.id === id && typeof job.kind === "string" && typeof job.createdAt === "string" && STATES.has(job.state);
    const finishedOrMissing = (id) => { const job = stored(id); return job === null || (ownRecord(job, id) && PRUNABLE.includes(job.state)); };
    // One try at the job lock; a busy lock skips the job.
    const underLock = (id, fn) => {
      const lock = `${fileFor(id)}.lock`;
      const descriptor = openLock(lock);
      if (descriptor === undefined) return;
      try { fn(); } finally { releaseLock(lock, descriptor); }
    };
    let names;
    try { names = fs.readdirSync(dir); } catch { return counts; }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const [, id, suffix] = SIDE_FILE.exec(name) ?? [];
        if (!id || age(file) <= HOUR_MS) continue;
        if (suffix === "claim" || suffix === "answer.json") underLock(id, () => { if (finishedOrMissing(id)) remove(file, suffix === "claim" ? "claims" : "answers"); });
        else if (suffix === "json.lock") { if (staleLock(file) && takeOverStale(file) === "removed") counts.locks += 1; }
        else remove(file, suffix.endsWith(".stale") ? "locks" : "temp");
      } catch { /* skipped */ }
    }
    for (const name of names) {
      try {
        const id = RECORD_FILE.exec(name)?.[1];
        if (!id) continue;
        const target = fileFor(id);
        const expired = () => { const job = stored(id); return ownRecord(job, id) && PRUNABLE.includes(job.state) && age(target) > RECORD_KEEP_MS; };
        if (!expired()) continue;
        // Under the lock the state and the age are read again.
        underLock(id, () => {
          if (!expired()) return;
          removeIfPresent(claimFile(id), "claims");
          removeIfPresent(answerFile(id), "answers");
          remove(target, "jobs");
        });
      } catch { /* skipped */ }
    }
    return counts;
  }
  return { dir, createJob, recordSubmission, refresh, listJobs, getJob: read, updateJob: update, claimJob, isClaimed, cancelJob, saveAnswer, readAnswer, sweep };
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
export const sweep = (...args) => productionStore().sweep(...args);
