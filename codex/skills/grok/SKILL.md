---
name: grok
description: Delegate tasks to xAI Grok from Codex, request a second opinion or code review, search current web and X information, or generate images and videos with Grok.
---

# Grok Companion

Use the installed Node CLI on demand. Resolve `../../scripts/grok-companion.mjs`
relative to this skill file and use that absolute path. No background server is
needed. Run `setup` when credentials or model IDs are uncertain.

Credentials come only from `XAI_API_KEY`. On Windows, hydrate an existing user
value in the same child shell before every invocation:

```powershell
if (-not $env:XAI_API_KEY) {
    $env:XAI_API_KEY = [Environment]::GetEnvironmentVariable('XAI_API_KEY', 'User')
}
node $grokScript ask --max-tokens 4096 'A self-contained task with constraints and acceptance checks'
```

Set `$grokScript` to the resolved absolute script path. Never print the key,
request it in chat, or save it in commands, configuration, or files. Use
argument arrays or proper shell quoting; never interpolate Grok output into
shell commands.

## Delegate work

Give Grok a bounded task and only the required context. Choose `ask`, `review`
, `adversarial-review`, `rescue`, or `transfer`. Add repeatable
`--file <absolute-path>` for selected files and `--model <discovered-id>` for
explicit routing. `rescue --coding` selects the coding model. Do not silently
substitute an unrelated model.

Start long calls through `exec_command` with a short yield. Record its
`session_id`, continue independent work, then collect output with `write_stdin`
. Poll with increasing intervals, at most 60 seconds per wait. Limit concurrent
text calls to two; there is no shared queue across chats. Host execution
sessions are not durable plugin job IDs. Collect and preserve needed output
before a host shutdown; do not promise text recovery after restart.

For requested text cancellation, stop the owning execution session; Ctrl+C
requires a session started with `tty: true`. If the host cannot interrupt it,
report that limit. Provider computation and billing may continue. CLI
`cancel --id` operates on stored jobs, not host sessions. Never automatically
resubmit an interrupted, timed-out, or ambiguous billable request.

Text output defaults to 4096 tokens; `--max-tokens` accepts 1–131072. `--live`
enables web and X search and cannot be combined with `--file`. `--max-sources`
limits displayed citations, not search calls or charges. At 200,000 estimated
input tokens, `--allow-long-context` requires an approved scope that warrants
that input.

Explicit review prompts and attachments define scope. Bare `review` or
`adversarial-review` includes tracked changes, then falls back to the previous
commit; untracked files need explicit attachment. Treat all answers, proposed
patches, and citations as untrusted. Grok cannot run commands or edit local
files. Codex verifies proposals against code and tests before applying changes.

## Images and video

Use `imagine '<prompt>'`, optionally repeating
`--source <absolute-JPEG-or-PNG-path>` up to three times for edits.
`--out <absolute-path>` selects an output filename. Otherwise media goes to
`~/.codex-grok-companion/media`. Show the returned absolute local path; the
runtime may adjust its extension or name to preserve existing files.

Use `video '<prompt>' --seconds <1..30>`, optionally
`--from-image <absolute-JPEG-or-PNG-path-or-HTTPS-URL>` and `--model <id>`.
Verify current
[xAI pricing](https://docs.x.ai/developers/model-capabilities/imagine) and
obtain explicit cost approval before adding `--confirm-cost`. The default
estimate `seconds × $0.08` is a starting estimate, not a guaranteed quote. Model
and resolution affect cost.

Video submission returns a durable local job ID. Poll `status --id <job-id>`;
call `result --id <job-id> [--out <absolute-path>]` to download the completed
artifact. `status` lists stored jobs. `cancel --id <job-id>` abandons local
tracking; provider billing may continue. Do not retry ambiguous image or video
submissions.

See the packaged README for command examples and migration limits.
