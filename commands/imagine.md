---
description: Generate or edit a raster image with Grok
argument-hint: "[--source <image>]... [--out <name>] [--model <id-or-alias>] <prompt>"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine $ARGUMENTS`. Sources are limited to three and stripped of metadata before upload. With sources, the request goes to xAI's image edit endpoint and is routed only to an image model that accepts image input. The result is saved locally, never printed as base64, and an existing file is never overwritten. Report the returned absolute `path`.
