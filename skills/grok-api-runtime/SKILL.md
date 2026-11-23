---
name: grok-api-runtime
description: Contract for invoking the Grok companion runtime
---

# Grok companion runtime

Use `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" <command> [flags]`.

| Command | Purpose |
|---|---|
| `ask` | Targeted Q and A; `--live` uses fresh web and X search |
| `review`, `adversarial-review`, `rescue`, `transfer` | Explicit delegation paths |
| `imagine` | Raster image generation with up to three source images |
| `video --seconds <1-30> [--confirm-cost]` | Persistent provider video job; without `--confirm-cost` it exits 9 with the estimate and sends nothing |
| `speak (<text> | --text-file <path>)` | Billed text to MP3 speech, saved locally |
| `transcribe --file <path>` | Billed transcript of one local MP3 or WAV; `text` and `details` are enveloped |
| `status`, `result`, `cancel` | JSON job management for video and background text jobs |
| `setup [--gate on\|off]` | Key, catalog and routes; `--gate` sets the stop-review gate for the current repository |

Video is two steps: run it without `--confirm-cost` to get the estimate, show it to the user, and add `--confirm-cost` only after the user's explicit yes. A flag the user typed is the approval. The five text commands take `--max-tokens <1-131072>` and `--background`; a background run returns a job id, is billed once like foreground, and is read with `status --id` and `result --id`. Each command accepts only its own flags; a bare `--` ends flag parsing. Pass `setup --gate` only when the user typed it.

Never pass credentials in arguments or files. The runtime reads `XAI_API_KEY` only from the environment and rejects credential-like content before dispatch. Error JSON uses exit codes 2 through 9.
