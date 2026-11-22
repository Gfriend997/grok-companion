# Spec 003: Image edits and image-input routing (parity step 2)

Revision: 1 (2026-11-22). Status: APPROVED rev 1 (Gary, chat, 2026-11-22: "Approve full flow"). No live test.
Source: step 2 of the parity plan in spec 002, which Gary approved. codex-plugin is the reference implementation.

## Problem

`imagine --source <image>` exists in claude-source, but it sends the sources as `images: [<data URL>]` to `/images/generations`. codex-plugin sends edits to `/images/edits`, using `{ image: { url } }` for one source or `images: [{ type: "image_url", url }]` for two or three. claude-source has three further gaps compared with codex-plugin:

- Routing ignores image input. An image source, or an image attached to `ask`, `review` or `rescue`, can be routed to a model that does not accept images.
- A base64 image result is printed to stdout as raw `b64`. codex-plugin checks its file signature and saves it locally.
- More than 3 sources is caught only inside the media layer, after routing.

## Requirements

- **R1 Edit endpoint.** With 1 to 3 `--source` images, `imagine` posts to `/images/edits` in codex-plugin's body shape. With no source, it still posts to `/images/generations`.
- **R2 Image-input routing.** `selectModel` and `resolveRole` take `needsImageInput`, as in codex-plugin. It is true for `imagine` with sources, for `video --from-image`, and for text commands with an image attachment. Role routing then considers only models whose catalog entry lists image input. An explicit `--model` or env pin without image input exits 9 before any billed request.
- **R3 Save base64 results.** Base64 image results go through `saveBase64`: file-signature check, byte limit, and an existing file is never overwritten. The command returns the saved path, not raw base64.
- **R4 Early limit.** More than 3 sources is a usage error before routing.
- **R5 Docs and version.** Update `commands/imagine.md` and the README. Bump the version from 0.1.2 to 0.1.3.

## Exclusions

Speech, `--confirm-cost` and `--max-tokens` (parity steps 3 and 4). No change to the video job lifecycle, the Claude hooks or the slash commands other than `imagine.md`.

## Acceptance criteria

- Port the relevant codex-plugin tests (`media.test.mjs`, `media-routing.test.mjs`, the image cases in `media-safety.test.mjs`) and adapt them where claude-source's modules differ. They fail before the change and pass after it.
- All existing claude-source tests still pass, and `hooks/hooks.json` parses.
- Live check (optional, paid): one `imagine` edit with one PNG source, run only with Gary's separate go-ahead and cost approval.
- Commit, open a PR, merge to `main`, and update the installed plugin to 0.1.3.

## Tasks

- T1. Port and adapt the tests first, and confirm they fail.
- T2. `media.mjs`: edit endpoint and body shape, plus `saveBase64`.
- T3. `models.mjs`: `acceptsImage` and `needsImageInput` in `resolveRole`.
- T4. `grok-companion.mjs`: pass `needsImageInput` from imagine, video and text attachments; add the early source limit; save base64 results.
- T5. Docs and version.
- T6. Run the tests and the JSON check.
- T7. Commit, PR, merge, and update the plugin.

REA: not applicable. This ports existing, reviewed behaviour from codex-plugin.

## Results (2026-11-22)

- T1: added `tests/image-edits.test.mjs`, with 6 tests adapted from codex-plugin. They failed before the change (0 pass, 5 fail).
- T2 to T4: done. Only the image-input filter (codex-plugin D3) was ported from codex `models.mjs`. Codex-only routing rules (D1 strong by price tier, D4, D6, D7) were not ported. Claude routing semantics are unchanged.
- Changed behaviour: `tests/cli.test.mjs` now expects a saved path instead of raw `b64` (R3), and its harness gained a `saveBase64` stub.
- T5: updated `commands/imagine.md` and the README; version is now 0.1.3.
- T6: `node --test` passes 148 of 148, and the JSON files parse.
- No live test, as approved.
- Review (Sonnet 5.5 subagent): no correctness bugs found. Changes made in response:
  - `saveBase64` now retries with the next free name on `EEXIST`, so a billed image is not lost when concurrent runs use the same `--out`. Added a test.
  - Added tests for `video --from-image` routing and for image attachments on text commands.
- Known limits, accepted and not changed:
  - When the catalog cannot be verified, an explicit `--model` is used unverified and the image-input check is skipped. The xAI API then rejects an unsupported input server-side. The R2 pre-billing exit applies only when the catalog is verified.
  - The image-input filter relies on the catalog's `input_modalities`. The 2026-11-21 fixture captured from the live catalog lists it for every kind. If xAI drops the field, image-source routing fails with `capability_unavailable`.
  - `--out` keeps only its base name, the same as `downloadArtifact`.
