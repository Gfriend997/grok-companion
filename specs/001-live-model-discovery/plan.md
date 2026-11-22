# Implementation Plan: Live model discovery and routing

**Branch**: `001-live-model-discovery` | **Date**: 2026-11-21 | **Spec**: [spec.md](spec.md) revision 4

**Status**: Revision 4, approved and implemented.

## Summary

Add `scripts/lib/models.mjs`. It fetches the three xAI catalog endpoints with bounds, normalizes and validates them, caches them atomically, and resolves roles with no price limit: newest for strong, image and video; cheapest tier for fast; xAI's alias for coding. `selectModel` becomes role-based. Every output path carries the route metadata. `--model` and env pins are checked. `setup` reports the live catalog and routes. No new dependency.

## Technical Context

**Language/Version**: Node.js ESM, with built-in `fetch`, `node:crypto` and `node:test`. Locally tested on v26.13.1.

**Primary Dependencies**: none.

**Storage**: `<home>/.grok-companion/models.json`, written atomically following the temp-file pattern in `scripts/lib/jobs.mjs:47`. `<home>` comes from `deps`, so tests use a temp folder.

**Testing**: `node --test tests/`, with fixture catalogs and a counting fetch stub.

**Target Platform**: Claude Code plugin on Windows, macOS and Linux. On Windows, the 0600 file mode does not restrict access; the plan relies on validating cache content instead.

**Project Type**: CLI plugin.

**Performance Goals**: Warm cache: no added request. Cold cache: 3 parallel GETs, 5-second timeout each. A failed fetch is remembered for 5 minutes.

**Constraints**: The key is never stored or printed. Discovery failure never blocks a command whose route can fall back.

**Scale/Scope**: about 150 added source lines, plus tests and doc edits.

## Constitution Check

Governance checks (approvals, model reviews, task records) are kept in the maintainer's private decision record. REA applicability: not applicable, with the reason given in [research](research.md).

## Design

### `scripts/lib/models.mjs` (new)

- `FALLBACK_ROUTES`, `CODING_ALIAS = "grok-build-latest"` and `PRICE_BASELINES` (FR-004, FR-007).
- `fetchCatalog(request)`: runs 3 GETs through `requestAuthenticated` with `timeoutMs: 5000`, `redirect: "error"` and a 1 MB byte cap. It returns per-kind `{ available, entries }`.
- `normalize(raw, kind)`: keeps only the spec fields. It drops entries whose IDs fail the pattern.
- `loadCatalog({ request, env, home, now, fresh })`: implements the cache rules (FR-002, Edge Cases) and the 5-minute negative cache. A cache write failure is ignored.
- `resolveRole(role, catalog)`: returns `{ model, routeSource, modelVerified, priceChanged }` (FR-003, FR-004).
- `findModel(idOrAlias, kind, catalog)`: returns `{ entry } | { error: "unknown" | "wrong_kind" }`.

### `scripts/lib/api.mjs`

- `requestAuthenticated` gains optional `redirect` and `maxBytes` options. Defaults are unchanged for current callers.

### `scripts/grok-companion.mjs`

- `selectModel(role, flags, ctx)`: applies `--model`, then the env pin, then `resolveRole`. For an unknown ID, it follows US2 scenario 2: refetch once, accept unchecked if discovery fails, or reject if the catalog was fetched live in this invocation.
- Role mapping: ask, review and transfer use `fast`; `ask --live`, adversarial-review and rescue use `strong`; `rescue --coding` uses `coding`; imagine uses `image`; video uses `video`.
- Output metadata is added on every path (FR-005). The video route fields go in the job `request` object passed to `jobs.createJob` (`scripts/lib/jobs.mjs:57-62`), with the model resolved before the call.
- `fallbackApplied` is removed. `--build-unavailable` is a no-op.
- `setup` loads with `fresh: true` and adds `models` (new shape) and `routes`. `apiReachable` reflects the catalog result.
- The video cost line follows FR-010.

### `scripts/lib/media.mjs`

- Remove the default model parameters, so the caller always passes the model.

### Docs

- `skills/grok-prompting/SKILL.md`, the README routing and setup sections, and `commands/*.md` hints.

### Tests

- `tests/fixtures/catalog-2026-11-21.json`, plus variant builders inside the test file.
- New `tests/models.test.mjs`: role resolution, both newer-model cases, missing alias, a newer image model, a `-lite` model, numeric tie-break, missing language price, `priceChanged` true/false/null cases, no eligible model, partial and malformed fetch, cache fresh, stale and expired, fingerprint mismatch, invalid ID, negative cache, write failure, redirect and size rejection.
- `tests/cli.test.mjs`: route metadata on every output path, pins, invalid `--model` and pins with zero generation requests, refetch before rejecting (including refetch failure), and `setup`. The harness (`tests/cli.test.mjs:13-16`) gains an injected temp `home`, and a stub `requestAuthenticated` where catalog behaviour is under test.
- Update the `tests/api.test.mjs` and `tests/media.test.mjs` expectations.

## Removed after review

- Prefix suggestions for unknown IDs (plan review).
- The routing-policy v3 version bump (`print-routing-policy.mjs` names no model).
- The `resolvedAt` field.
- The `tests/` working-directory fix, which is unrelated and noted in the spec.

## Risks

- A model being listed does not prove it accepts the current request shapes (plan review). The capped paid smoke test T019 checks the models routed today.
- With no ceiling (D3), a pricier xAI release raises cost per call with no prompt. `priceChanged` makes this visible, but only after the request is billed. Reviewers recommended a ceiling; the maintainer chose to always use the newest model. Pins (FR-006) are the only control.

## Complexity Tracking

No justified violations.
