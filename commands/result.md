---
description: Read a Grok job result
argument-hint: "--id <job-id>"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" result $ARGUMENTS`. Output is JSON. A video is downloaded once; later calls return the stored path.
