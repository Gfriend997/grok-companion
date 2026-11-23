---
description: Cancel a Grok job
argument-hint: "--id <job-id>"
allowed-tools: Bash(node:*)
---

Run exactly: `node "${CLAUDE_PLUGIN_ROOT}/scripts/grok-companion.mjs" cancel $ARGUMENTS`. The request may still be billed: cancel never stops the provider. A background text worker is stopped only when its process can be verified as that job's worker; otherwise the job is abandoned locally. Video cancellation is local until a provider endpoint is verified.
