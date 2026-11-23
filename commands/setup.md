---
description: Verify the Grok key, API reachability, the live model catalog, and resolved model routes
argument-hint: "[--gate on|off]"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" setup $ARGUMENTS`. Never request, echo, or store the API key. Pass `--gate` only when the user typed it, and never turn the stop-review gate on yourself. The gate is per repository: it sends large or risky diffs of this repository to xAI at stop, so it must never be on in a client-confidential repository. Exit 2 with a `message` field means xAI rejected the key for every model catalog; a single failed catalog is reported under `catalogSources` with its `error_class` and exits 0.
