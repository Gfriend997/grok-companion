# grok-companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the grok-companion Claude Code plugin: Grok delegation (ask/rescue/review/adversarial-review/transfer), Live Search, image generation, video generation, tested live against api.x.ai.

**Architecture:** REST-only stdlib Node runtime mirroring kimi-companion (the local kimi-companion checkout is the reference implementation — read its counterpart file before writing each module). New vs kimi: `media.mjs` (image/video generation + unauthenticated artifact downloader), provider-job state machine in `jobs.mjs`, `selectModel()` in the entry script, outbound secret preflight in `scrub.mjs`, untrusted-content envelope for `--live`.

**Tech Stack:** Node ≥18 stdlib only (fetch, node:test). No npm dependencies. Markdown commands/skills/agents per Claude Code plugin schema (copy sibling layouts).

**Spec:** `docs/specs/2026-08-13-grok-companion-design.md` — authoritative. Every requirement there binds each task below.

## Global Constraints

- No npm dependencies; `node --test tests/` must pass offline (mocked fetch).
- `XAI_API_KEY` read from environment only; never printed, never in argv, never in job files.
- Authenticated calls: exact host `api.x.ai`, HTTPS only. Artifact downloads: separate code path, NO auth header, probe-derived host allowlist.
- Billable create requests (imagine/video): zero auto-retry after possible acceptance.
- All runtime JSON output parseable; structured error object `{error_class, message, retryable}` with distinct exit codes: 0 ok, 2 auth, 3 quota, 4 rate-limit, 5 moderation, 6 network, 7 submission_unknown, 8 capability-unavailable, 9 usage.
- No `C:\Users\hkgar` paths in any tracked file (portability test enforces).
- Commit after every green task; author email 127359647+Gfriend997@users.noreply.github.com (already set in repo config).

---

### Task 1: Live capability probe (fixtures are ground truth)

**Files:** Create `scripts/probe.mjs` (dev tool, tracked), `tests/fixtures/*.json` (scrubbed), `docs/PROBE_REPORT.md`.

Probe against real key, record per capability: request body sent, response schema (values scrubbed of key/URLs' signatures), terminal states, one failure response (bad model name), artifact download host(s).

- [ ] Probe `GET /v1/models` → full model inventory with context lengths
- [ ] Chat completion: grok-4.3 minimal call (already proven to work in session)
- [ ] Vision input: 1 small jpg via content parts
- [ ] Live Search: discover parameter shape (try `search_parameters: {mode:"auto"}` per xAI docs; record actual accepted shape + usage fields returned)
- [ ] Image generation: `POST /v1/images/generations` model grok-imagine-image-2.0, capture response format (URL vs b64), artifact host
- [ ] Video generation: discover endpoint (try `/v1/videos/generations`; check response for job id vs sync bytes; record polling flow, states, cancel support). Cap: shortest duration offered. Cost ≤ $1.
- [ ] Bad-model-name call → capture error schema
- [ ] Write fixtures + PROBE_REPORT.md; update spec capability table if probe contradicts it
- [ ] Commit

**Produces:** fixtures consumed by all test suites; PROBE_REPORT.md decides jobs.mjs flow and media allowlist host.

### Task 2: scrub.mjs — masking + outbound preflight

**Files:** Create `scripts/lib/scrub.mjs`, `tests/scrub.test.mjs`. Reference: kimi-companion `scripts/lib/scrub.mjs`.

**Produces:** `scrubText(s)` (mask xai-/sk-/gho-/AKIA/PEM patterns, count matches), `preflight(text, {sourcePath})` → `{ok}` or `{ok:false, reason}` (throws nothing); denies credential-file paths (`.env*`, `*id_rsa*`, `*.pem`, `*credentials*`).

- [ ] Failing tests: masks xai- key, counts matches, preflight rejects text containing key-shaped string, preflight rejects `.env` path, allows clean code
- [ ] Implement; tests green; commit

### Task 3: api.mjs — authenticated client

**Files:** Create `scripts/lib/api.mjs`, `tests/api.test.mjs`. Reference: kimi `scripts/lib/api.mjs`.

**Produces:** `chat({model, messages, searchParameters, maxTokens, signal})`, `listModels()`, `classifyError(status, body)` → error_class per Global Constraints, `API_HOST='api.x.ai'`. Injectable `fetch` for tests. AbortController timeout default 300s chat / 30s models. Bounded retry (2, backoff) only network/5xx on chat; never on 4xx.

- [ ] Failing tests: exact host enforced (reject other URLs), Bearer header set, key never in thrown error text, retry on 503 then success, no retry on 400, error classification per fixture, timeout aborts
- [ ] Implement; green; commit

### Task 4: attach.mjs — file → content parts

**Files:** Create `scripts/lib/attach.mjs`, `tests/attach.test.mjs`. Reference: kimi `scripts/lib/attach.mjs`.

**Produces:** `toParts(paths)` → message content array; text inlined (preflight applied per file); jpg/png detected by magic bytes (not extension), ≤20MiB, base64 data URL; `stripExif(buf, kind)` removes APP1/APPn segments (jpg) and eXIf/tEXt/zTXt/iTXt chunks (png) before encoding; `estimateTokens(parts)` (chars/4 + 256×tiles heuristic) for the 200K guard.

- [ ] Failing tests: magic-byte detection (jpg, png, mislabeled extension rejected as image), oversize rejected, EXIF segment gone after strip (construct minimal jpg with APP1), token estimate returns number, preflight rejection propagates
- [ ] Implement; green; commit

### Task 5: jobs.mjs — provider-job state machine

**Files:** Create `scripts/lib/jobs.mjs`, `tests/jobs.test.mjs`. Reference: kimi `scripts/lib/jobs.mjs` (local-PID model — interface inspiration only, NOT the design).

**Produces:** `createJob({kind, request})` → local id; `recordSubmission(id, providerJobId|'submission_unknown')` atomic write; `refresh(id, pollFn)`; `listJobs()`, `getJob(id)`, `cancelJob(id, cancelFn)` (reports confirmed/local-abandon), `gc(ttlDays=7)`. State dir: `os.homedir()/.grok-companion/jobs` (outside any repo). Poll helper: expo backoff 2s→60s + jitter, honors Retry-After, hard deadline 30min → state `unknown`.

- [ ] Failing tests: submission persisted atomically (temp+rename), submission_unknown never auto-retried, refresh transitions per fixture states, survives "restart" (re-read from disk), cancel without server support → local-abandon, gc removes expired, key never written to job files
- [ ] Implement; green; commit

### Task 6: media.mjs — generation + artifact download

**Files:** Create `scripts/lib/media.mjs`, `tests/media.test.mjs`.

**Produces:** `generateImage({prompt, sources[], model})` (≤3 sources, dedicated request builder per probe fixture); `generateVideo({prompt, seconds, fromImage, model})` → provider job (shape per probe); `downloadArtifact(url, outDir)` — no auth header, host must match probe allowlist (`MEDIA_HOSTS` const from fixtures), redirects revalidated, byte ceiling 200MiB, MIME sniffed from bytes, collision-free filename, extension from sniffed MIME.

- [ ] Failing tests: request bodies match probe fixtures, >3 sources rejected, download refuses non-allowlisted host, refuses redirect off-list, refuses oversize, no Authorization header on download (assert via mock), filename collision avoided, moderation-refusal response → error_class moderation
- [ ] Implement; green; commit

### Task 7: grok-companion.mjs — dispatch + selectModel + commands

**Files:** Create `scripts/grok-companion.mjs`, `tests/cli.test.mjs`. Reference: kimi `scripts/kimi-companion.mjs`.

**Produces:** CLI `node scripts/grok-companion.mjs <cmd> [flags]`. Commands: setup, ask (`--file`× , `--live`, `--max-sources`, `--background`), review, adversarial-review, rescue, transfer, imagine (`--source`×≤3, `--out`), video (`--seconds` required, `--from-image`, `--wait`), status, result, cancel. `selectModel(jobKind, flags, tokenEstimate)` implements the spec table exactly; `--model` sole override; fallback surfaced in output. Long-context: estimate ≥200K → refuse without `--allow-long-context`. `--live` responses wrapped: `[UNTRUSTED-EXTERNAL-CONTENT]...[/UNTRUSTED-EXTERNAL-CONTENT]` + sources list separate + system-prompt data-not-instructions line; prints API usage fields. Video prints `seconds × $0.08 = $X.XX` before dispatch. setup: key presence, reachability, model list, stop-gate toggle, gemini sibling hook check (grep gemini-companion routing hook for image-default line if repo present). Prompt templates in `prompts/*.md` (mirror kimi's).

- [ ] Failing tests: one request-body assertion per selectModel table row, --model overrides, long-context refusal, --seconds required for video, cost line format, envelope present on --live output, exit codes per error_class, setup never prints key
- [ ] Implement; green; commit

### Task 8: plugin packaging — commands, skills, agents, hooks

**Files:** Create `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `commands/{setup,ask,review,adversarial-review,rescue,transfer,imagine,video,status,result,cancel}.md`, `skills/grok-api-runtime/SKILL.md`, `skills/grok-prompting/SKILL.md` (contains model routing table), `skills/grok-result-handling/SKILL.md` (untrusted-content rules), `agents/grok-rescue.md`, `hooks/hooks.json`, `scripts/print-routing-policy.mjs` (key-aware degraded payload, version line, explicit image-default override statement), `scripts/stop-review-gate-hook.mjs` (disabled default), `prompts/{review,adversarial-review,rescue,routing-policy}.md`.

Copy kimi-companion's counterpart files as templates; adapt names, models, routing text per spec's Routing policy hook section verbatim.

- [ ] All files created; `node -e` JSON-parse plugin.json/marketplace.json/hooks.json
- [ ] print-routing-policy.mjs: test with and without XAI_API_KEY env (degraded payload asserts image→Gemini)
- [ ] Commit

### Task 9: docs — README, NOTICE, LICENSE, portability test

**Files:** Create `README.md`, `NOTICE`, `LICENSE` (Apache-2.0 like siblings), `tests/portability.test.mjs`.

README matches sibling structure exactly (read both gemini-companion and kimi-companion READMEs): what it is, capability table, install (marketplace add Gfriend997/grok-companion), XAI_API_KEY as OS env var with security reasoning (never .env), command reference, routing policy summary, troubleshooting table, Roadmap/TODO (keychain item like siblings), attribution to openai/codex-plugin-cc.

- [ ] Portability test: no `hkgar` in tracked files; run full suite `node --test tests/`
- [ ] Commit

### Task 10: live acceptance + release

- [ ] Live: setup, ask (4.3), ask --live (4.6, verify envelope + usage fields), review on a sample diff, imagine (one image, audit file, delete), video shortest+cheapest (≤$1, audit, delete), status/result/cancel flow on the video job
- [ ] Full offline suite green; record counts
- [ ] Update spec status → implemented; check off plan
- [ ] Push all commits to Gfriend997/grok-companion (stays PRIVATE)

## Gate-1 amendments (Codex plan review, 2026-08-13 — these override the tasks above where they conflict)

**Task 1 is DONE** (probe run live by Claude): fixtures exist in `tests/fixtures/`
(models, chat-minimal, vision-input, live-search, image-generation, video-_videos_generations,
video-poll, artifact-download, error-bad-model) and `docs/PROBE_REPORT.md` summarizes them.
Video flow: async `POST /v1/videos/generations` → `{request_id}`, poll `GET /v1/videos/{id}`
→ `{status, progress, video:{url}, usage:{cost_in_usd_ticks}}` (ticks = USD × 1e10).
Live Search: `POST /v1/responses` with `tools:[{type:"web_search"},{type:"x_search"}]` and
`input` (NOT `messages`); citations = `url_citation` annotations; error schema flat `{code,error}`.
`MEDIA_HOSTS = ["imgen.x.ai", "vidgen.x.ai"]`. No server-side video cancel found: `cancelJob`
is local-abandon only for now.

**Cross-module interface contract (binding):**

```js
// api.mjs
requestAuthenticated(path, {method, body, signal})  // shared by chat/responses/media creates; exact-host api.x.ai
chat({model, messages, maxTokens, signal}) -> {content, usage, raw}
respond({model, input, tools, signal}) -> {content, citations:[{url,title}], usage, raw}  // /v1/responses for --live
listModels() -> [{id, contextLength}]
classifyError(status, bodyJson) -> {error_class, message, retryable}   // parses flat {code,error}

// scrub.mjs
scrubText(text) -> {text, maskedMatches}
scrubDeep(value) -> value          // recursive, for job records + CLI JSON output
preflight(text, {sourcePath}) -> {ok:true} | {ok:false, reason}

// attach.mjs
toParts(paths) -> {parts, tokenEstimate}   // throws {error_class:"usage"} on preflight/size/type failure
stripExif(buf, "jpg"|"png") -> buf

// jobs.mjs  (stateDir injectable: createJobStore({dir}) — tests use temp dir, prod uses homedir)
job record schema: {id, kind, createdAt, state, providerJobId, request:{scrubbed}, idempotencyKey,
                    result:{artifactPath, url, usageTicks}, error}
states: created | submitted | submission_unknown | running | done | failed | unknown | abandoned
createJob, recordSubmission, refresh(id, pollFn), listJobs, getJob, cancelJob, gc

// media.mjs  (fetch + api client injectable)
generateImage({prompt, sources, model}) -> {url|b64, raw}       // via requestAuthenticated
createVideoJob({prompt, seconds, fromImage, model}) -> {providerJobId}
pollVideo(providerJobId) -> {state, progress, url, usageTicks}   // maps status:"done" -> done
downloadArtifact(url, outDir, {out}) -> {path, mime, bytes}      // NO auth header; MEDIA_HOSTS allowlist

// grok-companion.mjs
export main(argv, deps={api, media, jobs, scrub, attach, env, stdout})  // CLI wrapper injects prod deps
selectModel(jobKind, flags, tokenEstimate) -> {model, fallbackApplied}
```

**Folded-in fixes:**
- Prompts `prompts/*.md` move INTO Task 7 (Task 7 is self-contained; Task 8 references them).
- Task 7 tests run `main(argv, deps)` in-process with fixture-backed fakes — offline. Every
  command's happy path + each error_class exit code asserted this way.
- Task 5 additions: injectable state dir (temp in tests), concurrent atomic-update test,
  remote-cancel-failure test, Retry-After test, deadline→unknown test.
- Task 2 additions: scrubDeep test; integration test asserting preflight-rejected content
  never reaches the injected fake client (wired in Task 7's suite).
- Task 6/7 additions: total attachment payload cap (100MiB warn at 80), max video `--seconds`
  cap 30, `--out` never overwrites (suffix -1, -2), media default outDir
  `~/.grok-companion/media`, `status`/`result` emit JSON only.
- Task 9 additions: retention/cleanup section in README (jobs TTL 7d gc, media manual,
  xAI-side retention unknown — noted), offline command listed per task: `node --test tests/`.
- NEW Task 10b (before push): edit gemini-companion routing hook — demote raster-image
  default to fallback with one line referencing grok-companion as primary; separate commit
  in that repo (Gary already approved the swap); verify both hooks' emitted payloads state
  the same precedence.
- Task 8 additions: hook tests for key-present payload (version line + explicit override
  statement) and key-absent degraded payload; stop-gate disabled default asserted.

## Verification (Claude runs, not implementer's word)

`node --test tests/` all green; grep tracked files for `hkgar` and `xai-` (zero hits outside fixtures-scrubbed); each live command exit 0; JSON manifests parse; README renders on GitHub.
