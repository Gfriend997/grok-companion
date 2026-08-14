---
description: Generate or edit a raster image with Grok
argument-hint: "[--source <image>]... [--out <name>] <prompt>"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" imagine $ARGUMENTS`. Sources are limited to three and stripped of metadata before upload.
