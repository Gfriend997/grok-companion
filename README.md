# grok-companion

Claude Code and Codex plugins that delegate work to xAI's Grok models: real-time
Live Search and X Search, image generation, video generation, code review,
adversarial review, delegated tasks, and background jobs. Third sibling to
[gemini-companion](https://github.com/Gfriend997/gemini-companion) and
[kimi-companion](https://github.com/Gfriend997/kimi-companion).

The Claude Code package lives at the repo root. The [Codex package](codex/README.md)
lives in `codex/` and runs through an on-demand Node CLI, without an MCP server.

The idea is not original. It is OpenAI's [codex-plugin-cc](https://github.com/openai/codex-plugin-cc),
which established the pattern of driving a second model from inside Claude Code and set the
command surface all three companions follow. See [Credits](#credits).

**What Grok adds that the siblings don't:** server-side Live Search over the web and X
(neither Gemini nor Kimi companion has real-time data), and video generation. Image
generation is also here and is the routing default for this machine. Image and video
*understanding* stay with kimi-companion.

## Requirements

- Node.js 18+ (no npm dependencies)
- An xAI API key from the [xAI console](https://console.x.ai)
- That key exported as an **OS-level environment variable** named `XAI_API_KEY`

> **Export the key into your environment. Never put it in a `.env` file.**
>
> This plugin does not read `.env` files and never will. A `.env` sitting in a working
> directory is one forgotten `.gitignore` line away from being committed, and once a key is in
> git history, rotating it is the only real fix. Environment variables leave nothing behind in
> the repo. Same rule for any config file, shell script, or command you type with the key
> inline — the key belongs in your environment, not in your project.

Export the key, then **restart Claude Code** so the new value is inherited by the plugin's
processes:

```powershell
# Windows (PowerShell) — persists for your user account
setx XAI_API_KEY "your-key-here"
```

```bash
# macOS / Linux — add to ~/.zshrc or ~/.bashrc, then reopen the shell
export XAI_API_KEY="your-key-here"
```

Developed and tested on Windows. POSIX code paths exist but are untested — reports welcome.

## Install

### Claude Code

In Claude Code:

```
/plugin marketplace add Gfriend997/grok-companion
/plugin install grok-companion
```

If the repo is private or you want to run a local checkout, point the marketplace at the
directory instead:

```
/plugin marketplace add C:/path/to/grok-companion
/plugin install grok-companion
```

Then verify the key and connectivity:

```
/grok-companion:setup
```

`setup` reports key presence and API reachability. It also lists every model in your
account's live xAI catalog (kind, aliases, modalities, listed prices) and the model each job
role resolves to right now. It never prints the key value.

### Codex

```powershell
codex plugin marketplace add Gfriend997/grok-companion
codex plugin add grok-companion@grok-companion
```

Start a new chat and run `$grok-companion:setup`, or ask “Check Grok Companion setup.”
The Codex skills use the same `XAI_API_KEY`; on Windows they privately load an existing
user environment value into each child shell when needed. No server registration is
required.

Ask Codex to “Allocate Grok a bounded task using these two files; keep working on the
UI.” Grok returns a proposal for Codex to check and apply. Text calls can run in Codex
execution sessions while Codex continues other work; video jobs retain persistent IDs.
Text sessions do not survive a host shutdown. See [Codex usage](codex/README.md) and
the [Codex verification report](docs/CODEX_REPORT.md) for commands and limits.

## Quick start

```
/grok-companion:ask --live what changed in the Node 24 release this week?
/grok-companion:imagine a red panda reading a newspaper, watercolor
/grok-companion:video --seconds 4 a paper plane looping through an office
/grok-companion:speak "Release notes are ready for review."
/grok-companion:transcribe --file meeting.mp3
/grok-companion:review                      # Grok reviews your staged and unstaged changes
/grok-companion:rescue why does tests/jobs.test.mjs flake on CI?
```

## Commands (Claude Code)

| Command | What it does |
|---|---|
| `/grok-companion:setup` | Check key presence + API reachability + live model catalog and resolved routes; `--gate on\|off` turns the stop-review gate on or off for the current repository only |
| `/grok-companion:ask` | One question; `--file` (repeatable) attaches text/jpg/png; `--live` enables Live Search + X Search |
| `/grok-companion:review` | Grok reviews your staged and unstaged changes to tracked files (`git diff HEAD`; falls back to the last commit). Attach untracked files with `--file` |
| `/grok-companion:adversarial-review` | Hostile review pass hunting for breakage |
| `/grok-companion:rescue` | Delegate a task; Grok returns a plan and diffs for Claude to apply |
| `/grok-companion:imagine` | Generate or edit an image; `--source` (≤3, repeatable) sends an edit to `/images/edits`. Results are saved locally, including base64 results |
| `/grok-companion:video` | Generate a video; `--seconds` required, `--from-image <local JPEG or PNG, or https:// URL>` for image-to-video (a local image is checked and encoded before the estimate); refused with a cost estimate until `--confirm-cost` is added after the user approves; background job by default, `--wait` for foreground |
| `/grok-companion:speak` | Billed text to MP3 speech; `--text-file` for long text, `--voice`, `--language`, `--out`. Saved locally |
| `/grok-companion:transcribe` | Billed transcript of one local MP3 or WAV (`--file`); `--language`, `--model`. Output is enveloped as untrusted |
| `/grok-companion:status` | List video jobs and background text jobs (`--id` for one), JSON output |
| `/grok-companion:result` | Fetch a finished job's output (a background text job prints its foreground output) / download a video artifact once; later calls return the stored path, even if the file was moved |
| `/grok-companion:cancel` | Cancel a job: a background text worker is stopped only when its process is verified, otherwise abandoned locally; video jobs are abandoned locally. The request may still be billed |
| `/grok-companion:transfer` | Summarize the current session into a Grok task (context handoff) |

Common flags: `--model` (overrides automatic selection), `--max-tokens` (an output cap from 1 to
131072 on the text commands; no default, so nothing is sent without it), `--max-sources`
(Live Search cap), `--allow-long-context`, `--background` (the five text commands only: returns a
job id at once and runs the one request in a detached worker), `--out`. Each command accepts only
its own flags: an unknown or misplaced flag exits 9 before any request. A bare `--` ends flag
parsing, so a prompt word that starts with `--` goes after it.

## Models — selected per job, not fixed

The runtime reads your account's live xAI model catalog (`/v1/language-models`,
`/v1/image-generation-models`, `/v1/video-generation-models`), caches it for 24 hours at
`~/.grok-companion/models.json`, and picks a model by job role. New xAI models are used
without a plugin update, and retired ones stop being defaults. **There is no price limit:**
when xAI releases a newer, pricier model, the strong, image and video roles move to it. A newer,
cheaper model no longer takes the strong role.

| Job | Role | Rule | Today (2026-11-21) |
|---|---|---|---|
| ask, review, transfer | fast | cheapest price tier, newest model in it | grok-4.3 |
| ask --live, adversarial-review, rescue | strong | highest price tier, newest model in it | grok-4.7 |
| rescue --coding | coding | the target of xAI's `grok-build-latest` alias, else the strong route (a `_STRONG` pin applies), reported as `roleFallback: "strong"` | grok-4.5 |
| imagine | image | newest non-`-lite` image model | grok-imagine-image-2.0 |
| video | video | newest non-`-lite` video model | grok-imagine-video-1.5 |

Language models must list a completion price and advertise `reasoning_effort` to be routed.
With an image attachment, `--source` or `--from-image`, only models whose catalog entry accepts image
input are considered. An explicit `--model` without image input exits 9 before any billed request.
If the catalog can't be fetched (and no cache under 7 days old exists), the built-in
fallback IDs above are used.

Every result reports `model`, `routeSource` (`flag`, `env`, `live`, `cache`, `cache-stale`,
`fallback`, and `default` for the built-in transcription model), `modelVerified`, and `priceChanged`. `priceChanged` is true when the model's
listed price differs from the 2026-11-21 price for its role. For `--live`, these appear on a
`Route:` line after the untrusted-content envelope. `rescue --coding` results also report
`roleFallback`: `null` for the alias target, a pin or `--model`, and `"strong"` when the strong
route was used.

Overrides: `--model <id-or-alias>` accepts any catalog model of the right kind, and rejects
unknown or wrong-kind models before any billed request. Pin a role with the environment
variables `GROK_COMPANION_MODEL_FAST`, `_STRONG`, `_CODING`, `_IMAGE` or `_VIDEO`; `--model`
wins over a pin. `--build-unavailable` is accepted but no longer needed.

## Cost guards

- `video` requires an explicit `--seconds` (capped) and `--confirm-cost`. Without the flag it exits 9
  with the estimate (`<seconds> × $0.08`, a starting rate measured on 2026-08-13 for one model; the
  real price varies by model and resolution) and sends nothing. Add the flag only after the user
  approves; the run then prints the cost line before dispatch.
- `--max-tokens` caps billed output tokens only when it is given. There is no default limit, and
  a cut answer is not marked.
- A `--background` run costs the same as a foreground one: one request. It is billed even if the
  job is cancelled or the worker dies, and it is never re-sent. A `running` text job older than
  6 minutes is reported as `submission_unknown`.
- The stop-review gate is off by default and set per repository (`setup --gate on`). At stop it
  reviews only a large or risky `git diff HEAD` (staged and unstaged tracked changes, the same text
  a bare `review` reads), at most once per distinct diff and once per stop sequence. Staging a
  diff that was already reviewed does not bill it again. A routine diff costs nothing and prints nothing. A diff is risky
  when it has 400 or more changed lines, or when a changed path word starts with, or a changed
  line matches, one of these:

  | Category | Path word stems and files | Changed-line words |
  |---|---|---|
  | auth | auth, login, signin, oauth, sso, session, jwt, password, passwd, permission, rbac, acl | password, authenticat, authoriz, jwt, oauth, bcrypt, argon2, set-cookie |
  | secrets | secret, credential, token, apikey, keystore, vault; `.env*`, `*.pem`, `*.key`, `*.pfx`, file names holding `api_key`, `api-key`, `apikey`, `private_key`, `private-key` or `privatekey` | secret, credential, and `api key`, `private key`, `access token` written with a space, `_`, `-` or nothing between the words |
  | data | database, db, storage, backup, delete, purge | drop table/database/column/schema, truncate, delete from, rm -rf, rmSync, unlink, Remove-Item, deleteMany, destroy_all |
  | money | payment, billing, invoice, checkout, stripe, paypal, pricing, refund, subscription, ledger, payout | payment, invoice, refund, stripe, paypal, billing, payout |
  | migration | migration, migrate, schema, prisma, alembic; `*.sql` | create/alter table, add column, migration |
  | security | security, crypto, encrypt, decrypt, cors, csrf, firewall, rls, sanitize | encrypt, decrypt, csrf, cors, sanitiz, eval(, child_process, rejectUnauthorized, verify=false, --no-verify, row level security, icacls, chmod |
- Requests estimated at ≥200K tokens (attachments plus the prompt) are refused without
  `--allow-long-context` — xAI bills the *entire* request at roughly double above that threshold.
- `--live` responses report the API's own usage fields (sources used, tool calls, cost);
  `--max-sources` caps search breadth.
- **No billable request is ever re-sent.** Every command, text ones included, sends one
  request. A failed POST reports `retryable: false`, and a timeout or network error says the
  submission may already have been accepted. Re-run the command yourself if you need to.

## Speech

`speak` turns text into an MP3 (`POST /v1/tts`); `transcribe` turns one local audio file into
text (`POST /v1/stt`). Both are billed and synchronous, with no cost gate and no job record.
Rates from 2026-10-19 research, not re-checked: speech about $15 per million characters
(60,000 characters is about $0.90), transcription about $0.10 per audio hour.

- `speak` takes 1 to 60,000 characters, as one quoted argument or from `--text-file <path>`.
  Windows command lines stop at 32,767 characters, so use `--text-file` for long text. The
  file must be UTF-8 (a UTF-8 BOM is removed; UTF-16, which Windows PowerShell 5.1 writes by
  default, is rejected) and at most 1 MiB. Defaults: voice `eve`, language `auto`. The MP3
  is saved in `~/.grok-companion/media`; `--out` keeps only its base name, and an existing
  file is never overwritten.
- `transcribe --file <path>` takes one local MP3 or PCM WAV of at most 25 MiB, checked from
  its bytes. Relative paths are resolved against the working directory, and credential
  paths are refused. The `text` field, and a `details` field with one line of JSON holding
  `language` and `words`, are inside the `UNTRUSTED-EXTERNAL-CONTENT` envelope, and the
  result has `untrusted: true`.
- The `--model` rule: with no `--model`, `transcribe` uses `grok-voice-transcribe-2.0`,
  reported as `routeSource: "default"`, `modelVerified: false`. An explicit `--model` that
  is a language, image or video model exits 9. It is then looked up in `GET /v1/models`: a
  listed id is sent (`modelVerified: true` when the whole catalog was available); an
  unlisted id exits 8 if the list includes `grok-voice-transcribe-2.0`; otherwise the id is
  sent unverified. The id is never replaced with another model.

## Live Search and untrusted content

`ask --live` uses xAI's Agent Tools API (`/v1/responses` with server-side `web_search` and
`x_search`). Results are wrapped by the runtime in an `UNTRUSTED-EXTERNAL-CONTENT` envelope
with source URLs listed separately. Search-derived text is data, not instructions: review the
sources before acting on anything it says.

## Security model

- **The API key never touches disk.** Read from `process.env` at call time, sent only as an
  `Authorization: Bearer` header — never argv, never a query parameter, never logged.
- **Two strictly separated network paths.** Authenticated calls go to `api.x.ai` only, HTTPS,
  exact host match. Generated-media downloads (`imgen.x.ai`, `vidgen.x.ai`) carry **no**
  auth header, revalidate redirects against the allowlist, cap download size, and sniff MIME
  from bytes.
- **Outbound preflight.** Prompt text and attachments are scanned before any request;
  key-shaped strings block the call and credential-file paths (`.env*`, `*.pem`, key stores)
  are refused for every attachment, image or text (`--file`, `imagine --source`,
  `video --from-image`), on the path as given and on its real path. Binary documents (PDF, Office, OpenDocument, zip, epub, or
  any file with a NUL byte in its first 8 KB) are rejected too: convert to markdown first
  (MarkItDown) and attach the `.md`. `--live` cannot be combined with `--file`.
- Everything written to job state or output passes a scrubber; masked-match counts are logged.
- Job state and generated media live outside any repo (`~/.grok-companion/`); artifacts are
  never auto-committed.
- EXIF metadata is stripped from images before upload.
- Grok's output is treated as untrusted: commands relay it verbatim and never auto-execute
  it. `rescue` returns diffs rather than editing files, so a human sees every write.

## Testing

```
node tests/index.mjs
```

For the Codex package, from the repo root:

```powershell
node --test codex/tests/*.test.mjs
```

Offline suites run against live-captured fixtures (`tests/fixtures/`, see
`docs/PROBE_REPORT.md`). They are fixed captures (2026-08-13, and the catalog of 2026-11-21);
this repository no longer holds a script that refreshes them. Live end-to-end (uses your key, makes real API calls, media calls
are billed): `setup`, `ask`, `ask --live`, `review`, `imagine`, a short `video` plus
`status`/`result`, and `speak` one sentence then `transcribe` the saved MP3.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `XAI_API_KEY not set` | The variable was set after Claude Code started. Restart Claude Code — child processes inherit the environment at launch. |
| `410` mentioning Live Search | You are on an old fork sending `search_parameters`; current builds use the Agent Tools API on `/v1/responses`. Update the plugin. |
| Request refused with a long-context message | Estimated ≥200K tokens; xAI bills the whole request at ~2x above that line. Trim attachments or pass `--allow-long-context` deliberately. |
| `video` refuses to run | `--seconds` is required and capped. Without `--confirm-cost` it exits 9 with the estimate and sends nothing: ask the user, then add the flag. |
| `video --from-image` refused | A local value must be a JPEG or PNG file of at most 20 MiB whose path holds no credential word; any other value must start with `https://`. `http://` and other schemes are refused. Nothing is sent. |
| Artifact download refused | The URL's host is outside the allowlist (`imgen.x.ai`, `vidgen.x.ai`). That is the security model working, not a bug. |
| Slash commands missing after install | Marketplace changes need a session restart. |

## Roadmap / TODO

- [ ] **Evaluate a secret manager instead of a plain environment variable.** Same open item as
  the sibling plugins: 1Password CLI (`op run`), OS keychain, or short-lived tokens if xAI
  ships them. Whatever wins should land in all three companions identically.
- [x] File speech (TTS) and transcription (STT): `speak` and `transcribe`.
- [ ] Speech-to-speech and realtime voice.
- [ ] Image editing acceptance tests with `--source` compositing.

## Routing policy

A `SessionStart` hook injects the routing policy into Claude's context each session:
real-time questions and video generation route here (video needs the user's cost approval
through `--confirm-cost`), raster image generation routes here **by default** (Gemini demoted
to fallback), and understanding of media stays with Kimi. Grok review runs only when the user
asks, or at stop for a large or risky diff in a repository where the user turned the
stop-review gate on. Routine diffs go to the host's own reviewer; a Gemini second opinion is
for large or risky diffs only. If `XAI_API_KEY` is missing,
the hook emits a degraded policy that hands image generation back to Gemini.

## Architecture

One Node entry script (`scripts/grok-companion.mjs`), stdlib only. Text commands share one
engine: build messages (preset + prompt + attachments) → one REST call → print. Libraries:
`api.mjs` (authenticated client, `/chat/completions` + `/responses`, multipart uploads and
binary responses; one attempt per request), `attach.mjs` (files → content parts, EXIF
strip), `media.mjs` (image, video and speech generation, transcription with audio checks,
unauthenticated artifact downloads),
`jobs.mjs` (job store for async video and background text jobs, with locked writes that never
overwrite a finished job; `GROK_JOBS_DIR` selects its folder, default `~/.grok-companion/jobs`), `risk.mjs` (the
stop-review gate's risky-diff rule), `scrub.mjs` (masking + outbound preflight). Design and verification history: `docs/specs/`, `docs/PROBE_REPORT.md`.

## Credits

Original idea and command surface: **[openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)**
(Apache License 2.0, Copyright OpenAI). That plugin worked out the pattern this one copies —
slash commands for delegate/review/status/result/cancel, background jobs with an id you poll,
and a companion model that returns text for a human to act on rather than editing your files
behind your back. This plugin reached that surface by way of the author's
[gemini-companion](https://github.com/Gfriend997/gemini-companion) and
[kimi-companion](https://github.com/Gfriend997/kimi-companion) (both MIT).

No third-party source code was copied. The runtime here was written fresh against the xAI
REST API and shares no codebase with its predecessors. MIT licensed. Not affiliated with or
endorsed by OpenAI or xAI.

## Known limitations

- **No autonomous file edits.** Diffs come back for Claude or Codex to apply.
- No video *input* (understanding) — that is kimi-companion's job.
- Voice is file-based only: MP3 speech output and MP3 or PCM WAV transcription input. No
  realtime or speech-to-speech voice.
- Text commands no longer retry a transient 5xx or network error; re-run the command.
- No server-side video cancel found on the API; `cancel` marks such jobs locally abandoned.
- `transfer` is a context-handoff summary, not a session import.
- The stop-review gate ships disabled and never blocks on its own failure. When on, it sends
  every large or risky diff of that repository to xAI; the preflight rejects secret-shaped
  content but cannot tell whether code is confidential, so never turn it on in a
  client-confidential repository. The risky-diff rule is a word list: `tokenizer`, `author`
  or a README that mentions "payment", "API key", "access token" or "private key" bill a review,
  while risky logic in a neutrally named file and untracked files get none (`git add` brings a
  new file in). A staged change that was undone in the working tree is not reviewed, and in a
  repository with no commit `review` finds no diff and the gate stays silent. A failed or
  timed-out review is not retried for that diff, and the gate blocks only one stop per stop
  sequence.
- `--from-image`: the whole image (up to 20 MiB) is sent as base64 in the request body; only
  JPEG and PNG are accepted; an `https://` URL is sent as typed, on any host; the cost estimate
  does not rise for an image input. A path check cannot prove that an image shows no secret,
  and a file in a folder whose name holds a credential word is refused whatever it contains.
- `result` trusts the stored video path: if the file was moved or deleted it still prints that
  path, and a later `--out` is ignored. A failure after `video --wait` submits leaves the job
  `submitted` or `running`; run `status --id` and `result --id`.
- Job writes take a per-job lock. A foreground write that stays busy for one second fails with
  `job is busy; retry the local operation`; run the command again (nothing is re-sent). A
  background worker retries the lock for up to 60 seconds. If its final write still fails, for
  that or any other reason, it saves its answer to `<id>.answer.json`, which `status` and
  `result` apply. Lock and answer files left by a killed
  process are not pruned.
- The strong role takes the newest model in the highest price tier, so it can cost more than
  under 0.1.5 once xAI releases a newer model below the top tier, and a newer cheaper model is
  never used for strong without `--model` or a pin.
- A background job's worker can be stopped only when its process command line can be read
  (PowerShell on Windows, `ps` elsewhere); otherwise `cancel` abandons the job locally and the
  worker ends by itself within about 5 minutes. The job record keeps the prompt, file paths and
  answer under `~/.grok-companion/jobs` until deleted.
