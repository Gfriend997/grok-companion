---
name: grok-prompting
description: Model routing and prompt guidance for Grok companion
---

# Prompting and routing Grok

| Job | Model |
|---|---|
| ask, including a few named large files | grok-4.3 |
| ask with `--live` | grok-4.6 |
| routine explicit review | grok-4.3 |
| adversarial review or rescue diagnosis | grok-4.6 |
| rescue with `--coding` | grok-build-0.1, then grok-4.6 if unavailable |
| transfer | grok-4.3 |

`--model` is the sole override. Use Kimi for whole-corpus sweeps and media understanding. Ask for confirmation before video, rescue, or adversarial review. Require `--allow-long-context` at 200K estimated tokens.
