---
description: List Grok jobs or inspect one
argument-hint: "[--id <job-id>]"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" status $ARGUMENTS`. Output is JSON. Listing jobs (no `--id`) deletes finished job records older than 7 days and leftover side files, and first prints a `{"pruned":{...}}` line with the counts when it deleted anything; that line is not a job, and the job list is the last line.
