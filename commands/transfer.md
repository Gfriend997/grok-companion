---
description: Transfer a concise session briefing to Grok
argument-hint: "[--file <path>]... [--model <id-or-alias>] [--max-tokens <n>] [--background] <briefing>"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" transfer $ARGUMENTS`. Do not include credentials or confidential material. A `--background` run is billed like a foreground run and returns a job id; never re-run it after `failed` or `submission_unknown` without asking the user.
