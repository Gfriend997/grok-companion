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

export function createJobStore({ dir = path.join(os.homedir(), ".grok-companion", "jobs"), clock = () => new Date().toISOString(), idFactory = () => crypto.randomUUID() } = {}) {
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
  const update = (id, patch) => {
    const prior = read(id);
    if (!prior) throw new Error("job not found");
    return write({ ...prior, ...patch });
  };

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
    if (job.state === "submission_unknown" || ["done", "failed", "abandoned"].includes(job.state)) return job;
    try {
      const provider = await pollFn(job.providerJobId, job);
      const state = mapState(provider?.state);
      return update(id, {
        state,
        result: state === "done" ? { artifactPath: null, url: provider?.url ?? null, usageTicks: provider?.usageTicks ?? null } : job.result,
        error: state === "failed" ? scrubDeep(provider?.error ?? "provider job failed") : null
      });
    } catch (error) {
      return update(id, { state: "unknown", error: "polling failed" });
    }
  }

  function listJobs() {
    return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function cancelJob(id, cancelFn) {
    const job = read(id);
    if (!job) throw new Error("job not found");
    if (cancelFn && job.providerJobId) {
      try {
        const confirmed = await cancelFn(job.providerJobId, job);
        if (confirmed) return update(id, { state: "abandoned", cancellation: "confirmed" });
      } catch { /* Local abandonment is the only safe fallback. */ }
    }
    return update(id, { state: "abandoned", cancellation: "local-abandon" });
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
  return { dir, createJob, recordSubmission, refresh, listJobs, getJob: read, cancelJob, gc };
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
export const cancelJob = (...args) => productionStore().cancelJob(...args);
export const gc = (...args) => productionStore().gc(...args);
