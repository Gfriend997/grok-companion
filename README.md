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

`setup` reports key presence, API reachability, and the model list. It never prints the key
value.

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
/grok-companion:review                      # Grok reviews your working diff
/grok-companion:rescue why does tests/jobs.test.mjs flake on CI?
```

## Commands (Claude Code)

| Command | What it does |
|---|---|
| `/grok-companion:setup` | Check key presence + API reachability + model list; `--gate on\|off` toggles the stop-review gate |
| `/grok-companion:ask` | One question; `--file` (repeatable) attaches text/jpg/png; `--live` enables Live Search + X Search |
| `/grok-companion:review` | Grok reviews your current diff (falls back to last commit) |
| `/grok-companion:adversarial-review` | Hostile review pass hunting for breakage |
| `/grok-companion:rescue` | Delegate a task; Grok returns a plan and diffs for Claude to apply |
| `/grok-companion:imagine` | Generate or edit an image; `--source` (≤3, repeatable) for editing/compositing |
| `/grok-companion:video` | Generate a video; `--seconds` required, `--from-image` for image-to-video; background job by default, `--wait` for foreground |
| `/grok-companion:status` | List background jobs (`--id` for one), JSON output |
| `/grok-companion:result` | Fetch a finished job's output / download its artifact |
| `/grok-companion:cancel` | Cancel a job (locally abandoned if xAI has no server-side cancel) |
| `/grok-companion:transfer` | Summarize the current session into a Grok task (context handoff) |

Common flags: `--model` (overrides automatic selection), `--max-tokens`, `--max-sources`
(Live Search cap), `--allow-long-context`, `--background`, `--out`.

## Models — selected per job, not fixed

The runtime picks the model from the job type (`selectModel`); `--model` always wins.

| Job | Model | Why |
|---|---|---|
| ask, quick question | grok-4.3 | 1M context, half the price of 4.6 |
| ask over large attached files | grok-4.3 | 1M context |
| ask --live | grok-4.6 | best reasoning over fresh data |
| review | grok-4.3 | volume work |
| adversarial-review | grok-4.6 | quality matters |
| rescue (debug/diagnosis) | grok-4.6 | hardest reasoning |
| rescue (bounded coding task) | grok-build-0.1 | coding-tuned, cheapest |
| transfer | grok-4.3 | session context can be huge |
| imagine | grok-imagine-image-2.0 | $0.04/image |
| video | grok-imagine-video-1.5 | $0.08/second |

## Cost guards

- `video` requires an explicit `--seconds` (capped) and prints the dollar cost before dispatch.
- Requests estimated at ≥200K tokens are refused without `--allow-long-context` — xAI bills
  the *entire* request at roughly double above that threshold.
- `--live` responses report the API's own usage fields (sources used, tool calls, cost);
  `--max-sources` caps search breadth.

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
  are refused as attachments. Binary documents (PDF, Office, OpenDocument, zip, epub, or
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
node --test tests/
```

For the Codex package, from the repo root:

```powershell
node --test codex/tests/*.test.mjs
```

Offline suites run against live-captured fixtures (`tests/fixtures/`, see
`docs/PROBE_REPORT.md`). Live end-to-end (uses your key, makes real API calls, media calls
are billed): `setup`, `ask`, `ask --live`, `review`, `imagine`, a short `video` plus
`status`/`result`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `XAI_API_KEY not set` | The variable was set after Claude Code started. Restart Claude Code — child processes inherit the environment at launch. |
| `410` mentioning Live Search | You are on an old fork sending `search_parameters`; current builds use the Agent Tools API on `/v1/responses`. Update the plugin. |
| Request refused with a long-context message | Estimated ≥200K tokens; xAI bills the whole request at ~2x above that line. Trim attachments or pass `--allow-long-context` deliberately. |
| `video` refuses to run | `--seconds` is required and capped; the cost line prints before dispatch. |
| Artifact download refused | The URL's host is outside the allowlist (`imgen.x.ai`, `vidgen.x.ai`). That is the security model working, not a bug. |
| Slash commands missing after install | Marketplace changes need a session restart. |

## Roadmap / TODO

- [ ] **Evaluate a secret manager instead of a plain environment variable.** Same open item as
  the sibling plugins: 1Password CLI (`op run`), OS keychain, or short-lived tokens if xAI
  ships them. Whatever wins should land in all three companions identically.
- [ ] Voice (speech-to-speech, STT, TTS) — xAI has endpoints; out of scope for v1.
- [ ] Image editing acceptance tests with `--source` compositing.

## Routing policy

A `SessionStart` hook injects the routing policy into Claude's context each session:
real-time questions and video generation route here (video confirms cost first), raster
image generation routes here **by default** (Gemini demoted to fallback), understanding of
media stays with Kimi, routine diff reviews stay with Gemini. If `XAI_API_KEY` is missing,
the hook emits a degraded policy that hands image generation back to Gemini.

## Architecture

One Node entry script (`scripts/grok-companion.mjs`), stdlib only. Text commands share one
engine: build messages (preset + prompt + attachments) → one REST call → print. Libraries:
`api.mjs` (authenticated client, `/chat/completions` + `/responses`), `attach.mjs` (files →
content parts, EXIF strip), `media.mjs` (generation + unauthenticated artifact downloads),
`jobs.mjs` (provider-job state machine for async video), `scrub.mjs` (masking + outbound
preflight). Design and verification history: `docs/specs/`, `docs/PROBE_REPORT.md`.

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
- No voice endpoints wired up yet.
- No server-side video cancel found on the API; `cancel` marks such jobs locally abandoned.
- `transfer` is a context-handoff summary, not a session import.
- The stop-review gate ships disabled and never blocks on its own failure.
