# Research: Live model discovery and routing

Observed 2026-11-21 (America/Los_Angeles). The account key came from `XAI_API_KEY`. Only read-only, unbilled catalog endpoints were called. No generation request was sent.

## Live catalog for the configured key

`GET /v1/models` IDs: `grok-4.20-0309-non-reasoning`, `grok-4.20-0309-reasoning`, `grok-4.20-multi-agent-0309`, `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-4.7`, `grok-imagine-image`, `grok-imagine-image-2.0`, `grok-imagine-video`, `grok-imagine-video-1.5`, `grok-imagine-video-1.5-lite`.

`GET /v1/language-models` (selected fields):

| id | aliases (excerpt) | created | reasoning_effort | completion price |
|---|---|---|---|---|
| grok-4.20-0309-non-reasoning | grok-4.20-non-reasoning | 1773014400 | absent | 25000 |
| grok-4.20-0309-reasoning | grok-4.20, grok-4.20-reasoning | 1773014400 | absent | 25000 |
| grok-4.20-multi-agent-0309 | grok-4.20-multi-agent | 1773014400 | absent | 25000 |
| grok-4.3 | grok-4.3-latest | 1776384000 | none..xhigh, default low | 25000 |
| grok-4.5 | grok-4.5-latest, **grok-build-latest** | 1782691200 | low..xhigh, default high | 60000 |
| grok-4.6 | none | 1785974400 | low..xhigh, default high | 60000 |
| grok-4.7 | none | 1788307200 | low..xhigh, default high | 60000 |

All language models: input `text`+`image`, output `text`, `long_context_threshold` 200000.

`GET /v1/image-generation-models`: `grok-imagine-image` (created 1769558400, `image_price` 200000000), `grok-imagine-image-2.0` (created 1786147200, `image_price` 600000000, per quality/resolution `pricing` list).

`GET /v1/video-generation-models`: `grok-imagine-video` (1769558400, input text+image+video), `grok-imagine-video-1.5` (1779840000, input text+image+audio), `grok-imagine-video-1.5-lite` (1787702400, input text+image). No price fields.

Not listed: `grok-build-0.1`.

## Hardcoded IDs in the current source (commit dc4d2c6)

- `scripts/grok-companion.mjs:57-66` `selectModel`: `grok-4.3`, `grok-4.6`, `grok-build-0.1`.
- `scripts/grok-companion.mjs` `commandVideo` / `commandImagine` defaults: `grok-imagine-video-1.5`, `grok-imagine-image-2.0`.
- `scripts/lib/media.mjs`: the same two media defaults.
- `skills/grok-prompting/SKILL.md`: routing table.
- `tests/cli.test.mjs`, `tests/api.test.mjs`, `tests/media.test.mjs`: route expectations.
- `README.md`: routing description.

## Selection rule rationale

- The `capabilities.reasoning_effort` filter keeps out the `grok-4.20` variants (no capabilities field) without matching on ID names. On today's data, fast resolves to `grok-4.3` and strong to `grok-4.7`, which matches the current intent (cheap default, newest strong model).
- The coding role uses xAI's own `grok-build-latest` alias, so xAI decides which model is the coding model.
- The video role excludes `-lite`. This is the one name-based rule. The catalog has no field that separates the tiers, and `lite` is newer than `1.5`, so "newest" alone would pick the cheaper tier.

## Baseline tests

`node --test tests/` from the repository root: 47 tests, 47 pass. From inside `tests/`: 3 failures in `packaging.test.mjs`, because the paths are relative to the working directory.

## REA applicability

- Question: where model IDs are hardcoded and which call paths select a model.
- Authorized target/type: this repository's own source (about 841 lines of JavaScript).
- Useful supported capability: none beyond what a text search and reading the five runtime files already settle. The full call graph is `main`, then `delegation`/`commandImagine`/`commandVideo`, then `selectModel`/media defaults.
- Outcome: **not applicable**. The target is small and fully read, so an REA run would add no evidence. No REA run was performed or is claimed.

## Baseline test after setup (2026-11-21)

Not re-run after the Spec Kit setup copy. The setup added only `.specify/` and `.agents/skills/`.
