---
name: grok-prompting
description: Model routing and prompt guidance for Grok companion
---

# Prompting and routing Grok

The runtime reads the account's live xAI model catalog (cached 24 hours) and picks a model by role. There is no price limit.

| Job | Role | Rule | Model today (2026-11-21) |
|---|---|---|---|
| ask, review, transfer | fast | cheapest price tier, newest model in it | grok-4.3 |
| ask `--live`, adversarial review, rescue diagnosis | strong | newest model at any price | grok-4.7 |
| rescue `--coding` | coding | xAI's `grok-build-latest` alias, else strong | grok-4.5 |
| imagine | image | newest non-`-lite` image model | grok-imagine-image-2.0 |
| video | video | newest non-`-lite` video model | grok-imagine-video-1.5 |

Run `setup` to see the live catalog and the current routes. Every result reports `model`, `routeSource`, `modelVerified` and `priceChanged`. Tell the user when `priceChanged` is true or `modelVerified` is false.

Overrides: `--model <id-or-alias>` takes any catalog model of the right kind. Pin a role with `GROK_COMPANION_MODEL_FAST`, `_STRONG`, `_CODING`, `_IMAGE` or `_VIDEO`. `--model` wins over a pin, and unknown or wrong-kind models are rejected before any billed request. Use Kimi for whole-corpus sweeps and media understanding. Ask for confirmation before video, rescue, or adversarial review. Never add `--confirm-cost` without the user's explicit approval of the estimate, and never turn the stop-review gate on without the user. Require `--allow-long-context` at 200K estimated tokens.
