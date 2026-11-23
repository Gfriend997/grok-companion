// Shared CLI harness (moved from tests/cli.test.mjs by spec 006 R14, so `node --test tests/` runs each test once).
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KINDS } from "../../scripts/lib/models.mjs";

const fixturePath = (name) => path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", name);
const fixture = JSON.parse(fs.readFileSync(fixturePath("catalog-2026-11-21.json"), "utf8"));
// GET /models as captured: 12 language, image and video models and no voice model.
export const modelsFixture = JSON.parse(fs.readFileSync(fixturePath("models.json"), "utf8")).response.body;
const pathKind = Object.fromEntries(Object.entries(KINDS).map(([kind, p]) => [p, kind]));
const homes = [];
test.after(() => { for (const dir of homes) fs.rmSync(dir, { recursive: true, force: true }); });
export function newHome() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-cli-")); homes.push(dir); return dir; }

// catalog: undefined = no requestAuthenticated (discovery fails -> fallback routes); "fixture" = live 2026-11-21 catalog; "fail" = catalog requests throw.
// models: the GET /models body served alongside the catalog, or "fail".
// repo: what repoRoot returns; commandLine: what the process query returns for any pid.
export function harness(overrides = {}, { catalog, home = newHome(), env = {}, models = modelsFixture, repo = null, commandLine = "" } = {}) {
  const lines = [];
  const calls = [];
  const catalogCalls = [];
  const jobsCreated = [];
  const workers = [];
  const queries = [];
  const kills = [];
  const submissions = [];
  const jobUpdates = [];
  const api = {
    chat: async (request) => { calls.push(request); return { content: "answer", usage: { total_tokens: 3 } }; },
    respond: async (request) => { calls.push(request); return { content: "fresh", citations: [{ url: "https://example.test", title: "Example" }], usage: { num_sources_used: 1 } }; }
  };
  if (catalog) api.requestAuthenticated = async (p) => {
    catalogCalls.push(p);
    if (catalog === "fail" || (p === "/models" && models === "fail")) throw Object.assign(new Error("down"), { error_class: "network" });
    return p === "/models" ? models : fixture[pathKind[p]];
  };
  const deps = {
    env: { XAI_API_KEY: "hidden-key", ...env },
    home,
    stdout: { write: (line) => lines.push(String(line).trim()) },
    scrub: { preflight: () => ({ ok: true }), scrubDeep: (value) => value },
    attach: { toParts: () => ({ parts: [], tokenEstimate: 1, totalBytes: 0 }) },
    api,
    media: {
      generateImage: async (request) => { calls.push(request); return { b64: "AA==" }; },
      createVideoJob: async (request) => { calls.push(request); return { providerJobId: "p1" }; },
      pollVideo: async () => ({ state: "done", progress: 100, url: "https://vidgen.x.ai/v.mp4", usageTicks: 1 }),
      downloadArtifact: async () => ({ path: "out.jpg", mime: "image/jpeg", bytes: 2 }),
      saveBase64: () => ({ path: "saved.png", mime: "image/png", bytes: 1 }),
      synthesizeSpeech: async (request) => { calls.push(request); return { path: "speech.mp3", mime: "audio/mpeg", bytes: 417 }; },
      transcribeAudio: async (request) => { calls.push(request); return { text: "Hello", untrusted: true }; }
    },
    jobs: {
      createJob: (job) => { jobsCreated.push(job); return "local-1"; }, recordSubmission: (...args) => { submissions.push(args); }, pollWithBackoff: async (poll) => poll(), refresh: async () => ({ state: "done" }), listJobs: () => [], getJob: () => ({ id: "local-1", state: "done" }), cancelJob: async () => ({ id: "local-1", state: "abandoned" }), updateJob: (id, patch, options) => { jobUpdates.push([id, patch, options]); return { id, ...patch }; }
    },
    spawnWorker: (id) => { workers.push(id); return 4242; },
    repoRoot: () => repo,
    processQuery: async (pid) => { queries.push(pid); return commandLine; },
    killProcess: (pid) => { kills.push(pid); },
    sleep: async () => {},
    ...overrides
  };
  return { deps, lines, calls, catalogCalls, jobsCreated, home, workers, queries, kills, submissions, jobUpdates };
}
