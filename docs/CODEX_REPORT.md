# Codex package verification report

Date: 2026-10-09. Package: `codex/`, version 0.3.0.

The Codex package ports the Claude Code runtime at commit
`12d15bdeeebfbb4e2f86931915583c3a1b3ec6c1`. Claude commands, hooks, and runtime stay
at the repo root. Codex gets separate skills, metadata, tests, and a Node CLI.
Both packages use Node standard libraries only.

## Interface and migration

Codex invokes `scripts/grok-companion.mjs` from the installed plugin on demand.
There is no MCP configuration, server adapter, or background service. `ask`,
`review`, `adversarial-review`, `rescue`, and `transfer` return untrusted text for
Codex to check. `--live` enables xAI web and X search. Images use `imagine`; video
uses `video`, `status`, `result`, and local `cancel`.

Codex can yield a shell execution session, keep its `session_id`, continue other
work, and collect the result later. These handles are not durable plugin job IDs.
The skill limits concurrent text calls to two; there is no shared queue across
chats. Save needed output before shutting down the host. Interrupted or ambiguous
billable requests are never automatically replayed.

The former 0.2.0 Codex MCP package is retired. Completed old text job records and
video job records remain readable; new text calls use execution sessions. Existing
media and job files are preserved. A new chat loads the updated skills. A direct
MCP registration made separately from plugin installation needs separate removal.

## Security and cost controls

- `XAI_API_KEY` stays in the environment. Windows skills privately hydrate an
  existing user value into the child shell; they do not print or persist it.
- Setup only discovers models with GET. It does not submit paid generation calls.
- Outbound secret checks, credential-path rejection, file-size limits, and output
  scrubbing remain active. Grok cannot edit local files or run local commands.
- Text output defaults to 4096 tokens. Explicit `--max-tokens` overrides it.
  Estimated inputs at 200,000 tokens require `--allow-long-context`.
- Media downloads retain host checks, size limits, timeouts, signature checks,
  and collision-safe local writes. Image editing uses JSON `/images/edits`.
- Video needs explicit cost approval before `--confirm-cost`. The default estimate
  starts at $0.08/second; verify current provider pricing before approval.
- Cancellation abandons local work. Provider computation and billing can continue.

## Checks

| Check | Result |
|---|---|
| Claude Code offline suite | 47 passed; no failed or skipped tests |
| Codex offline suite | 68 passed; no failed or skipped tests |
| Native Codex discovery | Both delegation and setup skills loaded; no Grok MCP server started |
| Live model discovery | 14 model IDs returned |
| Live text request | grok-4.3 returned exactly `GROK_OK` |
| Legacy completed text result | Readable through CLI `result --id` without an API key |
| Image generation and editing | Passed before the CLI migration; not rerun during publication |
| Live video creation and web/X search | Not verified for the Codex package |

The suite covers routing, argument validation, secret handling, ambiguous request
handling, persistent video jobs, concurrent job updates, cancellation races, and
media limits. Tests use generic fixtures and do not require a live key:

```powershell
node --test codex/tests/*.test.mjs
```

Independent review found no actionable CLI migration defects. It identified an
unchanged limitation in `video --wait`: a later polling/download error can replace
an accepted provider ID with `submission_unknown`. The skill uses separate video
submission, `status`, and `result` commands, which avoid that download catch path.
This existing issue was kept outside the migration.
