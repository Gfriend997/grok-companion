---
description: Request an explicit Grok review
argument-hint: "[--model <id-or-alias>] [--max-tokens <n>] [--background] <scope or diff>"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" review $ARGUMENTS` and assess findings before acting. A bare run reviews staged and unstaged changes to tracked files, then the last commit; attach untracked files with `--file`. A `--background` run is billed like a foreground run and returns a job id; never re-run it after `failed` or `submission_unknown` without asking the user.
