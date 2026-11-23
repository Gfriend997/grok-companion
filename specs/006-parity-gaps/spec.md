# Spec 006: Remaining parity gaps (parity step 5)

Revision: 2 (2026-11-22). Status: APPROVED rev 2. Gary approved it on 2026-11-22 ("approve and let's get this done"), which authorizes T1 to T10 and T12. The paid live check (T11) still needs its own go-ahead. Decisions D1 to D13 are settled (see "Decisions").
Source: spec 005 decision D12 ("Record them here and plan spec 006"), and D16 ("Staged changes wait for spec 006"). codex-plugin is the reference.
"GP n" below means Grok Companion principle n in `.specify/memory/constitution.md`. Paths without a prefix are in claude-source. `docs/verification.md` and `docs/cli-migration.md` are in the workspace folder above both plugins.

Changes from rev 1: Q1 to Q11 are settled as D1 to D11.
- `result` prints the stored path and never downloads again (D4). Rev 1 recommended a new download when the file is missing.
- codex-plugin's routing rules are ported in this spec (D9). This adds R17. Rev 1 recommended keeping claude-source's rules.
- `scripts/probe.mjs` is removed (D11). This adds R18. Rev 1 recommended leaving it.
- The locked job update is ported in full (D7). R11 now says what a background worker does when the lock is busy, so a paid answer is not lost.
- All six new gaps stay in this spec (D8).
- The live check gains an unbilled routing step (D10).

## Problem

Spec 005 listed six parity gaps and one billing fault that it did not fix, and its Results section left one Gemini review point open. Each was checked again against the code on `main` (version 0.1.5). All eight are still open. Reading the code for them found more gaps, two of which are security or paid-loss faults.

Still open from spec 005:

1. **`video --from-image <local path>` sends the path as text (GP 3).** `commandVideo` passes the flag value unchanged (`scripts/grok-companion.mjs:324`), and `createVideoJob` sends `image: "<path>"` (`scripts/lib/media.mjs:230`). No file is read. codex-plugin encodes the file and sends `{ image: { url } }` (`codex-plugin/scripts/grok-companion.mjs:191-196`, `codex-plugin/scripts/lib/media.mjs:186`).
2. **`result` downloads the video again on every call.** It adds `artifactPath` to the printed job but never stores it (`scripts/grok-companion.mjs:470-473`). codex-plugin stores it (`codex-plugin/scripts/grok-companion.mjs:298-302`).
3. **The long-context check ignores the prompt.** Only attachments are counted (`scripts/grok-companion.mjs:184`). codex-plugin adds the prompt length (`codex-plugin/scripts/grok-companion.mjs:156`).
4. **A bare `review`, and the stop-review gate, miss staged changes.** Both read `git diff` (`scripts/grok-companion.mjs:68`, `scripts/stop-review-gate-hook.mjs:25-26`). codex-plugin reads `git diff HEAD` (`codex-plugin/scripts/grok-companion.mjs:23`).
5. **`generateImage` and `createVideoJob` accept a missing model** (`scripts/lib/media.mjs:173-177, 228-231`). codex-plugin rejects it before the request (`codex-plugin/scripts/lib/media.mjs:173, 184`).
6. **Citation fields strip fewer line-break characters** (`scripts/grok-companion.mjs:214`: CR, LF, U+2028, U+2029) than codex-plugin (`codex-plugin/scripts/grok-companion.mjs:133`: also VT, FF, U+001C to U+001E, U+0085).
7. **A bad `imagine --out` name is rejected after the billed generation.** `commandImagine` sends the request (`scripts/grok-companion.mjs:360`) and only then reaches the name check, through `saveBase64` (`scripts/lib/media.mjs:192`, `saveBytes` `:60`, `outputStem` `:48`). The paid image is lost. The URL path does not have the fault: `downloadArtifact` falls back to `grok-artifact` (`scripts/lib/media.mjs:279-282`).
8. **The secrets changed-line pattern misses phrases with a space** (`scripts/lib/risk.mjs:9`: `api[_-]?key`, `private[_-]?key`, `access[_-]?token`). Checked on 2026-11-22: an added line `// set the api key here`, `read access token from header` or `load private key` in `src/util.js` returns `risky: false`. The same check found that the paths `config/api_key.js`, `src/apiKey.js` and `src/private_key.js` also return `risky: false`, because path words are split at `_` and at case changes, and the stem is `apikey`.

Found while re-verifying, not recorded before:

9. **Image attachments skip the credential-path check (GP 3).** `toParts` runs the path check only for text files, and only on the path as typed (`scripts/lib/attach.mjs:110`). An image returns at `:116` with no check. Checked on 2026-11-22: `toParts` accepts `.env.png` and `credentials.png` that hold PNG bytes. This affects `--file` on the five text commands and `imagine --source` today, and would affect `--from-image`. README line 240 says credential paths "are refused as attachments". codex-plugin checks the given path and the real path for every attachment (`codex-plugin/scripts/lib/attach.mjs:98-99, 104-105`; test `codex-plugin/tests/regressions.test.mjs:83-90`).
10. **`video --wait` can lose a paid video.** One `try` wraps the submission, the polling and the download (`scripts/grok-companion.mjs:323-341`). If polling or the download fails after xAI accepted the job, the `catch` overwrites the provider job id with the text `submission_unknown` (`:339`). The video is billed and can never be fetched. codex-plugin has the same fault (`codex-plugin/scripts/grok-companion.mjs:200-218`); `docs/cli-migration.md:33` records it as kept.
11. **`cancel` and a late poll can overwrite a finished job.** `cancelJob` and `refresh` write without checking the stored state (`scripts/lib/jobs.mjs:51-55, 76-83, 97-107`). `cancel --id` on a `done` video job sets it to `abandoned`, and `result` then no longer downloads it. codex-plugin writes under a per-job lock and never overwrites a terminal state (`codex-plugin/scripts/lib/jobs.mjs:55-83, 104-110, 124-127`; tests `codex-plugin/tests/jobs.test.mjs:76-103`).
12. **`setup` exits 0 for a rejected key.** xAI answers an invalid key with HTTP 400 "Incorrect API key provided", which `api.mjs` classes as `usage`. `loadCatalog` stores that class (`scripts/lib/models.mjs:129`), and `setup` exits 2 only for class `auth` (`scripts/grok-companion.mjs:490`). codex-plugin maps the message to `auth` during discovery (`codex-plugin/scripts/lib/models.mjs:106-111, 152`; test `codex-plugin/tests/setup.test.mjs:99`).
13. **No `GROK_JOBS_DIR`.** codex-plugin lets it select the jobs folder (`codex-plugin/scripts/lib/jobs.mjs:35`, `codex-plugin/README.md:105`). claude-source always uses `~/.grok-companion/jobs` (`scripts/lib/jobs.mjs:35`).
14. **The test `harness` is exported from `tests/cli.test.mjs`** (spec 004 Results), so `node --test tests/` runs the CLI tests twice. codex-plugin keeps it in `codex-plugin/tests/support/harness.mjs`.

Added by D9 and D11:

15. **Routing rules differ.** claude-source's `strong` role takes the newest eligible model at any price (`scripts/lib/models.mjs:184`). codex-plugin takes the newest model in the highest price tier (`codex-plugin/scripts/lib/models.mjs:214-219`), reports `roleFallback` on coding routes (`:208, 212`; `codex-plugin/scripts/grok-companion.mjs:119-130`), and applies a light check to the alias target and the built-in fallback (`models.mjs:191-196, 223-226`). Spec 003 Results recorded that these rules "were not ported".
16. **`scripts/probe.mjs` makes billed calls with model ids written in the file** (`scripts/probe.mjs:57, 66, 77, 88, 117`: `grok-4.3`, `grok-4.6`, `grok-imagine-image-2.0`, `grok-imagine-video-1.5`). The ids go stale, and `grok-4.6` is no longer any role's route.

Checked and already fixed by spec 005, so dropped:

| Item | Verified at |
|---|---|
| `downloadArtifact` writes without `wx` (spec 004 found-not-fixed) | Fixed: `scripts/lib/media.mjs:282` saves through `saveBytes` (`:59-71`, flag `wx` at `:64`) |
| `--max-tokens` documented and ignored (spec 004 found-not-fixed) | Fixed: `scripts/grok-companion.mjs:204, 210, 220`; README lines 127-128 |
| `--max-sources` checked after the billed call | Fixed: `scripts/grok-companion.mjs:114-119` |
| `downloadArtifact` has no timeout | Fixed: `scripts/lib/media.mjs:242-248` |

## Requirements

Each requirement is one gap. R1 to R8 are the items spec 005 deferred. R9 to R14 are the gaps found in review (D8). R17 and R18 come from D9 and D11.

- **R1 `video --from-image` (GP 3, D2, D3).** Ported from `codex-plugin/scripts/grok-companion.mjs:191-197` and `codex-plugin/scripts/lib/media.mjs:186`.
  - **URL (D3).** A value that starts with `https://` (any letter case) is sent unchanged, on any host, as in codex-plugin. It first passes the existing secret preflight (`scripts/grok-companion.mjs:167-170`); codex-plugin does not check it (F2).
  - **Other schemes.** A value that matches `^[a-z][a-z0-9+.-]*://` and is not `https://` is a `usage` error (review fix: the pattern is `^[a-z][a-z0-9+.-]+://`, at least two characters, so `C://x.png` is a path): `--from-image takes a local JPEG or PNG path or an https:// URL`. codex-plugin reads `http://...` as a file name and reports "file not found" (F3).
  - **Local path.** Any other value is a file path. It goes through `deps.attach.toParts([value])`, the function `imagine --source` uses (`scripts/grok-companion.mjs:355`). The result must be exactly one part of type `image_url`; otherwise the error is `--from-image requires a JPEG or PNG image` (codex-plugin `:194`). The image input is that part's data URL, `data:image/png;base64,...` or `data:image/jpeg;base64,...` (`scripts/lib/attach.mjs:116`). No upload endpoint is used; codex-plugin has none.
  - **Checks, the same as `imagine --source`,** all done by `toParts` with R9 applied:
    - the credential-path check on the given path and on the real path (R9);
    - a regular file of at most 20 MiB (`scripts/lib/attach.mjs:5, 100-102`);
    - a JPEG or PNG signature read from the bytes, not from the extension (`:50-54`);
    - EXIF and PNG text chunks removed before encoding (`:56-88`);
    - a non-image file goes through the binary-document check and the secret-content preflight, and is then rejected as not an image.
  - **Request body.** `createVideoJob` sends `{ model, prompt, duration, image: { url } }` to `/videos/generations` (codex-plugin `media.mjs:186`). Without the flag the body has no `image` key, as today.
  - **Order (D2).** `--seconds` checks, the prompt preflight, the `--from-image` checks, the `--confirm-cost` gate, then the route. A bad image reports its own error with or without `--confirm-cost`, as a bad `--seconds` does (spec 005 R1). codex-plugin checks the image after the gate (`:190-196`).
  - **Routing.** `needsImageInput` is already set from the flag (`scripts/grok-companion.mjs:320`). No change.
  - **Job record.** Unchanged: `{ prompt, seconds, ...route }`. The data URL is never written to the job.
  - **Proof.** This changes the body of a billed request. Stub tests prove what is sent. Only a live call can prove that xAI accepts a data URL in `image.url` (T11). codex-plugin took the shape from xAI's documentation (`docs/verification.md:25, 31`) and never ran it live (`docs/cli-migration.md:35`).
- **R2 `result` stores the artifact path (D4).** After a successful download, `result` calls `deps.jobs.updateJob(job.id, { result: job.result })` (codex-plugin `:301`).
  - A later `result --id` prints the stored job with its `artifactPath` and downloads nothing, as in codex-plugin (`:298`). It does not check that the file still exists, and a later `--out` is ignored (D4).
  - `video --wait` stores the path the same way after its download (`scripts/grok-companion.mjs:330-331`). codex-plugin does not (`:207-208`), so a `result` after `--wait` downloads again there (F4).
  - This changes one result of spec 005's live check: a second `result --id --out <same name>` no longer saves a second file.
- **R3 Long-context check includes the prompt (GP 5).** In `prepareDelegation`, after the attachments are read and before the route: if `attachment.tokenEstimate + Math.ceil(prompt.length / 4)` is 200,000 or more and `--allow-long-context` is absent, the command is a `usage` error, `long context requires --allow-long-context`, with no request (codex-plugin `:156`).
  - It applies to all five text commands, to `--live` (prompt only), to a diff gathered by a bare `review`, and to the background worker, which runs the same function.
  - The existing attachment-only check (`scripts/grok-companion.mjs:184`) is removed; the new check covers it.
- **R4 `review` and the gate read staged changes (D1; spec 005 D16).**
  - One exported constant in `scripts/grok-companion.mjs` holds the diff arguments, `["diff", "HEAD"]`. (review fix) It is `["diff", "HEAD", "--"]`, so a ref name can never be read as a path; the hook runs `git diff --quiet HEAD --`. The diff text and its hash do not change. `gatherDiff` and the hook both use it, so they cannot disagree (spec 005 R10).
  - `gatherDiff`: `git diff HEAD`, then `git diff HEAD~1..HEAD` when that is empty, as today (codex-plugin `:21-32`). The 10 MB read limit, the 200 KB cut and the "diff too large" refusal do not change.
  - Hook: the change test becomes `git diff HEAD --quiet`, and the reviewed text becomes `git diff HEAD`. The risky rule, the hash and the `review` child process all use that one text. The Kimi hook already uses `git diff HEAD --quiet` (spec 005 differences table).
  - **Hash.** `gateLastDiff` stays one SHA-256 per repository root. `git diff HEAD` compares the working tree with the last commit, so its text does not change when a change is staged. Staging a diff that was already reviewed is therefore not billed again. With nothing staged, the text equals today's `git diff`, so hashes stored by 0.1.5 stay valid.
  - **Risky rule.** `riskyDiff` reads the same text. Its 400-line count and its path and line matches now cover staged changes and staged new files.
  - Untracked files are still not reviewed.
- **R5 Missing model.** `generateImage` and `createVideoJob` throw `usage` before any request when `model` is not a non-empty string: `image generation requires a model`, `video generation requires a model` (codex-plugin `media.mjs:173, 184`).
- **R6 Citation line breaks (GP 4).** `oneLine` replaces each run of `[\r\n\v\f\u001c-\u001e\u0085\u2028\u2029]` with one space (codex-plugin `:133, 174`).
  - (impl note) The source writes U+2028 and U+2029 as `\u{2028}\u{2029}` with the regex `u` flag. The pattern is the same.
- **R7 `imagine --out` is checked before the billed request (GP 5, D5).** `generateImage` takes `out` and `outDir` and calls the existing `prepareOut` (`scripts/lib/media.mjs:52-56`) before the request, as `synthesizeSpeech` does (`:201`). A bad name is `usage`, exit 9: `--out is not a valid file name`. An uncreatable media folder is `usage`: `media directory cannot be created`. Nothing is sent.
  - There is no fallback name for `imagine` (D5). `video --wait --out` and `result --out` keep spec 005's fallback to `grok-artifact`.
  - codex-plugin has the same fault in a worse form: it does not check the name at all, and a failed write after billing throws a raw file-system error (`codex-plugin/scripts/lib/media.mjs:40-52`) (F5).
- **R8 Secrets pattern (D6).** In `scripts/lib/risk.mjs`:
  - the changed-line pattern becomes `secret|api[\s_-]?key|private[\s_-]?key|access[\s_-]?token|credential`;
  - the `secrets` file patterns gain `/api[_-]?key/i` and `/private[_-]?key/i`, tested against the file name as the other file patterns are (`:58`).
  - The README table (lines 183-190) is updated to match.
- **R9 Credential-path check for every attachment (GP 3).** Ported from `codex-plugin/scripts/lib/attach.mjs:98-99, 104-105`. In `toParts`, for every path:
  1. the path as given is checked before any file-system call;
  2. after the regular-file check, the real path is checked.
  - A failure is `usage`: `attachment rejected: credential file paths are not allowed`, with no read and no request.
  - The real path comes from `fs.realpathSync.native`, not `fs.realpathSync` as in codex-plugin. Spec 004's review found that only the native form expands Windows 8.3 short names such as `CREDEN~1` (F6).
  - The later text-only check (`scripts/lib/attach.mjs:110`) stays, for its secret-content test.
- **R10 `video --wait` keeps the provider job id (GP 5).** The `submission_unknown` catch covers only the `createVideoJob` call. After `recordSubmission` stores the provider id, a failure in polling, in the download or in output is reported with its own class and exit code, and the job keeps its provider id and state. `status --id` and `result --id` can then fetch the video. Not ported: codex-plugin's wider catch (F7).
  - (review fix) The job line (`id`, `state: "submitted"`, `providerJobId` and the route) is printed right after the submission is stored, before any polling, also with `--wait`. If storing the provider id fails, the error message names that id.
- **R11 Locked job updates (GP 5, D7).** Ported in full from `codex-plugin/scripts/lib/jobs.mjs:51-83, 104-110, 124-127, 139`.
  - **Lock.** Every job write takes the per-job lock file `<id>.json.lock`: created with `wx`, holding the writer's pid, removed after the write. A lock whose pid no longer exists is taken over. A writer tries 100 times, 10 ms apart, then throws `job is busy; retry the local operation` (`:58-75`). (review fix) A lock is stale when it is older than 30 seconds, when its pid has ended, or when it holds no valid pid after a 1-second grace (a writer may sit between its open and its pid write). A taker renames the stale lock to a unique name, checks it again, and deletes it only if it is still stale; a lock that another taker replaced in the meantime is linked back. A failed pid write removes the new lock. A writer releases the lock only when it still holds its own pid.
  - **Conditions.** `updateJob(id, patch, { expectedState, unlessTerminal })` is exported in that form. With `expectedState`, the write happens only when the stored state matches. With `unlessTerminal`, it does not happen when the state is `done`, `failed`, `abandoned` or `submission_unknown`. In both cases the stored job is returned unchanged.
  - **Callers.** `refresh` and `cancelJob` use `unlessTerminal`, as in codex-plugin. The background worker's last write uses `expectedState: "running"` in place of its read-then-write (`scripts/grok-companion.mjs:264`). `cancelCommand` uses `unlessTerminal` (`:308`). This closes spec 005's accepted limit "Job updates are not locked".
  - `listJobs` already reads only `.json` files (`scripts/lib/jobs.mjs:94`), so lock, claim and answer files are not listed.
    - (impl note) An answer file is named `<id>.answer.json`, which ends in `.json`, so `listJobs` now also skips names ending in `.answer.json`. Without that, `status` would list the answer file as a job and fail to sort it.
  - **A busy lock in the background worker.** codex-plugin has no background worker, and its lock code does not wait beyond one second. The worker therefore does this, so that a paid answer is never dropped:
    1. A worker write that throws `job is busy` is tried again once per second, for up to 60 seconds. This repeats a local file-lock attempt only. No request to xAI is ever sent again (GP 5).
    2. If the first write (state `running` with the pid) still fails, the worker exits before it sends anything. (review fix) The first write uses `expectedState: "created"`. If a `cancel` landed after the claim, the job stays `abandoned` and the worker returns without sending.
    3. If the last write (the answer, or the error) still fails, the worker writes the same patch to `<jobs dir>/<id>.answer.json`, created with `wx`, mode `0o600`, through `scrubDeep`. (review fix) Any error on this last write leads to the answer file, except `job not found`; only `job is busy` is retried first. The first write keeps the busy-only rule.
    4. `status`, `status --id` and `result --id` look for an answer file when a text job is `running`. They first try `updateJob(id, patch, { expectedState: "running" })`. If that is busy too, they report the job with the patch merged in memory. Either way the answer is printed. The look-up runs before the 6-minute `submission_unknown` rule.
    5. An answer file for a job in any other state is ignored, so an abandoned job still discards its answer, as today.
  - `scripts/lib/jobs.mjs` gains `saveAnswer(id, patch)` and `readAnswer(id)`. The wait between tries is injectable (`deps.sleep`) so tests do not wait.
    - (impl note) Only a `job is busy` error is retried. A worker whose first write stays busy throws after 60 retries and exits; its error output goes nowhere, as for any worker error.
- **R12 `setup` reports a rejected key as `auth` (GP 1).** (review fix) The `setup` message reads `xAI rejected the API key (catalog request returned 400, 401 or 403)`. In `loadCatalog`, a failed catalog request of class `usage` whose message matches `/incorrect api key|invalid api key/i` is stored as `auth` (codex-plugin `models.mjs:106-111`). `setup` then exits 2 through its existing check (`scripts/grok-companion.mjs:490`). Other commands keep the `api.mjs` class.
- **R13 `GROK_JOBS_DIR`.** `createJobStore` uses `process.env.GROK_JOBS_DIR` when it is set, else `~/.grok-companion/jobs` (codex-plugin `jobs.mjs:35`). README documents it.
- **R14 Test harness file.** `harness` and `modelsFixture` move from `tests/cli.test.mjs` to a new `tests/support/harness.mjs`, as in codex-plugin (`codex-plugin/tests/support/harness.mjs`). The test files that import them change only that import. README line 254 gives `node tests/index.mjs` as the test command.
- **R15 Errors and exit codes.** No new error class or exit code. Every new refusal is `usage`, exit 9, before any billed request.
- **R16 Docs and version.** Update the README, the command files and the skills listed under "Files to touch". Bump the version from 0.1.5 to 0.1.6.
- **R17 Routing rules (GP 6, D9).** Ported from `codex-plugin/scripts/lib/models.mjs:191-229` and `codex-plugin/scripts/grok-companion.mjs:117-130`. codex-plugin decided these as D1, D4, D6 and D7 of its spec 002 (`codex-plugin/specs/002-live-model-discovery/decisions.md:14-24`).
  - **Strong by price tier.** For `strong`, the pool is the eligible language models after the image filter, newest first. The route is the newest model whose `completion_text_token_price` equals the highest price in the pool (`models.mjs:214-219`). Today claude-source takes the newest model at any price (`scripts/lib/models.mjs:184`). `fast` (cheapest tier, newest in it), `image` and `video` (newest non-`-lite`) do not change.
  - **Coding.** The target of the `grok-build-latest` alias is used when it passes the light check, and its route carries `roleFallback: null`. Otherwise `resolveRole` returns `{ defer: "strong" }` (`models.mjs:210-213`). `selectModel` then resolves the strong role with its own precedence, so the `GROK_COMPANION_MODEL_STRONG` pin applies, and it reports `roleFallback: "strong"` (`grok-companion.mjs:124-126`). Today the pin is ignored on this path (`scripts/lib/models.mjs:178`).
  - **Light check.** A model passes when it is of the right kind, outputs text if it is a language model, and accepts image input when the request carries an image (`models.mjs:191-196`). It applies to the alias target, and to the built-in fallback id that is used when no model is eligible (`:223-226`). The alias target stays exempt from the price and `reasoning_effort` rules.
  - **Offline coding.** With the language catalog unavailable, coding uses the built-in `grok-4.5`, unverified, with `roleFallback: null`. It never consults the strong pin (`models.mjs:205-209`).
  - **Output.** `routeMeta` carries `roleFallback` when the route has it (`grok-companion.mjs:129-130`). A coding route from `--model` or from `GROK_COMPANION_MODEL_CODING` reports `roleFallback: null` (`:120`). The field therefore appears only on `rescue --coding`: in its JSON result, in its background job line and stored route, and in `setup` under `routes.coding`. No other command's output changes.
  - **Not ported.** `resolveWithDefer` and `resolveLiveRoutes` (`models.mjs:231-249`) serve only codex-plugin's probe, which D11 removes here. The single per-kind refetch, the trimmed env pin and the `setup` report shape are separate from D9 and stay as they are (see "Parity status").
  - **Models picked today.** Both rule sets were run on `tests/fixtures/catalog-2026-11-21.json` on 2026-11-22. That catalog has 12 models: 7 language, 3 image and 2 video. No role changes its model today:

    | Role | Commands | 0.1.5 rule picks | New rule picks | Completion price (xAI units) |
    |---|---|---|---|---|
    | `fast` | `ask`, `review`, `transfer`, the gate's review | `grok-4.3` | `grok-4.3` | 25,000 |
    | `strong` | `ask --live`, `adversarial-review`, `rescue` | `grok-4.7` | `grok-4.7` | 60,000 |
    | `coding` | `rescue --coding` | `grok-4.5` | `grok-4.5`, `roleFallback: null` | 60,000 |
    | `image` | `imagine` | `grok-imagine-image-2.0` | `grok-imagine-image-2.0` | n/a |
    | `video` | `video` | `grok-imagine-video-1.5` | `grok-imagine-video-1.5` | n/a |

    - The same picks hold with an image input.
    - `grok-4.7`, `grok-4.6` and `grok-4.5` share the top tier (60,000), and `grok-4.7` is the newest, so both rules agree. The three `grok-4.20` models list no `reasoning_effort` and are not eligible under either rule.
    - Live evidence: codex-plugin's routes on 2026-11-22 were fast `grok-4.3`, strong `grok-4.7`, coding `grok-4.5` (`codex-plugin/specs/002-live-model-discovery/decisions.md:221`), and spec 005's live check ran video on `grok-imagine-video-1.5`.
  - **When the rules differ.** Only when the newest eligible language model is not in the highest price tier. Example: xAI releases a newer model at 25,000. The 0.1.5 rule would move `strong` to it. The new rule keeps `strong` on `grok-4.7`. A newer model at a higher price takes `strong` under both rules.
- **R18 Remove the developer probe (GP 5, GP 6, D11).** `scripts/probe.mjs` is deleted.
  - References, checked on 2026-11-22. No test, manifest, command, skill, hook or script imports or runs it.
  - README lines 263-264 and 308 name `docs/PROBE_REPORT.md`, not the script. The Testing paragraph is reworded: the fixtures are fixed captures (2026-08-13, and the catalog of 2026-11-21), and this repository no longer holds a script that refreshes them.
  - `docs/PROBE_REPORT.md` is the only document that describes how the fixtures were captured. It stays as the record and gains one line at the top: the probe script was removed in 0.1.6 (spec 006, D11), and the fixtures are no longer refreshed from this repository.
  - `docs/specs/2026-08-13-grok-companion-design.md`, `docs/superpowers/plans/2026-08-13-grok-companion-implementation.md` and specs 001 and 005 mention the probe as history. They are not changed.
  - `tests/fixtures/` is kept unchanged.
  - `claude-source/codex/scripts/probe.mjs` is in the packaged Codex copy, which every parity spec has excluded. It stays (D12).

## Differences from codex-plugin and how this spec handles them

| Topic | codex-plugin | claude-source today | This spec |
|---|---|---|---|
| Local `--from-image` | Encoded by `toParts`, sent as `{ image: { url } }` (`grok-companion.mjs:191-196`, `media.mjs:186`) | Path sent as a string (`grok-companion.mjs:324`, `media.mjs:230`) | R1 |
| `--from-image` check order | After the cost gate (`:190-196`) | No check | R1: before the gate (D2) |
| `--from-image` URL | Any `https://` value, unchecked (`:192`) | Any value, unchecked | R1: any `https://` after the preflight; other schemes rejected (D3) |
| Stored `artifactPath` | `result` stores it (`:301`); `video --wait` does not (`:207-208`) | Neither stores it | R2: both; never downloaded again (D4) |
| Long context | Attachments plus prompt (`:156`) | Attachments only (`:184`) | R3 |
| Review diff | `git diff HEAD` (`:23`) | `git diff` (`:68`) | R4 (D1) |
| Gate diff | No gate | `git diff` (`stop-review-gate-hook.mjs:25-26`) | R4: the same text as `review` |
| Missing model | Rejected (`media.mjs:173, 184`) | Sent as `undefined` | R5 |
| Citation line breaks | Ten characters (`:133`) | Four (`:214`) | R6 |
| Bad `--out` on `imagine` | Not checked; raw error after billing (`media.mjs:40-52`) | Checked after billing (`media.mjs:192`) | R7: before the request (D5) |
| Credential path on attachments | Given and real path, every file (`attach.mjs:98-99, 104-105`) | Given path, text files only (`attach.mjs:110`) | R9, with the native real path |
| Failure after `video --wait` submits | Provider id overwritten (`:215-218`) | Same (`:338-341`) | R10: id kept |
| Job writes | Locked; terminal states kept (`jobs.mjs:55-83`) | Unlocked; overwritten (`jobs.mjs:51-55`) | R11 (D7) |
| Busy lock in a text worker | No text worker | No lock | R11: local retry, then an answer file |
| Invalid key in `setup` | Classed `auth`, exit 2 (`models.mjs:106-111`) | Classed `usage`, exit 0 | R12 |
| Jobs folder | `GROK_JOBS_DIR` (`jobs.mjs:35`) | Fixed | R13 |
| Strong route | Newest in the highest price tier (`models.mjs:214-219`) | Newest at any price (`models.mjs:184`) | R17 (D9) |
| Coding without the alias | Defers to strong through `selectModel`; `roleFallback: "strong"` (`grok-companion.mjs:124-126`) | Strong route, pin ignored, not reported (`models.mjs:178`) | R17 |
| Light check | Alias target and built-in fallback (`models.mjs:191-196`) | Image filter only (`models.mjs:178, 187`) | R17 |
| Developer probe | Resolves live routes, stops before spending (`probe.mjs`) | Fixed model ids, billed (`scripts/probe.mjs:57-117`) | R18: removed (D11) |
| Risk rule | None | `risk.mjs` | R8 (claude-source only) |

## codex-plugin behaviour flagged, not copied as is

- **F1 The cost is approved before the image is checked (GP 5).** codex-plugin reads `--from-image` only after `--confirm-cost` (`:190-196`). In claude-source's two-step flow the user would be asked to approve a cost for a command that then fails. Handled by R1 (D2).
- **F2 A URL value is not checked for secrets (GP 3).** `:192` sends any `https://` value with no preflight. A signed URL can carry a token. Handled by R1.
- **F3 `http://` is read as a file name.** The error is "file not found: http://...". Handled by R1.
- **F4 `video --wait` does not store the artifact path** (`:207-208`), so the next `result` downloads the video again. Handled by R2.
- **F5 `--out` is not checked before a billed image** (`media.mjs:40-52`). Handled by R7.
- **F6 The credential check uses `fs.realpathSync`** (`attach.mjs:104`), which does not expand Windows short names (GP 9). Handled by R9.
- **F7 A failure after a successful video submission destroys the provider job id (GP 5).** `:215-218`; recorded and kept in `docs/cli-migration.md:33`. Handled by R10.
- **F8 The credential pattern matches any part of the real path** (`scrub.mjs:10`: `id_rsa`, `credentials`, `.pem`, `.env*`). With R9, a file under a folder such as `credentials-api/` is refused whatever its name. This is codex-plugin's behaviour and is already the rule for audio files (`scripts/lib/media.mjs:129-134`). Kept; see "Accepted limits".
- **F9 `git diff HEAD` shows nothing when a staged change was undone in the working tree.** The index then holds a change that the next commit would include, and neither plugin reviews it. Kept (D1); see "Accepted limits".
- **F10 The lock gives up after one second** (`jobs.mjs:58-75`), and a stale lock whose pid was reused by a live process is never taken over. In codex-plugin this fails a video status write, which can be repeated. In claude-source it would drop a paid background answer. Handled by R11: the worker repeats the local lock attempt and then writes an answer file.
- **F11 `result` returns a stored path without checking the file** (`:298`). A moved or deleted video gives a dead path and is not fetched again. Kept (D4); see "Accepted limits".

## Cost

Nothing in this spec adds a billed command. Four changes alter what existing billed requests carry, which model answers them, or how often they run.

- **Image-to-video.** The estimate stays `seconds × $0.08`. Spec 005's live check measured exactly $0.08 for a 1-second text-to-video on `grok-imagine-video-1.5` (`usageTicks` 800,000,000). xAI's documentation says input images add charges (`docs/verification.md:27`), so an image-to-video job may cost more than the estimate. The real cost is in `usageTicks` after the job is done. Today the same command is billed, or rejected, with a path string that xAI cannot use.
- **Routing (R17), per command.**
  - `ask`, `review`, `transfer` and the gate's review (fast): no change, now or later. The fast rule is not touched.
  - `ask --live`, `adversarial-review`, `rescue` (strong): no change today; the model stays `grok-4.7` at the same price. Later, the new rule never picks a cheaper model than the 0.1.5 rule, and it picks a dearer one when xAI releases a newer model below the top tier. With today's prices that gap is 60,000 against 25,000 per completion unit, 2.4 times. Reference: one 32-token `rescue` on `grok-4.7` cost $0.00549 and one on `grok-4.3` cost $0.00042 (`codex-plugin/specs/002-live-model-discovery/decisions.md:229-230`); one live search cost $0.0813 (`:183`).
  - `rescue --coding`: no change today (`grok-4.5`). If xAI removes the `grok-build-latest` alias, the command uses the strong route as it does now, but a `GROK_COMPANION_MODEL_STRONG` pin then decides the model and its price.
  - `imagine`, `video`, `speak`, `transcribe`: no change.
  - The no-price-limit policy of spec 001 still holds: a newer, pricier model takes `strong`, `image` and `video` with no approval step. `priceChanged` reports it after the call.
- **Stop-review gate.** The gate still bills at most once per distinct diff and once per stop sequence, only for a large or risky diff, and only in a repository on the gate list. Two changes can add reviews:
  - staged changes and staged new files now count, so more diffs reach 400 lines or match a category (R4);
  - the wider secrets pattern matches more lines and file names (R8), including documentation that says "API key".
  - One review is one `review` request on the fast role with a diff of up to 200 KB (about 50,000 input tokens). It was not priced for this spec or for spec 005.
- **`review`.** A bare `review` now sends staged changes too. The 200 KB cut still bounds the request.
- **Saved money.** R2 removes a repeated download, which is not billed. R7 and R10 stop the loss of an image or video that was already paid for. R11 stops the loss of a paid background answer to a busy lock. R3 refuses a request above 200,000 estimated tokens, which xAI bills at about double. R18 removes a script that could bill on fixed model ids.
- The refusals, the checks and `setup` cost nothing.

Live check: about $0.09 at the dated rates, and up to about $0.011 more only if a route has changed by then. See T11 and D10.

## Exclusions

- An upload endpoint for image input. codex-plugin sends a data URL.
- Review of untracked files, by `review` or the gate.
- A pre-check of `--out` on `video` and `result`, and a fallback name for `imagine` (D5).
- A new download when a stored artifact file is missing, and a second copy through a later `--out` (D4).
- A cost gate on `imagine`, `speak` or `transcribe`, and a higher estimate for image-to-video.
- A price limit or an approval step when a route moves to a pricier model.
- A replacement for the probe, and a fixture-refresh tool (D11).
- codex-plugin's 4096-token default (spec 005 D5), its JSON cost line (D2 there), its full-path `--out` (spec 004 D3), its `setup` report shape, its single per-kind refetch and trimmed env pin, and its transport options that spec 004 left out (the external cancel signal, the 64 KiB cap on error bodies, the abort race around body reads).
- `claude-source/codex/` (the packaged Codex copy, D12), codex-plugin itself, and the Kimi and Gemini companions. No backport.

## Acceptance criteria and test plan

Unit tests with stubs only. No automated test makes a network call or a paid request. Tests that start a real process remove `XAI_API_KEY` from its environment.

- **New file `tests/parity-gaps.test.mjs`**, imported from `tests/index.mjs`. Tests 1 to 3, 6, 7, 15 and 19 to 21 use the `harness`. Tests 4, 5, 10, 12 and 14 call `createMedia` or `toParts` with files in a temporary folder. Tests 8 and 9 use a temporary git repository and a temporary home.
  1. `video scene --seconds 2 --confirm-cost --from-image C:/photo.png`, with `toParts` stubbed to return one image part: exit 0; `toParts` received `["C:/photo.png"]`; `createVideoJob` received `fromImage: "data:image/png;base64,AAAA"`. From `codex-plugin/tests/cli.test.mjs:177-181`. Proves R1.
  2. A `toParts` that returns a text part, and one that throws `usage` (missing file, over 20 MiB, credential path): each exits 9 with zero media calls, zero catalog calls and zero job records, with and without `--confirm-cost`. From `codex-plugin/tests/cli.test.mjs:183-187`. Proves R1 and D2.
  3. `--from-image https://example.test/a.png` reaches `createVideoJob` unchanged with zero `toParts` calls. `HTTPS://...` is accepted. `http://x/a.png` and `ftp://x/a.png` exit 9 with the scheme message. A URL that the preflight rejects exits 9. Proves R1 and D3.
  4. `createVideoJob` with `fromImage` sends `{ model, prompt, duration, image: { url } }` to `/videos/generations`; without it the body has no `image` key. From `codex-plugin/tests/media.test.mjs:40-45`. Proves R1.
  5. The real `toParts` behind the CLI with a stubbed media layer: a real PNG gives a `data:image/png;base64,` value; a PNG named `.env.png` and a text file exit 9 with zero media calls. Proves R1 with R9.
  6. `result --id` on a `done` video job with a temporary job store. Proves R2 and D4:
     - the first call downloads once and stores `artifactPath`;
     - the second call makes zero download calls and prints the same path;
     - a second call with `--out other` makes zero download calls and prints the stored path;
     - after the stored file is deleted, `result --id` still makes zero download calls and prints the stored path;
     - `video --wait` stores `artifactPath`, and a `result --id` after it makes zero download calls.
     - From `codex-plugin/tests/cli.test.mjs:164-175`.
  7. `ask` with an 800,000-character prompt exits 9 with zero calls (`codex-plugin/tests/regressions.test.mjs:77-81`); with `--allow-long-context` it sends. Attachments of 199,990 estimated tokens plus a 40-character prompt exit 9. `ask --live` and `ask --background` with the long prompt exit 9, and the background run creates no job. Proves R3.
  8. `gatherDiff` with a recording git stub: the calls are `["diff","HEAD"]`, then `["diff","HEAD~1..HEAD"]` when the first is empty. Real repository, no key: a staged-only change that holds a secret-shaped string makes `review` exit 9 with "secret-shaped", so the staged text was read and nothing was sent. From `codex-plugin/tests/regressions.test.mjs:92-112`. Proves R4.
  9. Hook. Proves R4:
     - with a recording git stub, the calls are `["diff","HEAD","--quiet"]` and `["diff","HEAD"]`;
     - real process, gate on, no key: a staged-only change to `auth.js` prints `grok stop-review gate skipped`; today it is silent;
     - real repository: the hash of the `git diff HEAD` text is equal before and after `git add` of the same change, and a second gate run after staging makes zero review calls;
     - a `gateLastDiff` entry made from `git diff` text for an unstaged-only tree stops a review after the change, so the upgrade bills nothing again.
  10. `generateImage` and `createVideoJob` with `model` undefined or empty throw `usage` with zero requests. Proves R5.
  11. A citation title and URL that hold `\v`, `\f`, U+001C, U+0085 and U+2028 print as one line each, with one `Route:` line and one closing tag. Proves R6.
  12. `generateImage` with `out: "a?b"` throws `--out is not a valid file name` with zero requests; with an `outDir` that cannot be created it throws `media directory cannot be created` with zero requests; with a valid name it sends one request. `imagine apple --out "a?b"` through the CLI with the real media layer and a stubbed API client exits 9 with zero requests. Proves R7 and D5.
  13. `riskyDiff`: an added line `// set the api key here`, `read access token from header` and `load private key` in `src/util.js` each return exactly `secrets`. The paths `config/api_key.js`, `src/apiKey.js` and `src/private_key.js` with a harmless line return `secrets`. Controls stay routine: the path `src/keyboard.js` and the line `the key idea`. Proves R8 and D6.
  14. `toParts` rejects, with no read: `.env.png` holding PNG bytes (`codex-plugin/tests/regressions.test.mjs:83-90`), `credentials.jpg`, a relative path to a credential file, and a neutral name that is a symlink to a credential path. The symlink case skips when the OS refuses symlinks. (impl note) It skips on the Windows test machine (no symlink permission), so there the real-path check is proven only by the given-path cases and by code reading. A normal image and a normal text file still pass. Proves R9.
  15. `video --wait` with a `pollVideo` that throws, and with a `downloadArtifact` that throws: the exit code is that error's, `recordSubmission` was called once with `p1`, and the job is not `submission_unknown`. A `createVideoJob` that throws still stores `submission_unknown`. Proves R10.
  16. Job store with a temporary folder. Proves R11:
      - `cancelJob` on a `done` job returns it unchanged, with its `result`;
      - a late `refresh` never overwrites `abandoned`, for a poll that resolves and one that rejects (`codex-plugin/tests/jobs.test.mjs:76-88`);
      - `updateJob` with `expectedState` writes only on a match, and with `unlessTerminal` never writes over a terminal state;
      - three real processes each write 40 updates to one job and all exit 0 (`codex-plugin/tests/jobs.test.mjs:90-103`);
      - a lock file that holds the pid of a process that has ended is taken over;
      - a lock file that holds this test's own live pid makes `updateJob` throw `job is busy` after its tries, and the job file is unchanged.
  17. `setup` when every catalog request fails with class `usage` and message "Incorrect API key provided": exit 2. A `usage` failure with another message does not become `auth`. From `codex-plugin/tests/setup.test.mjs:99` and `codex-plugin/tests/models.test.mjs:299`. Proves R12.
  18. `createJobStore()` uses `GROK_JOBS_DIR` when it is set, and the home folder otherwise. Proves R13. (impl note) The home case points `USERPROFILE` and `HOME` at a temporary folder, so the test never creates a folder in the real home.
  19. Background worker and a busy lock, with `deps.sleep` stubbed. Proves R11 and GP 5:
      - the last write throws `job is busy` twice and then succeeds: exactly one `chat` call, state `done`, no answer file;
      - the last write always throws `job is busy`: exactly one `chat` call, and `<id>.answer.json` holds the `done` patch with the output;
      - `result --id` then prints exactly the foreground output, and the job file becomes `done`;
      - with the job write still busy, `result --id` and `status --id` print the answer from the file, and no second `chat` call is made;
      - the first write always throws `job is busy`: zero `chat` calls and no answer file;
      - an answer file for an `abandoned` job is ignored;
      - a `running` job older than 6 minutes that has an answer file is reported as `done`, not `submission_unknown`.
  20. Routing through the CLI. Proves R17:
      - `rescue --coding` on the fixture catalog reports `grok-4.5` with `roleFallback: null`;
      - with the alias removed, it reports the strong route with `roleFallback: "strong"` (`codex-plugin/tests/routing.test.mjs:69`);
      - with the alias removed and `GROK_COMPANION_MODEL_STRONG` set, it uses the pin; `GROK_COMPANION_MODEL_CODING` wins over both (`codex-plugin/tests/pins.test.mjs:110`);
      - with the catalog down, it uses `grok-4.5` unverified with `roleFallback: null` and ignores the strong pin (`codex-plugin/tests/pins.test.mjs:131`, `codex-plugin/tests/routing.test.mjs:42`);
      - `rescue --coding --model <listed id>` reports `roleFallback: null`;
      - `ask`, `ask --live`, `review`, `rescue`, `imagine` and `video` results have no `roleFallback` key.
  21. `setup` reports `routes.coding.roleFallback`, and no `roleFallback` under the other four roles. `rescue --coding --background` stores `roleFallback` in the job's route and prints it in the start line. Proves R17.
- **`tests/models.test.mjs`** (R17). Tests are replaced by their codex-plugin forms:
  - line 26 ("recorded defaults"): the coding route gains `roleFallback: null` (`codex-plugin/tests/models.test.mjs:19`);
  - line 34 ("strong follows a newer flagship at any price") becomes "strong takes the newest model in the highest price tier and flags a price change" and "price comes before age: an older pricier model beats a newer cheaper one" (`:27, :39`);
  - lines 50 and 206 (coding falls back to strong) become "coding defers to strong when the build alias disappears or fails the light check" and "the alias target is exempt from the price and reasoning_effort rules" (`:68, :79`);
  - line 73 (listed fallback) becomes the two light-check tests (`:107, :119`);
  - line 81 (unavailable kind) adds offline coding with `roleFallback: null` (`:128`);
  - add "image filter runs before the tier for fast and strong" (`:52`);
  - add one test that asserts the R17 table: both rule sets' picks on `catalog-2026-11-21.json` are the five models listed there.
  - Lines 45, 56, 66 and 86 to 214 pass unchanged, apart from the R12 case added at line 214.
- **`tests/cli.test.mjs`:**
  - `harness` and `modelsFixture` move to `tests/support/harness.mjs` (R14). The file imports them from there.
  - The `harness` stubs change in three places: `jobs.updateJob` and `jobs.recordSubmission` record their calls (tests 6 and 15), and `sleep` is a stub that returns at once (test 19). `attach.toParts`, the media stubs and `cancelJob` do not change.
  - Lines 73-81 ("live catalog routes every delegation command, including coding rescue"): the coding row expects `roleFallback: null`.
  - Lines 182-202 (`setup` report): `routes.coding` expects `roleFallback: null`.
  - Lines 157-175, 176-180, 248-253 and 255-263 pass unchanged.
  - (impl note) Lines 83-88 ("discovery failure falls back to the built-in routes") run `rescue --coding` offline, so the expected route gains `roleFallback: null`.
  - (impl note) `newHome` moves with the harness and is exported, because `tests/cli.test.mjs` still uses it. The imports that only the harness used are removed from `tests/cli.test.mjs`.
- **`tests/background-gate.test.mjs`:**
  - The import of `harness` changes (R14).
  - `stubGit` (lines 371-373) and the `overflow` stub of test 37 (lines 506-508) key on `--quiet`, so they work with the new arguments unchanged.
  - Test 22 (lines 354-369) passes unchanged; test 9 adds the staged case.
  - Tests 18, 30, 34 and 35 are re-checked against the new `updateJob` options (R11). Test 12's stub at line 43, an `updateJob` that throws "disk full", still proves that the parent writes nothing after the spawn.
  - Tests 26 to 29 pass unchanged, including the documented `tokenizer` false positive.
- **`tests/jobs.test.mjs`:** the existing seven tests pass unchanged with the lock in place. "concurrent atomic updates preserve valid JSON" (line 43) is the in-process case; test 16 adds the real-process case.
- **`tests/image-edits.test.mjs`:** lines 93-106 pass unchanged; the stubbed `generateImage` now also receives `out`. Lines 54-62 (image-input routing) are re-checked against the strong rule. (impl note) Line 59 now expects `resolveRole("coding", ..., { needsImageInput: true })` to return `{ defer: "strong" }`, since `resolveRole` no longer resolves strong itself; test 20 proves the deferred route through `selectModel`. **`tests/media.test.mjs`:** passes unchanged (every call passes a model).
- **`tests/cost-gate-max-tokens.test.mjs`, `tests/speak-transcribe.test.mjs`:** the `harness` import only (R14).
- **`tests/attach.test.mjs`:** passes unchanged. Its temporary files are under the OS temporary folder, which holds no credential word.
- **`tests/packaging.test.mjs`:** lines 38-40 expect version `0.1.6`. Add: `scripts/probe.mjs` does not exist, and no file under `scripts/`, `commands/`, `skills/`, `hooks/` or `.claude-plugin/` contains `probe.mjs` (R18).
- **`tests/index.mjs`:** import the new file.
- New and changed tests fail before the change and pass after it. All other tests still pass, and the three JSON manifests parse.
- **Live check (D10).** See plan step T11. It runs only after Gary's separate go-ahead at that moment. Approval of this spec does not authorize it.

## Files to touch

- `scripts/grok-companion.mjs`: the `--from-image` handling in `commandVideo` (R1); `updateJob` after the download in `result` and in `video --wait` (R2); the prompt in the long-context check (R3); the shared diff arguments and `gatherDiff` (R4); the `oneLine` pattern (R6); `out` passed to `generateImage` (R7); the narrower catch in `commandVideo` (R10); `expectedState` and `unlessTerminal` on the worker's and `cancel`'s writes, the worker's busy-lock retry and answer file, and the answer look-up in `status` and `result` (R11); `selectModel` following a coding defer, and `roleFallback` in `routeMeta` (R17).
- `scripts/stop-review-gate-hook.mjs`: the shared diff arguments (R4). The comment on line 14 is corrected.
- `scripts/lib/media.mjs`: the model checks and the `{ image: { url } }` body (R1, R5); `prepareOut` in `generateImage` (R7).
- `scripts/lib/attach.mjs`: the two path checks in `toParts` (R9).
- `scripts/lib/risk.mjs`: the secrets pattern and file patterns (R8).
- `scripts/lib/jobs.mjs`: the locked conditional update, its use in `refresh` and `cancelJob`, `saveAnswer` and `readAnswer`, and `GROK_JOBS_DIR` (R11, R13).
- `scripts/lib/models.mjs`: the invalid-key class (R12); the strong tier, the coding defer, the light check and `roleFallback` in `resolveRole` (R17).
- `scripts/probe.mjs`: deleted (R18).
- `scripts/lib/api.mjs`, `scripts/lib/scrub.mjs`, `scripts/print-routing-policy.mjs`, `hooks/hooks.json`, `agents/grok-rescue.md`: no change. The policy version stays `grok-companion-routing-v3`.
- `commands/video.md`: `argument-hint` becomes `[--from-image <path-or-https-url>]`; one sentence: a local image is checked and encoded before the estimate, and only JPEG and PNG are accepted.
- `commands/review.md`, `commands/adversarial-review.md`: one sentence: a bare run reviews staged and unstaged changes to tracked files, then the last commit; attach untracked files with `--file`.
- `commands/result.md`: one sentence: a video is downloaded once, and later calls return the stored path. `commands/imagine.md`: a bad `--out` name is refused before the request. `commands/rescue.md`: `--coding` results report `roleFallback`.
- `tests/parity-gaps.test.mjs` and `tests/support/harness.mjs` (new); `tests/cli.test.mjs`, `tests/models.test.mjs`, `tests/background-gate.test.mjs`, `tests/image-edits.test.mjs`, `tests/cost-gate-max-tokens.test.mjs`, `tests/speak-transcribe.test.mjs`, `tests/packaging.test.mjs`, `tests/index.mjs`.
- `README.md`:
  - lines 105 and 115: `review` covers staged and unstaged tracked changes;
  - line 119: `--from-image` takes a local JPEG or PNG, or an `https://` URL;
  - line 123: `result` downloads a video once and then returns the stored path, even if the file was moved;
  - lines 139-140: there is still no price limit; add that a newer, cheaper model no longer takes the strong role;
  - line 145: the strong rule becomes "newest model in the highest price tier";
  - line 146: coding is the `grok-build-latest` target, else the strong route (the strong pin applies), reported as `roleFallback: "strong"`;
  - lines 156-159: `rescue --coding` results also report `roleFallback`;
  - lines 177-190 (Cost guards): `git diff HEAD`, staging does not re-bill, and the R8 words in the secrets row;
  - lines 191-192: the estimate counts the prompt;
  - lines 239-243 (Security model): the credential-path rule covers every attachment, on the given and the real path;
  - lines 254 and 263-266 (Testing): the test command, and the fixtures as fixed captures with no refresh script (R18);
  - lines 268-277 (Troubleshooting): a row for a refused `--from-image`;
  - line 308 (Architecture): `jobs.mjs` holds locked job writes;
  - lines 333-343 (Known limitations): remove "staged-only changes"; keep untracked files; add the limits from "Accepted limits";
  - a line for `GROK_JOBS_DIR`.
- `docs/PROBE_REPORT.md`: one line at the top, as in R18. The rest is unchanged.
- `specs/003-image-edits/spec.md`: one dated note under Results. The line "Codex-only routing rules (D1 strong by price tier, D4, D6, D7) were not ported. Claude routing semantics are unchanged." is superseded by spec 006 D9, and the first known limit there now applies with the light check. Nothing else in that spec changes.
- `skills/grok-api-runtime/SKILL.md`: `--from-image` on the `video` row, and the diff that a bare `review` reads. `skills/grok-prompting/SKILL.md`: the strong and coding rules, if it names them. `skills/grok-result-handling/SKILL.md`: no change.
- `.claude-plugin/plugin.json`: version 0.1.6. `.claude-plugin/marketplace.json`: no change.
- Changelog: none, as in specs 004 and 005.

## Plan

One PR on branch `feat/parity-gaps`. Tests come first in each step. Steps T2 to T9 start only after Gary approves this revision.

- T1. Create the branch from `main`.
- T2. Attachments and image input (R9, R1, R5): add tests 14, 1 to 5 and 10, confirm they fail, then change `attach.mjs`, `media.mjs` and `commandVideo`. R9 comes first because R1 depends on it.
- T3. Job store (R11, R13): add tests 16, 18 and 19, confirm they fail, then change `jobs.mjs`, the worker, `cancel`, `status` and `result`.
- T4. Video jobs (R2, R10): add tests 6 and 15, confirm they fail, then change `result` and `commandVideo`.
- T5. Text commands (R3, R6): add tests 7 and 11, confirm they fail, then change `prepareDelegation` and `oneLine`.
- T6. Staged changes (R4): add tests 8 and 9, confirm they fail, then change `gatherDiff` and the hook.
- T7. Routing (R17, R12): change `tests/models.test.mjs` and `tests/cli.test.mjs`, add tests 17, 20 and 21, confirm they fail, then change `models.mjs`, `selectModel` and `routeMeta`.
- T8. `imagine --out`, risk rule, probe and harness (R7, R8, R18, R14): add tests 12 and 13 and the packaging assertions, confirm they fail, then change `media.mjs` and `risk.mjs`, delete `scripts/probe.mjs`, and move the harness.
- T9. Command files, README, `docs/PROBE_REPORT.md`, the spec 003 note, skills, version 0.1.6, `tests/index.mjs`, `tests/packaging.test.mjs` (R16).
- T10. Checks and review.
  - Full suite and the JSON check: Haiku subagent. It returns the failures with their decisive lines.
  - Code review: Sonnet subagent, with the diff and the scripts it changes (`grok-companion.mjs`, `stop-review-gate-hook.mjs`, `lib/attach.mjs`, `lib/jobs.mjs`, `lib/media.mjs`, `lib/models.mjs`, `lib/risk.mjs`).
  - Gemini second opinion: yes. The session rule allows it only for a large or risky diff. This diff is both: it changes which model a billed command uses (R17), a secret check (R9), the body of a billed request (R1), what an automatic billed review reads (R4), and job-state writes with a new lock (R11). It holds no confidential code.
- T11. Live check (D10), about $0.09 at the dated rates. Ask Gary for the go-ahead at that moment. Run it only on a yes and record each result. On a no, record "no live test; the `--from-image` request shape is unproven".
  1. `setup` on the installed 0.1.5 and on the branch. Confirm the branch reports fast `grok-4.3`, strong `grok-4.7`, coding `grok-4.5` with `roleFallback: null`, and that no role's model differs from 0.1.5. Unbilled (catalog GET requests only).
  2. Only if step 1 shows a different model for `strong` or `coding`: one `rescue --max-tokens 16` for a changed strong route, and one `rescue --coding --max-tokens 16` for a changed coding route. About $0.0055 each at the 2026-11-22 reference, so at most about $0.011. On the fixture catalog no role changes, so the expected number of calls here is zero.
  3. `video --seconds 1 --from-image <a small local PNG>` with no `--confirm-cost`. Confirm exit 9 with the `1 × $0.08 = $0.08` estimate and no new job. Unbilled.
  4. `video --seconds 1 --from-image .env.png` (a PNG with that name). Confirm exit 9 and no job. Unbilled.
  5. Step 3 again with `--confirm-cost`. Confirm xAI accepts the data URL and returns a job id. About $0.08; an image input may add a charge.
  6. `status --id` until `done`, then `result --id` twice. Confirm one MP4 is saved, the second call prints the same path with no new file, and record `usageTicks` against the estimate.
  7. In a scratch repository, stage one small change and run a bare `review`. Confirm the answer names the staged change. Under $0.01.
  - If step 5 is rejected by xAI, stop before the merge. Record the error text and ask Gary whether to ship the local-path check without the send, or to try another body shape under a new approval.
  - If step 1 shows a changed route, tell Gary which model and price before step 2 runs.
  - The gate, `cancel`, `imagine --out` and the busy-lock path are not in the live check. Their tests need no request.
- T12. Write the Results section. Commit, open the PR, merge to `main`, and update the installed plugin to 0.1.6.

REA: not applicable. This ports existing behaviour from codex-plugin and fixes local checks.

## Accepted limits (proposed)

Image input:
- The whole image, up to 20 MiB, is held in memory and sent as base64 inside the JSON body, about 27 MB. xAI's limit for a data URL in a video request is not known.
- Only JPEG and PNG are accepted. WebP, GIF and HEIC are refused.
- A URL value is sent to xAI as typed, on any host (D3). The runtime does not fetch it and cannot tell what it points to, or whether xAI can reach it.
- The cost estimate does not rise for an image input.

Attachments:
- The credential pattern matches any part of the real path. A file in a folder whose name holds `credentials`, `id_rsa`, or ends in `.pem`, or a file whose name starts with `.env`, is refused whatever it contains. The user must copy the file elsewhere.
- A path check cannot prove that an image shows no secret.
- (review fix) `CREDENTIAL_PATH` (`scripts/lib/scrub.mjs:10`) misses `.key`, `.pfx`, `.p12`, `id_ed25519`, `.npmrc` and `.netrc`, and it over-blocks any name that holds `.env`. This is codex-plugin parity; widening it goes to spec 007.
- (review fix) A hard link to a credential file cannot be detected: it has its own neutral path, and its real path is that path.

Review and gate:
- A staged change that was undone in the working tree is not reviewed (F9).
- In a repository with no commit, `git diff HEAD` fails, so `review` reports "no diff to review" and the gate stays silent. Today `review` works there for a file changed after it was staged.
- Untracked files are still not reviewed. `git add` brings a new file into the review.
- The wider secrets pattern bills a review for documentation and comments that say "API key", "access token" or "private key". The file-name patterns match the file name only, not a folder such as `api_keys/`.

Routing:
- "Highest price tier" is a stand-in for "strongest". A model that xAI prices high for another reason takes the strong role.
- The strong role can cost more than under 0.1.5, and never less, once xAI releases a newer model below the top tier. Nothing asks the user first; `priceChanged` reports a moved price after the call.
- A model that is newer and better but cheaper is never used for `strong` without `--model` or a pin.
- `roleFallback` appears only on coding routes. A script that reads `rescue --coding` output sees one more field.

Jobs:
- `result` trusts the stored path (D4). If the video file was moved or deleted, `result` still prints that path and does not download again. The video can be fetched only from the job's `result.url` while xAI keeps it.
- A later `--out` on `result` is ignored once the video is saved.
- A worker whose first write stays busy for 60 seconds exits without sending. The job stays `created` with a claim file, so it is reported as `submission_unknown` ("may have been billed") although nothing was sent.
- An answer file is applied only when someone runs `status` or `result`. Until then the job file says `running`.
- A stale lock whose pid was reused by a live process blocks every write to that job until the file is deleted by hand. The worker's answer still reaches the user through the answer file.
- Lock and answer files left by a killed process stay in the jobs folder. Nothing prunes them.
- A foreground write that meets a busy lock for one second fails with `job is busy; retry the local operation`. For `status`, `result` and `cancel` the user runs the command again; no request is repeated.

Probe:
- Without the probe, the fixtures in `tests/fixtures/` cannot be refreshed from this repository. A change in xAI's response shapes is found only by a live check or by codex-plugin's probe.

Other:
- A failure after `video --wait` submits leaves the job `submitted` or `running`. The user must run `status --id` and `result --id`; nothing tells them to, beyond the error and the job id printed before it.
- codex-plugin keeps faults F1 to F7. Backports are out of scope.

## Open questions

None. Q12 is settled as D12, and the scope question on the setup and catalog details as D13.

## Decisions

All Jev values are from jev-1.14.0. "Jev pick adopted" means confidence above 0.70. At 0.70 or below, Gary decided. All decisions are dated 2026-11-22.

| Id | Choice | Decided by | Jev pick, confidence and probabilities |
|---|---|---|---|
| D1 Diff source (Q1) | `git diff HEAD` for `review` and the gate, with the `HEAD~1..HEAD` fallback kept. | Gary | `diff_head`, 0.53: diff_head 0.69, diff_plus_cached 0.23, keep_diff 0.08 |
| D2 Order of the `--from-image` checks (Q2) | Before the `--confirm-cost` gate. | Jev pick adopted (> 0.70) | `before_gate`, 0.84: before_gate 0.92, after_gate 0.08 |
| D3 A URL as `--from-image` (Q3) | Accept any `https://` URL after the secret preflight, as codex-plugin does. | Gary | `any_https`, 0.24: any_https 0.49, xai_hosts 0.31, local_only 0.20 |
| D4 `result` after the video is saved (Q4) | Print the stored path and never download again, as codex-plugin does. | Gary | `print_path`, 0.56: print_path 0.71, redownload_if_missing 0.22, redownload_on_out 0.07 |
| D5 A bad `imagine --out` (Q5) | Refuse before the request. | Gary | `refuse_before`, 0.24: refuse_before 0.49, fallback_name 0.26, both 0.25 |
| D6 Secrets pattern (Q6) | Allow a space in the three phrases, and add the file-name patterns. | Gary | `space_and_filenames`, 0.34: space_and_filenames 0.56, leave 0.38, space_only 0.06 |
| D7 Job-store writes (Q7) | Port codex-plugin's locked conditional update in full. A background worker repeats the local lock attempt, then writes an answer file (R11). | Gary | `locked_update`, 0.38: locked_update 0.59, terminal_guard 0.21, no_change 0.20 |
| D8 Gaps found in review (Q8) | Fix all six (R9 to R14) in this spec. | Gary | `all_six`, 0.42: all_six 0.61, two_serious 0.26, none 0.13 |
| D9 Routing rules (Q9) | Port codex-plugin's rules now: the strong role by highest price tier, `roleFallback`, and the light-check fallback (R17). | Gary | `port_now`, 0.16: port_now 0.44, keep_ours 0.28, spec_007 0.28 |
| D10 Live check (Q10) | The full check, about $0.09, plus the routing step. Only after Gary's separate go-ahead at that moment. Spec approval does not authorize it. | Gary | `none`, 0.79: none 0.86, full 0.11, video_only 0.03 |
| D11 Developer probe (Q11) | Remove `scripts/probe.mjs` and what refers to it (R18). | Gary | `remove`, 0.50: remove 0.67, port 0.21, leave 0.12 |
| D12 Probe copy in `codex/` (Q12) | Leave `claude-source/codex/scripts/probe.mjs`. D11 covers `scripts/probe.mjs` only, and `codex/` stays excluded. | Gary | `leave`, 0.50: leave 0.67, later_spec 0.25, delete_too 0.08 |
| D13 Setup and catalog details (Q13) | Not in this spec. Spec 007 ports them: the per-kind error class, exit 2 only when every kind fails with `auth`, one refetch per kind per run, the trimmed env pin, and removal of a failed cache temp file. | Gary | `spec_007`, 0.30: spec_007 0.53, leave 0.35, include_now 0.12 |

D4 and D9 override the rev 1 recommendation. In D10, Gary chose against the Jev pick, whose confidence was above 0.70; the live check spends money, which only Gary can approve. The busy-lock handling in D7 is a design detail inside Gary's choice and was not rated.

## Results (2026-11-22)

- **Implementation.** T2 to T9 were done test-first. Each deviation is recorded above as an "(impl note)":
  - `listJobs` skips `.answer.json`.
  - The offline coding cli test now expects `roleFallback: null`.
  - The image-edits test now expects `{ defer: "strong" }`.
  - The `newHome` helper moved to the harness.
  - The R6 regex uses the `u` flag.
  - Only `job is busy` is retried on the first write.
  - Test 18 redirects HOME.
  - The R17 table test restates the 0.1.5 strong rule.
- **Tests.**
  - `node tests/index.mjs` and `node --test tests/` now run the same 180 tests: 178 pass, 0 fail, 2 skipped. The skips are two file-symlink cases that Windows refuses. Before this change there were 148. The equal counts prove R14.
  - A Haiku 5.5 subagent ran the suite three times. No test was flaky, and no worker, lock or answer file was left behind.
  - `codex/` passed 68 of 68 and is unchanged.
- **Review.** A Sonnet 5.5 subagent's findings were fixed test-first (tests 14b and 22 to 25):
  - The worker's first write is now conditional (`expectedState: "created"`), so a cancel that lands between the claim and that write can no longer be overwritten and billed. The subagent confirmed this race with a script before the fix.
  - Lock hardening:
    - an empty lock, or one without a valid pid, is stale after 1 second;
    - any lock older than 30 seconds is stale;
    - a stale lock is taken over by an atomic rename and a re-check;
    - releasing a lock never throws.
  - Any error on the final write now saves the answer file, not only "busy".
  - Tests no longer create the real media folder.
  - `video` prints the job line before it starts polling.
  - The scheme regex now needs at least two characters, so `C://` is read as a path.
  - The rejected-key message covers HTTP 400.
  - The diff arguments are now `["diff", "HEAD", "--"]`.
  - New tests: a directory junction, an 8.3 short name, the data URL never appears in any job write, `status` and `result` still work after a poll failure, and the coding route with an image.
- **Gemini second opinion.** gemini-3.8-flash and others reviewed it before the review fixes. Verdict: sound, no findings. Cost was not reported; input was about 1.43M tokens.
- **Live check (D10).** Gary gave the go-ahead on 2026-11-22. Total about $0.092 by the reported ticks.
  1. `setup` on 0.1.5 and on the branch gave the same routes: fast `grok-4.3`, strong `grok-4.7`, coding `grok-4.5`, image `grok-imagine-image-2.0`, video `grok-imagine-video-1.5`. Step 2 was skipped because no route changed.
  2. (Not run.)
  3. `video --seconds 1 --from-image pond.png` (a 256×256 PNG) without the flag: exit 9 with the $0.08 estimate, and no job. Unbilled.
  4. The same with `.env.png` and `--confirm-cost`: exit 9, "attachment rejected: credential file paths are not allowed", and no job. Unbilled.
  5. With `--confirm-cost`: **xAI accepted the data URL in `image.url`**. This was the first live run of this request by either plugin. The job line printed before polling, on `grok-imagine-video-1.5`.
  6. The job was `done` in about 20 s. `usageTicks` was 900,000,000, which is $0.09, $0.01 above the estimate (the image input charge). `result --id --out live-check-006` saved one 80,809-byte MP4. A second `result` printed the same path and wrote no new file.
  7. A scratch repo with only a staged change (`a + b` changed to `a - b`, unstaged diff empty): a bare `review` on `grok-4.3` found it as the critical finding. $0.0015.
- **Release.** Version 0.1.6.

## Parity status after this spec

claude-source then matches codex-plugin on every command, flag, routing rule and safety check that codex-plugin ships, except the five items below. It does not reach full parity: each item remains by a recorded decision.

codex-plugin can do these and claude-source still cannot:

1. **`--out` as a full path.** codex-plugin saves to the folder in `--out`. claude-source keeps the base name and saves in `~/.grok-companion/media` (spec 004 D3).
2. **A default output limit of 4096 tokens** and **a JSON cost line for `video`** (spec 005 D5 and D2).
3. **Setup and catalog details.** A per-kind error class in `catalogSources`; exit 2 only when every kind fails with `auth`; one refetch of one kind per run; a trimmed env pin; removal of a failed cache temp file (`codex-plugin/scripts/grok-companion.mjs:79-126, 243-255`). D9 named the routing rules only, so these were not ported.
4. **Transport options.** An external cancel signal, a 64 KiB cap on error bodies and a timeout race around body reads (`codex-plugin/scripts/lib/api.mjs:58-110`; left out by spec 004).
5. **A developer probe.** codex-plugin's probe resolves live routes and refreshes fixtures (`codex-plugin/scripts/probe.mjs`, `resolveLiveRoutes` in `codex-plugin/scripts/lib/models.mjs:237-249`). claude-source has none after D11.

Until the T11 live check runs, `--from-image` is at parity in code only: neither plugin has proved the request live.

Note (2026-11-22, spec 007): item 3 is closed by spec 007 (R1 to R5). Item 4 is decided against by spec 007 D7 (cancel signal) and D8 (error-body cap and raced body reads).

claude-source can do these and codex-plugin cannot:

1. Slash commands, the SessionStart routing policy, and the per-repository stop-review gate with its risky-diff rule.
2. `--background` on the five text commands, with `status`, `result` and a `cancel` that stops only a verified worker.
3. A per-command flag table, the `--` terminator, and strict integer parsing.
4. A `video` refusal that shows the computed total.
5. `speak --text-file`; relative paths for `transcribe --file`; a verified `transcribe --model`; transcripts inside the untrusted envelope.
6. Windows fixes: the native real path for credential checks, and `O_NONBLOCK` handled when it is undefined.
7. A refusal of a diff over the 10 MB read limit, in place of a silent fallback to the last commit.
8. A downloaded artifact that is never lost to a bad name, and "may have been billed" notes on errors after a sent request.
9. After this spec: `--from-image` checked before the cost gate and for secrets in a URL; the artifact path stored after `video --wait`; the provider job id kept when `--wait` fails; `--out` checked before a billed image; a paid background answer kept when the job lock is busy.
