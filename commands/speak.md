---
description: Turn text into an MP3 file with Grok speech
argument-hint: "(<text> | --text-file <path>) [--voice <id>] [--language <code>] [--out <name>]"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" speak $ARGUMENTS`. The call is billed (about $15 per million characters; up to 60,000 characters). Pass the text as one quoted argument, or use `--text-file` with a UTF-8 file for long text. The defaults are voice `eve` and language `auto`. The MP3 is saved in `~/.grok-companion/media`, `--out` keeps only its base name, and an existing file is never overwritten. Report the returned absolute `path`. Never retry after a timeout or network error: the request may already have been billed.
