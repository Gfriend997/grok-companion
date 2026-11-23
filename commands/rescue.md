---
description: Ask Grok for a diagnosis or bounded coding rescue
argument-hint: "[--coding] [--file <path>]... [--model <id-or-alias>] [--max-tokens <n>] [--background] <task>"
allowed-tools: Bash(node:*), Agent
---

Invoke `grok-companion:grok-rescue` with the raw request. Review returned diffs before applying them. `--coding` results report `roleFallback`: `"strong"` when the build alias was unusable and the strong route answered. A `--background` run is billed like a foreground run and returns a job id; never re-run it after `failed` or `submission_unknown` without asking the user.
