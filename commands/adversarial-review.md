---
description: Request a hostile Grok second-pass review
argument-hint: "[--model <id-or-alias>] <scope or diff>"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" adversarial-review $ARGUMENTS` and separate verified findings from claims.
