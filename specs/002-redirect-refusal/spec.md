# Spec 002: Refuse redirects on all authenticated xAI requests

Revision: 2 (2026-11-22). Status: APPROVED rev 2 (Gary, chat, 2026-11-22: "Approve full flow"). Revision 2 adds the parity plan below; R1 to R4 are unchanged.
Request (Gary, Claude Code chat, 2026-11-22): "Ratify + fix redirect gap", while ratifying the Grok Companion constitution.

## Problem

`requestAuthenticated` in `scripts/lib/api.mjs` sends `Authorization: Bearer <XAI_API_KEY>` and passes `redirect` to `fetch` only when a caller sets it. Only the catalog fetch (`models.mjs`) sets `redirect: "error"`. Chat, responses, `/models`, image generation, video submission and video polling all use fetch's default, `follow`. A redirect from `api.x.ai` would be followed with the request re-sent. The codex-plugin copy already sets `redirect: "error"` on every authenticated request. The ratified constitution, principle 2, says authenticated requests go only to `api.x.ai`.

Spec 001 kept the old default only to limit its own scope ("Defaults are unchanged for current callers"). It recorded no reason to keep following redirects.

## Requirements

- **R1.** `requestAuthenticated` defaults to `redirect: "error"` for every call.
- **R2.** A refused redirect surfaces as the existing `network` error class. No new error class or exit code.
- **R3.** Media artifact downloads (`media.mjs`, which are unauthenticated and use their own manual-redirect allowlist) are unchanged.
- **R4.** Bump the version from 0.1.1 to 0.1.2 so `claude plugin update` installs the change.

## Exclusions

No other runtime behavior, command, option or routing change. The codex-plugin copy needs no change.

## Acceptance criteria

- The test at `tests/api.test.mjs` asserts that a default call sends `redirect: "error"`, replacing "existing callers keep fetch defaults".
- `node --test` passes and `hooks/hooks.json` parses.
- Commit and push to `main` through a PR, then update the installed plugin to 0.1.2.

## Tasks

- T1. Update the test first so it fails on the current code.
- T2. Default `redirect` to `"error"` in `requestAuthenticated`.
- T3. Bump the version.
- T4. Run the tests and the JSON check.
- T5. Commit, open a PR, merge, and update the plugin.

REA: not applicable. This is a bounded client hardening change with no analysis target.

## Parity plan (decision, 2026-11-22)

Gary wants the more capable copy to be the base. codex-plugin is a superset of claude-source's runtime. Gary chose "Incremental" (Jev recommended `port_incremental` at confidence 0.65, which is below 0.70, so Gary decided). Each step gets its own spec, approval and PR:

1. This spec: refuse redirects on authenticated requests.
2. Image edits: `/images/edits` with repeatable `--source`. claude-source parses `--source` but has no edit endpoint.
3. Speech: `speak` (`/tts`, `--voice`, `--language`) and `transcribe` (`/stt`), with `/grok-companion:speak` and `/grok-companion:transcribe` commands.
4. Remaining flags: `--confirm-cost` video gate and `--max-tokens`.

The Claude-only parts (slash commands, SessionStart routing hook, Stop review gate) stay in claude-source.
