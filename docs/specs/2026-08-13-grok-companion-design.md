# grok-companion design spec

Date: 2026-08-13
Status: revised after Codex + Kimi adversarial challenge (2026-08-13); pending Gary's review
Author: Gary Wong + Claude (challenge reviews: Codex GPT-5.4, Kimi k3)

## Problem

gemini-companion and kimi-companion proved the pattern: a second frontier model wired into
Claude Code as slash commands, skills, hooks, and a rescue agent. xAI's Grok brings two
capabilities nobody in the current stack has — real-time Live Search / X Search, and video
generation — plus competitive image generation that will take over the image-default role
from Gemini. This plugin is the third sibling.

## Capability findings (web research 2026-08-13, MUST be verified live before implementation)

| Question | Answer (research, unverified) |
|---|---|
| Endpoint | OpenAI-compatible `POST https://api.x.ai/v1/chat/completions` |
| Text models | `grok-4.6` (500K ctx, $2/$6 per 1M in/out), `grok-4.3` (1M ctx, $1.25/$2.50), `grok-build-0.1` (256K, $1/$2, coding-agent tuned) |
| Long-context billing | ≥200K-token requests billed at ~2x for ALL tokens in the request |
| Image generation | Yes — `POST /v1/images/generations`, `grok-imagine-image-2.0`, $0.04/image; natural-language editing and compositing with up to 3 source images |
| Video generation | Yes — `grok-imagine-video-1.5`, $0.08/sec, 1080p, text-to-video and image-to-video; endpoint shape and async flow UNVERIFIED |
| Image input | Yes — jpg/png, ≤20MiB each, unlimited count, via chat endpoint content parts |
| Video input | Believed no (understanding stays with Kimi) |
| Live Search | Server-side web + X search enabled via request parameter on chat completions; billed per source on top of tokens; parameter shape UNVERIFIED |
| Knowledge cutoff | grok-4.6: Feb 1, 2026 |
| Model aliases | `<name>` = latest stable, `<name>-latest`, `<name>-<date>` pins |

### Probe acceptance contract (implementation task 1)

The probe is not a smoke test; each capability produces a recorded fixture that becomes the
mocked-test ground truth. Per capability, capture: exact request body, exact response
schema, terminal states, one failure response, and — for media — the actual artifact
download host(s). Modules are coded against fixtures, not against this spec's table. An
unverified capability blocks its module; it never silently degrades to another endpoint.
The live video acceptance call is paid: it requires Gary's explicit go-ahead and a stated
spend cap before it runs.

## Decisions made with Gary (2026-08-13)

1. **Scope: all four capabilities in v1.** Core delegation (ask/rescue/review/adversarial-review/transfer), Live Search, image generation, video generation. One release.
2. **Image generation default moves to Grok.** gemini-companion routing hook gets a demotion-to-fallback edit (separate commit in that repo). See Routing policy for the non-atomic-swap mitigation.
3. **Dynamic model selection, not fixed default.** Implemented as `selectModel(jobKind, flags, attachmentEstimate)` in the runtime — executable contract, not prompt guidance. The grok-prompting skill documents the same table for Claude's dispatch decisions; `--model` is the sole override; runtime fallback `grok-4.3` applies only before a request is accepted, and any fallback substitution is surfaced in output.
4. **Metered tier.** Grok joins Gemini/Kimi: used for unique capabilities (live search, video, image gen) and deliberate third opinions, never continuous fan-out.

### Model routing table

| Job | Model | Why |
|---|---|---|
| ask, quick question | grok-4.3 | cheap, fast |
| ask over a few large attached files | grok-4.3 | 1M context; bulk 1M-text sweeps stay with Kimi (rule below) |
| ask --live (search) | grok-4.6 | best reasoning over fresh data |
| review (routine diff) | grok-4.3 | explicit invocation only — routine diff routing stays with Gemini |
| adversarial-review | grok-4.6 | quality matters |
| rescue: debug/diagnosis | grok-4.6 | hardest reasoning |
| rescue: bounded coding task | grok-build-0.1 | coding-agent tuned; if account-gated, fall back grok-4.6 (not 4.3) |
| transfer | grok-4.3 | session context can be huge; long-context guard applies |

Kimi/Grok large-text boundary: whole-corpus sweeps and many-file analysis route to Kimi;
targeted Q&A over a handful of named files may use Grok. `--model` always wins.

## Runtime decision

REST-only, same reasoning as kimi-companion: no official documented headless CLI from xAI
worth trusting; community `grok-cli` npm packages are third-party supply-chain risk. Stdlib
`fetch` against the documented API, key from environment. `rescue` returns a plan plus
unified diffs; Claude Code applies them, keeping a human in the write loop.

## Architecture

One Node entry script, stdlib only, mirroring kimi-companion:

```
scripts/grok-companion.mjs      dispatch + command implementations + selectModel()
scripts/lib/api.mjs             authenticated REST client (api.x.ai only, XAI_API_KEY, timeouts, retry taxonomy)
scripts/lib/attach.mjs          file → message content parts (text, jpg/png ≤20MiB, MIME-signature checked)
scripts/lib/media.mjs           image + video generation request builders; artifact downloader (separate from api.mjs, see Security)
scripts/lib/jobs.mjs            provider-job state machine (see below), state outside any repo
scripts/lib/scrub.mjs           secret masking at write boundaries + outbound preflight scanning
scripts/print-routing-policy.mjs SessionStart hook payload (key-aware, versioned)
scripts/stop-review-gate-hook.mjs optional stop-time review gate, ships DISABLED by default
```

### jobs.mjs: provider-job state machine, provisional interface

Kimi's jobs.mjs tracks only a detached local PID; that is insufficient for video. Grok
jobs persist the remote provider job ID atomically at submission, refresh status from the
API on `status`/`result`, and survive client exit. The interface is fixed
(`id`, `status`, `result`); whether the flow behind it is async-polled, long-request, or
webhook is decided by the probe, and commands/skills never change either way. States
include `submission_unknown` (create request timed out after possible acceptance — never
auto-retried, reconciled manually via `status`). `cancel` calls the provider cancellation
endpoint when one exists and reports whether cancellation is confirmed; without server-side
cancel it marks the job locally abandoned and says so. Polling: exponential backoff with
cap and jitter, honor `Retry-After`, hard deadline after which a job is `unknown`, not
failed. Every network call carries an `AbortController` timeout. Job state dir is
platform-appropriate (not XDG-assumed), jobs have a TTL with cleanup, `status` with no args
lists all known jobs, `status`/`result` emit JSON Claude can parse. Artifacts are
downloaded on completion where possible, before signed URLs expire.

### Retry taxonomy

Chat completions: bounded auto-retry on network error/5xx (idempotent). Image and video
generation: zero auto-retry once a create request may have been accepted (double-billing),
no retry on any 4xx. Where the API supports an idempotency key, send one and persist it
with the job.

### Error contract

The runtime distinguishes, machine-readably (structured JSON error object + exit code):
auth failure, quota/billing exhaustion, rate limit, moderation refusal, network error,
submission_unknown, capability unavailable. Claude's fallback decisions (e.g. offer Gemini
for a refused image) depend on this; free-text stderr is not a contract. Moderation refusal
on `imagine` is surfaced verbatim with an offer to fall back to Gemini — never an automatic
silent re-route.

### Command surface

| Command | Runtime call | Notes |
|---|---|---|
| `setup` | — | Key presence (never value), API reachable, model list, gate toggle, gemini-companion sibling check (warns if image-demotion edit absent) |
| `ask` | `ask` | Q&A; `--file` repeatable (text/jpg/png); `--live` adds Live Search / X Search |
| `review` | `review` | Explicit invocation only; working diff (fallback last commit) + review template |
| `adversarial-review` | `adversarial-review` | Hostile second pass template |
| `rescue` + agent | `rescue` | Plan + unified diffs back; Claude applies |
| `transfer` | `transfer` | Session context handoff; long-context guard applies |
| `imagine` | `imagine` | Image generation/editing; `--source` up to 3 images (dedicated request builder, not attach.mjs); saves file, prints path |
| `video` | `video` | Video generation; requires explicit duration; background job by default, `--wait` for foreground; `--from-image` for image-to-video |
| `status` / `result` / `cancel` | — | Job management; JSON output |

### Cost guards

- Video: explicit `--seconds` required, default max cap enforced, cost line (seconds × unit price) printed before dispatch; confirm-first in routing policy.
- Long context: client-side token estimate per dispatch; crossing the 200K whole-request-multiplier threshold requires `--allow-long-context` (Claude asks Gary first). Attachment payload total capped with warning on approach.
- Live Search: `--max-sources` request cap; output prints API-returned usage fields (source count, tokens) — never invented dollar figures. Cost line says `unavailable` when the response lacks authoritative usage. Pricing constants live in one module with an as-of date.

### Skills

- `grok-api-runtime` — invocation contract for the runtime script
- `grok-prompting` — prompt shaping + the model routing table (mirror of runtime selectModel)
- `grok-result-handling` — presenting output; untrusted-content rules for Live Search results

### Routing policy hook (SessionStart)

Payload is key-aware: if `XAI_API_KEY` is absent, the hook emits a degraded policy — image
generation routes back to Gemini, Grok routes marked unavailable. Payload carries a policy
version and states explicitly: "overrides prior companion policy for raster image
generation." `setup` detects the gemini-companion hook state and warns until the demotion
edit lands there; the swap is completed in one working session (both repos), and until both
land the grok hook's explicit-override line is the tiebreak.

Auto-route, no confirmation:
- Real-time information questions (current events, "what's happening now", X/Twitter content) → `ask --live`
- Raster image generation → `imagine` (**new default**, Gemini demoted to fallback)

Confirm one line first (metered, slower, or high-cost):
- Video generation (cost estimate shown in the confirm line)
- Delegating substantial tasks or debugging (rescue), adversarial review

Never route to Grok:
- Image/video/screenshot UNDERSTANDING and bulk 1M-text sweeps stay with Kimi (Grok vision input is manual `--file` override only, never hook-routed)
- Routine diff second opinion stays with Gemini

## Security

- `XAI_API_KEY` as OS-level environment variable only; never .env files; setup reports presence, never value; key never in argv, logs, or tracked files.
- Two network paths, strictly separated:
  - `api.mjs`: authenticated calls, HTTPS, exact-host validation against `api.x.ai` only.
  - `media.mjs` artifact downloads: NO Authorization header ever; allowlist = probe-recorded artifact host(s); redirects revalidated against the allowlist; byte ceiling; MIME/signature validation of downloaded bytes; safe collision-free filenames with extension from validated MIME, `--out` respected without overwrite.
- Outbound preflight (scrub.mjs): prompt text and text attachments scanned for secret material before any request; credential-file paths (.env, key stores) denied by default; detected secrets block the request. Tests assert rejected content never reaches mocked fetch. (Post-hoc masking at write boundaries remains, with masked-match counts logged so scrubbing that mangles diffs is detectable.)
- Live Search output: runtime deterministically wraps search-derived content in an UNTRUSTED-EXTERNAL-CONTENT envelope with sources/citations preserved separately; `--live` requests carry a system-prompt instruction to treat cited content as data, never instructions; result-handling skill is the third layer and requires source inspection before operational use.
- Generated media and job state live outside any repo, path printed, never auto-committed; retention/cleanup documented, including whether xAI retains remote media and supports deletion (probe answers this).
- `--source` images: EXIF metadata stripped before upload.

## Testing

- Offline suites with mocked fetch: api, attach, media, jobs, scrub, cli — built on probe-recorded fixtures.
- Required mocked cases beyond the kimi baseline: submission_unknown creation ambiguity, polling across process restart, concurrent job-state updates, remote-cancel failure, expired artifact URL, redirect and oversize download rejection, malformed media payload, Live Search citation parsing, preflight secret rejection, one request-body assertion per model-routing-table row.
- Live acceptance during implementation: capability probe, one real call per command path; the video call is paid and gated on Gary's approval with a spend cap; media outputs audited then deleted.
- Portability test keeps hkgar paths out of tracked files (public-release lesson from siblings).

## Risks

1. Video generation endpoint shape and async flow unverified — probe first; jobs.mjs interface is fixed, implementation follows the probe.
2. Live Search billing per source — mitigated by `--max-sources` and API-usage-field reporting; residual drift risk in pricing constants (dated, single module).
3. Image default swap spans two repos — mitigated by versioned explicit-override hook, key-aware degraded payload, setup sibling check; still land both edits in one session.
4. Web-research pricing/model IDs may drift — probe fixtures are authoritative, spec updated after.

## Challenge review disposition (2026-08-13)

Codex and Kimi reviewed the draft independently. Accepted and folded in: provider-job
state machine, media-download/API-client separation, enforced untrusted-content envelope,
spend guards (video confirm-first + caps, 200K threshold flag, max-sources), no-auto-retry
taxonomy with idempotency keys, outbound secret preflight, runtime selectModel(), error
contract, key-aware degraded hook, moderation-refusal fallback path, probe acceptance
contract, expanded mocked-test list, EXIF stripping, stop-gate disabled default, review
command demoted to explicit-invocation. Rejected: shared cross-plugin settings file for the
image default (Codex) — heavier than the versioned hook override + setup sibling check that
achieves the same guarantee.
