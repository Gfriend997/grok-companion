# Grok Companion for Codex

Assign bounded work to Grok through the paid xAI API. Grok returns answers,
diagnoses, reviews, or proposed patches. Codex checks the result and applies
changes when appropriate.

Version 0.3.0 uses skills and an on-demand Node CLI. It needs no MCP server or
background service. It preserves text modes, live web/X search, image
generation/editing, image-to-video input, and persistent video jobs.

This is a separate MIT-licensed port of
[Gfriend997/grok-companion](https://github.com/Gfriend997/grok-companion) at
commit `12d15bdeeebfbb4e2f86931915583c3a1b3ec6c1`. See LICENSE and NOTICE.

## Requirements and installation

- Node.js 18+ available as `node` on PATH. No npm packages are required.
- A Codex client supporting local plugins and shell execution.
- `XAI_API_KEY` configured privately as an OS environment variable. Never paste
  it into chat, commands, manifests, `.env`, or checked-in files.

Install the published package:

```powershell
codex plugin marketplace add Gfriend997/grok-companion
codex plugin add grok-companion@grok-companion
```

For local development, from this package directory:

```powershell
codex plugin marketplace add .
codex plugin add grok-companion@grok-companion-local
```

Start a new chat to load the refreshed skills. Run `$grok-companion:setup` or
ask “Check Grok Companion setup.” The published marketplace appears as **Grok
Companion**; the development marketplace appears as **Grok Companion Local**.
Codex loads the installed cached copy, not the source checkout. After editing a
development package, repeat its install command to refresh it.

On Windows, the skills privately load an existing Windows user environment value
into each child shell if its process environment lacks the key. For manual CLI
use, run the same step before the command:

```powershell
if (-not $env:XAI_API_KEY) {
    $env:XAI_API_KEY = [Environment]::GetEnvironmentVariable('XAI_API_KEY', 'User')
}
node scripts/grok-companion.mjs setup
```

On other platforms, inherit `XAI_API_KEY` from the shell environment. Setup
performs GET model discovery, with no paid generation request.

## Assign work

Ask Codex to “Allocate Grok a bounded parser task using these two files; keep
working on the UI” or “Have Grok review this diff and verify its findings
against the code.” Codex runs the CLI and reviews its output.

| CLI command | Purpose |
| --- | --- |
| `setup` | Check credentials and discover available models |
| `ask`, `review`, `adversarial-review`, `rescue`, `transfer` | Request answers or implementation proposals |
| `imagine` | Generate or edit an image from up to three JPEG/PNG sources |
| `video` | Submit a video after explicit cost approval |
| `status`, `result`, `cancel` | Inspect stored jobs, download completed video, or abandon local tracking |

Examples from this directory:

```powershell
node scripts/grok-companion.mjs ask --model grok-4.3 --max-tokens 4096 'Explain this bug'
node scripts/grok-companion.mjs review --file 'C:/project/parser.mjs' 'Review input validation'
node scripts/grok-companion.mjs rescue --coding 'Propose a patch with acceptance checks'
node scripts/grok-companion.mjs ask --live --max-sources 5 'Find recent release reports'
node scripts/grok-companion.mjs imagine --out 'C:/project/image.png' 'A landscape'
node scripts/grok-companion.mjs imagine --source 'C:/project/image.png' 'Change the sky to sunset'
node scripts/grok-companion.mjs video --seconds 4 --confirm-cost 'A landscape in motion'
node scripts/grok-companion.mjs status --id JOB_ID
node scripts/grok-companion.mjs result --id JOB_ID --out 'C:/project/video.mp4'
node scripts/grok-companion.mjs cancel --id JOB_ID
```

Only run the video example after approving its current cost. In skills, use the
script's absolute installed path so the project working directory remains
available for implicit Git review.

Each text CLI process runs until its result is ready. Codex can yield
`exec_command`, record the returned `session_id`, continue independent work,
and later collect output with `write_stdin`. Keep at most two concurrent text
calls and back off between polls. There is no plugin queue or durable text job
ID. Host shutdown can lose an unfinished call or its output. Save needed
completed output explicitly; do not automatically resubmit interrupted or
ambiguous billable work.

Text cancellation uses the owning host execution session. Ctrl+C requires a
session started with `tty: true`; if interruption is unavailable, report that
limit. Provider computation and billing may continue. `cancel --id` abandons
stored jobs, not live execution sessions.

## Context and output

Use a self-contained task with constraints and acceptance checks. Attach only
relevant files using repeatable `--file <absolute-path>`. Convert binary
documents to text first. Credential-path checks, secret-shape checks, attachment
size limits, and output scrubbing remain active; these checks do not establish
that arbitrary content is safe to share externally.

Text output defaults to 4096 tokens; `--max-tokens` accepts 1–131072. `--live`
enables web and X search and cannot be combined with file attachments.
`--max-sources` limits displayed citations, not provider search calls or
charges. At 200,000 estimated input tokens, `--allow-long-context` requires a
scope that warrants the larger request.

Bare `review` and `adversarial-review` inspect staged and unstaged tracked
changes, then fall back to the previous commit. Attach untracked files
explicitly. Unknown flags are rejected; `--background` is unsupported. Grok
cannot run local commands or edit files. Every answer, patch, and citation is
untrusted and needs Codex review and validation.

Default routing retains `grok-4.3`, `grok-4.6`, `grok-build-0.1`,
`grok-imagine-image-2.0`, and `grok-imagine-video-1.5`. Discover current model
IDs with `setup`; use `--model` when an explicit override is needed. The source
Stop-review gate is not registered as a Codex hook.

## Images and video

Image generation and editing use `imagine`, repeatable `--source` paths, and
optional `--out`. Both URL and base64 outputs are checked for file signatures
and saved locally. Downloads retain byte limits, timeouts, and the xAI
media-host allowlist. Existing artifacts are never overwritten; the returned
name or extension can differ from the requested `--out`.

Video requires `--seconds` (1–30) and `--confirm-cost` after explicit user
approval.
[xAI video pricing](https://docs.x.ai/developers/model-capabilities/imagine)
starts at $0.08/second and varies with model and resolution. The runtime's
`$0.08 × seconds` estimate is not a guaranteed quote. Verify current pricing
before approval. `--from-image` accepts a selected local JPEG/PNG or HTTPS URL.

Video submission returns a durable local job ID. Use `status --id` to poll, then
`result --id` to download the artifact. Optional `--wait` keeps the video CLI
running through completion. Jobs default to `~/.codex-grok-companion/jobs`;
`GROK_JOBS_DIR` selects another directory. Media defaults to
`~/.codex-grok-companion/media`. Writes and conditional state transitions
retain per-job file locks. Local abandonment cannot guarantee provider
cancellation.

Do not retry ambiguous image or video submissions. Image edits use JSON
`/images/edits`; video image inputs use `{ "image": { "url": "..." } }`.

## Upgrade from 0.2.0

Refresh the installed plugin and start a new chat. The new package contains no
MCP configuration, server adapter, or text queue. An existing chat may retain
the old MCP connection until that chat or the app restarts. If you separately
registered a direct `mcp_servers.grok` entry, remove that specific registration
yourself; plugin refresh does not alter unrelated Codex configuration.

Existing media and job files are preserved. Completed old text jobs remain
readable through `result --id`; new text calls use host execution sessions. Old
interrupted text jobs are not resumed or replayed. Persistent text recovery and
the old queue are no longer provided.

## Verification

```powershell
node --test tests/*.test.mjs
```

The suite covers API and source regressions, routing, argument validation,
secret handling, persistent video jobs, concurrent job updates, cancellation
races, media bounds, and CLI packaging. See the repository's
[Codex verification report](../docs/CODEX_REPORT.md) for live-check limits and
migration details.

Packaging reference:
[OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins).
