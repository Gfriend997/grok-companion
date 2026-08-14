---
description: Locally abandon a Grok video job
argument-hint: "--id <job-id>"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" cancel $ARGUMENTS`. Video cancellation is local until a provider endpoint is verified.
