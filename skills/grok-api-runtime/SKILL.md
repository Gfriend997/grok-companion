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
| `video --seconds <1-30>` | Persistent provider video job |
| `status`, `result`, `cancel` | JSON job management |

Never pass credentials in arguments or files. The runtime reads `XAI_API_KEY` only from the environment and rejects credential-like content before dispatch. Error JSON uses exit codes 2 through 9.
