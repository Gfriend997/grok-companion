---
description: Transfer a concise session briefing to Grok
argument-hint: "[--file <path>]... [--model <id-or-alias>] <briefing>"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" transfer $ARGUMENTS`. Do not include credentials or confidential material.
