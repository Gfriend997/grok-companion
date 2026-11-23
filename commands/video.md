---
description: Create a persisted Grok video job
argument-hint: "--seconds <1-30> [--confirm-cost] [--from-image <path-or-https-url>] [--wait] [--model <id-or-alias>] <prompt>"
allowed-tools: Bash(node:*)
---

Video is billed. Approval comes from the user, never from you:

1. Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" video $ARGUMENTS`.
2. If it exits 9 with the `--confirm-cost` message, show the user the estimate and ask whether to spend it. Wait for the answer.
3. Only after an explicit yes, run the same command again with `--confirm-cost` added. Never add the flag without that answer. A `--confirm-cost` that the user typed is the approval, and the command runs once.
4. Never retry after a timeout or network error.

A local `--from-image` is checked and encoded before the estimate; only JPEG and PNG are accepted. With `--from-image` the estimate adds the flat $0.01 image input charge; show it to the user with the rest.
