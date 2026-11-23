---
description: Request a hostile Grok second-pass review
argument-hint: "[--model <id-or-alias>] [--max-tokens <n>] [--background] <scope or diff>"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" adversarial-review $ARGUMENTS` and separate verified findings from claims. A `--background` run is billed like a foreground run and returns a job id; never re-run it after `failed` or `submission_unknown` without asking the user.
