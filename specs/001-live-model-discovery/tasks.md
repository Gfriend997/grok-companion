# Tasks: Live model discovery and routing

**Input**: [spec.md](spec.md) revision 4, [plan.md](plan.md) revision 4, [research.md](research.md)

**Status**: Derived from plan revision 4. Implemented; see the checkboxes.

## Phase 1: Setup

- [x] T001 Record the baseline: run `node --test tests/` from the root, and record the result in `research.md`.
- [x] T002 [P] Add the fixture `tests/fixtures/catalog-2026-11-21.json` (IDs, aliases, created, modalities, capabilities, prices).

## Phase 2: Foundational

- [x] T003 Add the `redirect` and `maxBytes` options to `requestAuthenticated` in `scripts/lib/api.mjs`, with tests (FR-001, FR-012).
- [x] T004 Create `scripts/lib/models.mjs` with constants, `fetchCatalog` and `normalize` (FR-001, FR-007).
- [x] T005 Add `loadCatalog`: the cache, freshness and stale limits, fingerprint, ID validation, atomic write, negative cache and injectable `home` (FR-002).

## Phase 3: User Story 1 (P1)

- [x] T006 [US1] Write the `resolveRole` and `priceChanged` tests in `tests/models.test.mjs`.
- [x] T007 [US1] Implement `resolveRole` and `priceChanged` (FR-003, FR-004).
- [x] T008 [US1] Make `selectModel` role-based in `scripts/grok-companion.mjs`, and add the output metadata on every path, including the video job record (FR-005). Remove `fallbackApplied`. Keep `--build-unavailable` as a no-op (FR-009). Apply the FR-010 cost line.
- [x] T009 [US1] Remove the default model IDs from `scripts/lib/media.mjs`. Update `tests/media.test.mjs`, `tests/cli.test.mjs` and `tests/api.test.mjs`.

## Phase 4: User Story 2 (P2)

- [x] T010 [US2] Write tests for `findModel`, the env pins, refetch-before-reject, and zero generation requests on rejection (SC-003, SC-004).
- [x] T011 [US2] Implement `findModel` and the `--model` and pin checks (FR-006).

## Phase 5: User Story 3 (P3)

- [x] T012 [US3] Write the `setup` tests: with a key, without a key, and with a failing catalog.
- [x] T013 [US3] Implement the `setup` live catalog, `routes` and `apiReachable` (FR-008).

## Phase 6: Docs and convergence

- [x] T014 [P] Update `skills/grok-prompting/SKILL.md` to describe roles and the always-newest policy (FR-011).
- [x] T015 [P] Update the README routing and setup sections, and the `commands/*.md` hints (FR-011).
- [x] T016 Check SC-006 by searching the routing code for ID literals.
- [x] T017 Run the full suite from the root, and confirm no test touched the real home folder (SC-005).
- [x] T018 Run `setup` live, using read-only catalog calls only. Record the resolved routes.
- [~] T019 (partial: text done, live skipped) **Paid, with a $0.25 total cap.** Use a small bounded script, not the CLI:
  1. Resolve the routes with the new code, so the models tested are the ones actually routed, not hardcoded.
  2. Send one `/chat/completions` request each for `fast`, `strong` and `coding`, with prompt "Reply OK", `max_tokens: 32` and `reasoning_effort: "low"`.
  3. Before each request, compute a worst-case cost: prompt tokens times the listed prompt price, plus 32 times the listed completion price. Skip the request if the reported spend so far plus that worst case would pass $0.25.
  4. Then send one live-search `/responses` request on the routed `strong` model, with `max_output_tokens: 128`, `reasoning_effort: "low"` and a tool-call limit. First check the current xAI docs for a supported tool-call limit and its per-call search price. If no limit exists, or the worst case can't be bounded under the remaining budget, skip the live request and report why.
  5. No image or video requests. Record each request's `usage` cost and the total.
- [x] T020 Get an independent review of the finished diff, fix the findings, and record convergence.

- [ ] T021 Commit on a feature branch, and push to `Gfriend997/grok-companion`.
- [ ] T022 Write the follow-up notes for the `codex/` copy: what needs fixing, with file:line references. Post them as a GitHub issue on `Gfriend997/grok-companion`.

Out of scope: changing `codex/` code, the `tests/` working-directory fix, version bump and release.
