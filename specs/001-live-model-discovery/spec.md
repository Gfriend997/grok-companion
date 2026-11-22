# Feature Specification: Live model discovery and routing

**Feature Branch**: `001-live-model-discovery`

**Created**: 2026-11-21

**Status**: Revision 4, approved and implemented on branch `001-live-model-discovery`.

**Input**: Maintainer request to update model routing so the plugin works with every model in the account's xAI catalog, using live model discovery.

## Problem

The Claude Code plugin hardcodes xAI model IDs in `selectModel` (`scripts/grok-companion.mjs:57-66`), in the media defaults, in `skills/grok-prompting/SKILL.md`, in tests and in the README. On 2026-11-21 the live xAI catalog for the configured key differed from that list:

- `grok-build-0.1`, the `rescue --coding` route, is no longer listed. Coding rescue fails unless the user adds `--build-unavailable` by hand. `grok-build-latest` is now an alias of `grok-4.5`.
- `grok-4.7` is the newest model. Routing stops at `grok-4.6`.
- `setup` lists IDs only, with no kind, aliases, modalities, prices or resolved routes.

Evidence: [research](research.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Routing follows the live catalog (Priority: P1)

A user runs a delegation, image or video command without `--model`. The companion picks a model that the account's catalog lists now and that fits the job role. No role is limited by price (decision D3). `strong`, `image` and `video` move to the newest eligible model automatically. `fast` is by definition the cheapest price tier, and picks the newest model within that tier. `coding` follows xAI's own `grok-build-latest` alias.

**Why this priority**: The current coding-rescue default is broken, and every xAI release makes a fixed list staler.

**Independent Test**: Use fixture catalogs (current; a newer same-price flagship; a newer pricier flagship; the coding alias removed; a newer image model). Check that each role resolves as expected, and that no generation request goes to an unlisted model when the catalog was fetched.

**Acceptance Scenarios**:

1. **Given** the 2026-11-21 catalog, **When** the user runs `rescue --coding` with no `--model`, **Then** the request uses `grok-4.5`, the target of `grok-build-latest`, with no manual flag.
2. **Given** the 2026-11-21 catalog, **When** the user runs `adversarial-review` or `ask --live`, **Then** the request uses `grok-4.7`.
3. **Given** a fixture that adds a newer eligible language model, at the same or a higher price, **When** a strong-role command runs, **Then** the request uses the newer model, with no code change. The result names the model.
4. **Given** a fixture that adds a newer language model at a different price (higher or lower), **When** a strong-role command runs, **Then** the result includes `priceChanged: true` (FR-004). This is a visible notice only, not a block.
5. **Given** a fixture that adds a newer image model, **When** the user runs `imagine`, **Then** the request uses the newest image model.
6. **Given** the language catalog cannot be fetched and no cache is usable, **When** a delegation command runs, **Then** the built-in fallback route is used, the command still runs, and the result shows `routeSource: "fallback"` and `modelVerified: false`.

---

### User Story 2 - Any catalog model can be chosen and is checked first (Priority: P2)

A user passes `--model <id-or-alias>`, or pins a role through an environment variable. The companion accepts any listed ID or alias of the right kind. It rejects wrong-kind or unlisted models before any billed request.

**Why this priority**: "Work with all models" means every catalog model can be selected, not only the routed ones.

**Independent Test**: Use a fixture catalog and a fetch stub that counts generation requests. Try a valid ID, a valid alias, an unknown ID and a wrong-kind ID, through both `--model` and an env pin.

**Acceptance Scenarios**:

1. **Given** the listed alias `grok-4.20-multi-agent`, **When** the user runs `ask --model grok-4.20-multi-agent`, **Then** the request is sent with that model.
2. **Given** an ID not in a cached catalog, **When** the user passes it, **Then** the companion refetches the catalog once. If the ID is still absent, it exits with `capability_unavailable` (exit code 8) and sends no generation request. If the refetch fails, or a fetch failure is still inside the 5-minute window, the ID is used unchecked with `modelVerified: false` (xAI itself rejects unknown models unbilled). If the catalog was already fetched live in this invocation, it rejects without refetching.
3. **Given** an image model, **When** the user passes it to `ask`, **Then** the command exits with `usage` and sends no request.
4. **Given** the catalog for that kind is unavailable, **When** the user passes `--model`, **Then** the ID is used unchecked and the result shows `modelVerified: false`.
5. **Given** the pin `GROK_COMPANION_MODEL_STRONG` set to an unlisted ID while the catalog is fresh, **When** a strong-role command runs, **Then** it is rejected the same way as an invalid `--model`.

---

### User Story 3 - Setup shows the live catalog and resolved routes (Priority: P3)

A user runs `setup`. It fetches the catalog live, bypassing the cache, and reports each model with its listed prices, and each role's resolved route.

**Why this priority**: The user can see what will run, and at what listed price, before spending.

**Independent Test**: Run `setup` against fixture catalogs and stubbed failures, and compare with the expected JSON shape.

**Acceptance Scenarios**:

1. **Given** a valid key, **When** the user runs `setup`, **Then** `models` lists each entry (`id`, `kind`, `aliases`, `inputModalities`, `outputModalities`, `prices`), and `routes` lists each role (`model`, `routeSource`, `modelVerified`, `priceChanged`). `apiReachable` reflects whether the catalog requests succeeded.
2. **Given** no key, **When** the user runs `setup`, **Then** behavior is unchanged: `keyPresent: false`, exit code 2, no network request.

### Edge Cases

- One catalog kind fails while the others succeed: availability is tracked per kind. Only the failed kind uses cache or fallback.
- A fetched catalog has no eligible model for a role: the role uses its fallback ID only if that ID is listed. Otherwise the command exits with `capability_unavailable` and asks the user for `--model`.
- A language model has no listed `completion_text_token_price`: it is not eligible for automatic routing, but can still be selected explicitly. Image and video models rank by `created`, so a missing price does not affect their eligibility.
- The cache is malformed, has a different key fingerprint, or holds invalid IDs: it is ignored.
- A cache is older than 24 hours: it is refetched. If the refetch fails, a cache up to 7 days old is used with `routeSource: "cache-stale"`. Older caches are ignored.
- Two eligible models share a `created` time: the greatest ID wins, by numeric-aware comparison (`localeCompare` with `numeric: true`), so `grok-4.10` ranks above `grok-4.9`.
- A catalog fetch fails: the failure is remembered for 5 minutes, so later commands don't wait on the timeout again.
- A catalog response redirects or exceeds 1 MB: it is rejected as a discovery failure.
- The cache write fails, for example on a read-only home folder: the command continues.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The companion MUST read the catalog from `GET /v1/language-models`, `/v1/image-generation-models` and `/v1/video-generation-models` on the existing fixed host. These are read-only requests with a 5-second timeout each, run in parallel. Responses are rejected on redirect and above 1 MB.
- **FR-002**: The companion MUST cache only validated, normalized fields at `<home>/.grok-companion/models.json`. `<home>` is injectable for tests. The cache records a 12-hex-character SHA-256 prefix of the key, never the key, and is written atomically through a temp-file rename. Cached IDs MUST match `^[a-z0-9][a-z0-9.-]{0,63}$`. Freshness and stale limits are as listed in Edge Cases.
- **FR-003**: Each role MUST resolve from the eligible models of its kind:
  - Eligible language models output text, advertise `capabilities.reasoning_effort` and have a listed `completion_text_token_price`.
  - `fast` (ask, review, transfer): the lowest-priced eligible models, newest `created` first.
  - `strong` (`ask --live`, adversarial-review, rescue): the newest eligible model by `created`, at any price.
  - `coding` (`rescue --coding`): the target of `grok-build-latest` when it is listed. Otherwise, the `strong` route.
  - `image` and `video`: the newest listed model of that kind whose ID does not end in `-lite`. `-lite` models are excluded from automatic routing as a product preference, but can still be selected explicitly. Today this gives `grok-imagine-image-2.0` and `grok-imagine-video-1.5`.
  - The `reasoning_effort` filter and newest-first ranking are routing policy. They are not claims about model quality.
- **FR-004**: Routing MUST NOT apply a price limit (maintainer decision, 2026-11-21: always use the newest model). `priceChanged` compares the resolved model's listed price with the fixed 2026-11-21 baseline for its role: `completion_text_token_price` 25000 for fast, 60000 for strong and coding; `image_price` 600000000 for image. This applies to routed, `--model` and env-pinned models alike.
  - `true` when the price differs, higher or lower.
  - `false` when it is equal.
  - `null` when there is no listed price to compare. This covers video, an image entry with no `image_price`, `routeSource: "fallback"` and `modelVerified: false`.
  - The baseline is static by design: once xAI moves a price, the flag stays `true` until the baseline table is updated in a later release. Input prices and the image per-quality `pricing` list are not compared.
- **FR-005**: The output MUST include `model`, `routeSource` (`flag`, `env`, `live`, `cache`, `cache-stale` or `fallback`), `modelVerified` and `priceChanged` on every path:
  - JSON delegation result: as fields.
  - `--live`: on a metadata line outside the `[UNTRUSTED-EXTERNAL-CONTENT]` envelope, after `Usage:`.
  - imagine: added to the download or base64 result object.
  - video: in the submission and `--wait` objects. They are also saved in the job's `request` object (`jobs.createJob` takes `kind` and `request`), so `status` and `result` show them. The model is resolved before `createJob`.
  - `fallbackApplied` is removed. `routeSource` replaces it.
- **FR-006**: `--model` and env pins (`GROK_COMPANION_MODEL_FAST`, `_STRONG`, `_CODING`, `_IMAGE`, `_VIDEO`) MUST be checked per US2. Order of precedence: `--model`, then the env pin, then the role route.
- **FR-007**: Fallback IDs MUST live in one table in `scripts/lib/models.mjs`. 2026-11-21 values: fast `grok-4.3`, strong `grok-4.7`, coding `grok-4.5`, image `grok-imagine-image-2.0`, video `grok-imagine-video-1.5`.
- **FR-008**: `setup` MUST fetch live, bypassing the cache, and report per US3.
- **FR-009**: `--build-unavailable` MUST keep parsing as a no-op.
- **FR-010**: The video cost line MUST include the model, and MUST state that `$0.08/second` is an unverified estimate.
- **FR-011**: `skills/grok-prompting/SKILL.md`, the README and command hints MUST describe roles and the always-newest policy, not fixed IDs.
- **FR-012**: Existing safety behavior MUST stay unchanged: key only from `XAI_API_KEY`, the fixed host, output scrubbing, the untrusted-content envelope, the long-context gate and the media host allowlist. Rejecting redirects is added for catalog requests only.

### Key Entities

- **Catalog entry**: `id`, `kind`, `aliases`, `created`, `inputModalities`, `outputModalities`, `prices` (raw xAI integer fields), `capabilities`.
- **Catalog state per kind**: `available`, `source`, `fetchedAt`, `failedAt`.
- **Route**: `role`, `model`, `routeSource`, `modelVerified`, `priceChanged`.

## Success Criteria *(mandatory)*

- **SC-001**: With the 2026-11-21 fixture, the five roles resolve to the FR-007 values, and the coding route needs no flag.
- **SC-002**: A newer flagship, same-price or pricier, changes the strong route with no source edit. A pricier one also sets `priceChanged: true`.
- **SC-003**: Invalid `--model` values and invalid env pins send zero generation requests, as counted by the fetch stub.
- **SC-004**: With a warm cache (all three kinds fetched under 24 hours ago), a delegation command makes no catalog request. With a cold cache, it makes at most 3, plus at most 3 more for one refetch before rejecting an unlisted ID.
- **SC-005**: The existing suite passes from the repository root. No test reads or writes the real home folder: the test harness injects a temp `home`, and `loadCatalog` treats a missing request function as a discovery failure.
- **SC-006**: Routing code (`scripts/grok-companion.mjs`, `scripts/lib/media.mjs`) contains no model ID literals. IDs appear only in `FALLBACK_ROUTES`, in the `grok-build-latest` alias constant, in fixtures and in docs.

## Assumptions

- Catalog endpoints and fields stay as observed on 2026-11-21. Prices are xAI integer units, reported raw, not as a cost guarantee.
- Catalog listing does not prove a model works with a given request shape. Live compatibility of routed models is checked by the capped paid smoke test T019.
- Scope: the root Claude Code plugin only (`scripts/`, `skills/`, `commands/`, `prompts/`, `tests/`, README). Follow-up notes for the `codex/` copy go in a GitHub issue. `codex/scripts/grok-companion.mjs:66-73` has the same dead `grok-build-0.1` route, which is noted for a follow-up feature.
- Not included: the `tests/` working-directory packaging failure, changes to `codex/` code, version bump and release.
