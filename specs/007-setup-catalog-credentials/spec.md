# Spec 007: Setup and catalog details, credential paths, job-folder pruning (parity step 6)

Revision: 2 (2026-11-22). Status: APPROVED rev 2. Gary approved it on 2026-11-22, including the planner calls (gc replaced by pruning on `status`; `submitted` and `unknown` jobs never pruned; `.tmp` pruning in the jobs folder only). This authorizes T1 to T9 and T11. The live check (T10) still needs its own go-ahead. Decisions D1 to D11 are settled (see "Decisions").
Source: spec 006 decision D13 ("Spec 007 ports them"), the spec 006 review (accepted limit on `CREDENTIAL_PATH`), and the spec 006 Results and "Parity status" sections. codex-plugin is the reference.
"GP n" below means Grok Companion principle n in `.specify/memory/constitution.md`. Paths without a prefix are in claude-source. `docs/verification.md` is in the workspace folder above both plugins.

Changes from rev 1: Q1 to Q11 are settled as D1 to D11.
- The `.env` rule is the whole-dot-part rule (D1). Rev 1 recommended "not followed by a letter". `.env-prod`, `.env_local` and `.env2` become allowed.
- Finished job records older than 7 days are pruned with their side files (D4). Rev 1 recommended side files only.
- Pruning runs when `status` lists jobs, and `status` prints the counts (D5). Rev 1 recommended job creation.
- The transport protections are not ported (D8). Rev 1 recommended porting both. Rev 1's R10, R11, F1, F2 and tests 15 to 17 are removed.
- The cancel signal is not ported (D7), as rev 1 recommended.
- `gc` is replaced by `sweep()`, because D4 gives the 7-day rule a caller.
- The requirements are now R1 to R11 and the plan is T1 to T11. The live check is T10.

## Problem

Spec 006 left five codex-plugin setup and catalog details for this spec (D13), one credential-path limit, one pruning limit and one cost-estimate limit. Its "Parity status" section also lists three transport options. Each was checked again against the code on `main` (version 0.1.6, commit 9a24f2e). All are still open.

From D13 (setup and catalog):

1. **`catalogSources` holds no error class.** `setup` prints one string per kind (`scripts/grok-companion.mjs:555`: `live`, `cache-stale` or `none`). codex-plugin prints `{ source: "live" }`, or `{ source: "cache-stale" | "fallback", error_class }` (`codex-plugin/scripts/grok-companion.mjs:251-252`).
2. **`setup` exits 2 when any one kind fails with `auth`, and prints no report.** It throws before the report (`scripts/grok-companion.mjs:549`). codex-plugin always prints the report, and exits 2 only when every kind failed with `auth` (`codex-plugin/scripts/grok-companion.mjs:253-254`).
3. **An unknown `--model` or pin refetches all three kinds.** `selectRoute` reloads the whole catalog when the kind is not `live` (`scripts/grok-companion.mjs:166-170`), and `catalogContext` has no once-per-run limit (`:138-145`). codex-plugin refetches only the role's kind, only when that kind came from the fresh cache, and at most once per run (`codex-plugin/scripts/grok-companion.mjs:79-94, 103-108`; `only` in `codex-plugin/scripts/lib/models.mjs:115, 135`).
4. **An env pin is not trimmed.** `GROK_COMPANION_MODEL_STRONG=" grok-4.6 "` is looked up with its spaces and exits 8; a pin of spaces only counts as a pin (`scripts/grok-companion.mjs:156`). codex-plugin trims it (`codex-plugin/scripts/grok-companion.mjs:122`).
5. **A failed cache write leaves its temp file.** `writeCache` ignores the error and keeps `models.json.<uuid>.tmp` (`scripts/lib/models.mjs:85-92`). codex-plugin removes it (`codex-plugin/scripts/lib/models.mjs:93-104`).

Found in `models.mjs` while checking items 1 to 5 (D13 names the whole file):

6. **`loadCatalog` without a request function writes the cache.** Each kind throws inside the fetch (`scripts/lib/models.mjs:124-127`), so `failedAt` is stored and the next real run skips discovery for 5 minutes. codex-plugin returns `error: "network"` for every kind and does not touch the file (`codex-plugin/scripts/lib/models.mjs:118-122`). Only tests reach this path.
7. **A kind served inside the 5-minute failure window carries no error class** (`scripts/lib/models.mjs:120`). codex-plugin records `network` (`codex-plugin/scripts/lib/models.mjs:138`).

From the spec 006 review and Results:

8. **`CREDENTIAL_PATH` misses common credential files and over-blocks `.env`.** The pattern is `/(^|[\\/])?\.env[^\\/]*$|id_rsa|\.pem$|credentials/i` (`scripts/lib/scrub.mjs:10`). Checked on 2026-11-22: `server.key`, `cert.pfx`, `cert.p12`, `id_ed25519`, `.npmrc` and `.netrc` pass, and `a.environment.png` and `my.envelope.txt` are refused. codex-plugin's pattern is the same, byte for byte (`codex-plugin/scripts/lib/scrub.mjs:10`).
9. **The risk rule keeps a second list.** `scripts/lib/risk.mjs:8` has `/^\.env/i, /\.pem$/i, /\.key$/i, /\.pfx$/i` and two key-name patterns. It already has `.key` and `.pfx`, which `scrub.mjs` lacks, and it lacks `id_rsa`. codex-plugin has no risk rule.
10. **Nothing prunes the jobs folder.** `<id>.claim` (`scripts/lib/jobs.mjs:153-156`), `<id>.answer.json` (`:115-118`), a lock left by a killed process (`:68`), a moved lock `<id>.json.lock.<uuid>.stale` (`:83`) and a failed write's `<id>.json.<uuid>.tmp` (`:60`) stay for ever. `applyAnswer` never deletes the answer file it applied (`scripts/grok-companion.mjs:299-306`). Job records stay for ever too. `gc` exists (`scripts/lib/jobs.mjs:175-183`) but no command calls it.
11. **The video estimate ignores the image input.** It is `seconds × $0.08` (`scripts/grok-companion.mjs:369-372`). Spec 006's live check measured $0.09 for a 1-second image-to-video job against $0.08.

From spec 006 "Parity status", item 4 (transport), `scripts/lib/api.mjs` against `codex-plugin/scripts/lib/api.mjs:45-128`. All three are decided against (D7, D8) and are listed here as the record of what was checked:

12. **An error body is not capped.** Without `maxBytes`, the whole body is read by `response.text()` (`scripts/lib/api.mjs:94-98`). codex-plugin reads every non-OK body under a 64 KiB cap (`codex-plugin/scripts/lib/api.mjs:83, 90, 97, 104`).
13. **A body read is not raced against the timeout.** After the headers arrive, `reader.read()` and `response.text()` end at the timeout only if the fetch implementation aborts them (`scripts/lib/api.mjs:86, 96`). codex-plugin races each read against the abort (`codex-plugin/scripts/lib/api.mjs:64-67, 72, 94, 103`).
14. **The cancel signal is half ported.** `requestAuthenticated`, `chat`, `respond` and `listModels` take `signal` and abort on it (`scripts/lib/api.mjs:45, 57-58, 117-128`). Missing: the check for an already-aborted signal, the `API request canceled` message, `retryable: false` for a cancelled GET (`codex-plugin/scripts/lib/api.mjs:58, 63, 81`), and `createMedia({ signal })` for `/tts`, `/stt` and downloads (`codex-plugin/scripts/lib/media.mjs:134, 142, 157, 200-203, 238`). No command in either plugin creates or passes a signal.

Checked and already done, so dropped:

| Item | Verified at |
|---|---|
| A rejected key (HTTP 400 "Incorrect API key") classed as `auth` in discovery | Done by spec 006 R12: `scripts/lib/models.mjs:94-99` |
| `GROK_JOBS_DIR` | Done by spec 006 R13: `scripts/lib/jobs.mjs:49` |
| Byte cap with a streamed read when `maxBytes` is given; `redirect: "error"` | Done: `scripts/lib/api.mjs:76-93, 45` |
| Cache home from `GROK_COMPANION_HOME` (`codex-plugin/scripts/lib/models.mjs:71-74`) | Equal result: `companionHome()` (`scripts/grok-companion.mjs:32`) is passed as `home` |
| Routing rules, `roleFallback`, light check | Done by spec 006 R17: `scripts/lib/models.mjs:175-213` |

## Requirements

R1 to R5 are the D13 items. R6 and R7 are the credential paths. R8 is pruning. R9 is the estimate.

- **R1 Per-kind error class in `catalogSources` (GP 6, spec 006 D13).** Ported from `codex-plugin/scripts/grok-companion.mjs:251-252`.
  - Each kind maps to `{ source: "live" }`, or to `{ source, error_class }` where `source` is `cache-stale` when a stale cache was used and `fallback` otherwise, and `error_class` is the kind's stored class, or `network` when none is stored.
  - Today's string `none` becomes the object with `source: "fallback"`. `setup` loads with `fresh: true`, so `cache` never appears.
  - The other report fields keep their names and order: `keyPresent`, `apiReachable`, `catalogSources`, `models`, `routes`, `stopReviewGate`, `gateRepos`, `imageDefaultOverride`. codex-plugin has no gate fields.
  - No test, command file, skill or README line reads `catalogSources` today (checked by search on 2026-11-22).
- **R2 `setup` exit code and message (GP 1, spec 006 D13, D9).** Ported from `codex-plugin/scripts/grok-companion.mjs:253-254`.
  - With a key, `setup` always prints the report. The throw at `scripts/grok-companion.mjs:549` is removed.
  - Exit 2 only when every kind has error class `auth`. A stale cache does not change that. Otherwise exit 0.
  - One or two kinds with `auth` are reported per kind, exit 0 (`codex-plugin/tests/setup.test.mjs:71-75`).
  - **Message (D9).** When the exit code is 2, the report has one more field, placed last: `message: "xAI rejected the API key (catalog request returned 400, 401 or 403)"`. This is the text from the spec 006 review. With exit 0 the field is absent. codex-plugin has no such field.
  - The no-key path does not change: one report, exit 2, no request, no `message` (`scripts/grok-companion.mjs:543-546`).
- **R3 One refetch of one kind per run (GP 2, spec 006 D13).** Ported from `codex-plugin/scripts/grok-companion.mjs:79-94, 100-108` and `codex-plugin/scripts/lib/models.mjs:115, 135`.
  - `loadCatalog` takes `only: [kind, ...]`. Listed kinds are loaded; the others come back unavailable.
  - `catalogContext` takes `{ refetch: kind }`. The first such call in a run reloads that one kind with `refetch: true` and merges it into the loaded catalog. Every later call returns the loaded catalog with no request.
  - `selectRoute` asks for a refetch only when the model is unknown and its kind came from the fresh cache (`source === "cache"`). A `live` kind is current. A `cache-stale` kind means its fetch failed in this run or in the last 5 minutes.
  - After that, an unknown model whose kind is not `live` is used unverified. Only a live list proves that an id is absent.
  - Result: one GET in place of three. `transcriptionRoute` (`scripts/grok-companion.mjs:463-480`) does not refetch and does not change.
  - Kept from claude-source: an explicit model that is found reports its real `priceChanged` (`scripts/grok-companion.mjs:175`; spec 001 FR-005). codex-plugin reports `null` (`codex-plugin/scripts/grok-companion.mjs:109`).
- **R4 Trimmed env pin (GP 6, spec 006 D13).** The pin is `ctx.env?.[ROLE_ENV[role]]?.trim()` (`codex-plugin/scripts/grok-companion.mjs:122`). A pin of spaces only is no pin, and the role route is used. `--model` is not trimmed in either plugin.
- **R5 Catalog cache details and temp files (spec 006 D13, D10).** Ported from `codex-plugin/scripts/lib/models.mjs:93-104, 118-122, 138`.
  - `writeCache` removes its temp file when the write or the rename fails. The failure still never blocks a command.
  - Without a request function, `loadCatalog` returns every kind unavailable with `error: "network"`, and it reads and writes no cache file.
  - A kind inside the 5-minute failure window is served with `error: "network"`.
  - **Other writers (D10).** The same temp-file removal goes into `writeConfig` (`scripts/grok-companion.mjs:43-49`) and the job `write` (`scripts/lib/jobs.mjs:57-64`). Both remove the temp file and then throw their error as today. codex-plugin's job `write` has the same leak (`codex-plugin/scripts/lib/jobs.mjs:43-50`).
  - Old `.tmp` files that a killed process left in the jobs folder are removed by R8.
- **R6 Wider `CREDENTIAL_PATH` (GP 3, D1, D2).** One exported pattern in `scripts/lib/scrub.mjs`. This goes beyond codex-plugin, whose pattern is today's.
  - **Kept.** `id_rsa` and `credentials` anywhere in the path, and `.pem` at the end of the path.
  - **Added, at the end of the path (D2):** `.key`, `.pfx`, `.p12`, `.ppk`, `.jks`, `.keystore`.
  - **Added, anywhere in the path (D2):** `id_ed25519`, `id_ecdsa`, `id_dsa`.
  - **Added, as the whole file name (D2):** `.npmrc`, `.netrc`, `_netrc`, `.pypirc`.
  - **`.env` rule (D1).** In the file name, `.env` or `.envrc` as a whole dot-separated part: it is followed by `.` or by the end of the name.
    - Refused: `.env`, `.env.local`, `.env.production`, `x.env`, `x.env.png`, `.env.png`, `.env.mp3`, `.envrc`.
    - Allowed: `a.environment.png`, `my.envelope.txt`.
    - Also allowed, and refused today: `.env-prod`, `.env_local`, `.env2`. Gary chose this rule; see "Accepted limits".
  - Proposed pattern, to be fixed by the tests: `/\.env(rc)?(\.[^\\/]*)?$|id_(rsa|dsa|ecdsa|ed25519)|\.(pem|key|pfx|p12|ppk|jks|keystore)$|(^|[\\/])(\.npmrc|\.netrc|_netrc|\.pypirc)$|credentials/i`.
  - **Callers.** All go through `preflight(text, { sourcePath })` (`scripts/lib/scrub.mjs:39-42`), so one change reaches each of them:

    | Input | Check site | Paths checked |
    |---|---|---|
    | `--file` on `ask`, `review`, `adversarial-review`, `rescue`, `transfer` (`scripts/grok-companion.mjs:198`) | `toParts`, `scripts/lib/attach.mjs:102, 108, 117` | given, real |
    | `imagine --source` (`scripts/grok-companion.mjs:412`) | the same | given, real |
    | `video --from-image <local path>` (`scripts/grok-companion.mjs:365`) | the same | given, real |
    | `speak --text-file` (`scripts/grok-companion.mjs:433, 434, 437`) | `readSpeechFile` | given, resolved, real |
    | `transcribe --file` (`scripts/lib/media.mjs:130, 131, 134`) | `readAudio` | given, resolved, real |
    | A background worker's `--file` (`scripts/grok-companion.mjs:282`) | `toParts` again | given, real |

  - Not checked by path, as today: a prompt, an `https://` value of `--from-image`, an `--out` name, and the files named inside a diff that `review` or the gate sends.
  - The error text does not change: `attachment rejected: credential file paths are not allowed`, or `content rejected before dispatch: ...` for `--text-file`.
- **R7 One source for credential file names (D3).** `scrub.mjs` exports the file-name patterns, and the `secrets` category in `scripts/lib/risk.mjs:8` uses them in place of `/^\.env/i, /\.pem$/i, /\.key$/i, /\.pfx$/i`. It keeps its own `api[_-]?key` and `private[_-]?key` patterns and its path-word stems.
  - The risk rule tests the file name only (`scripts/lib/risk.mjs:58`), so the shared list is written for a file name. `credentials` and `id_*` in a folder name stay a `scrub.mjs` rule; the risk rule already has the `credential` stem.
  - Now risky as a changed file name: `x.env`, `*.p12`, `*.ppk`, `*.jks`, `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa`, `.npmrc`, `.netrc`, `_netrc`, `.pypirc`.
  - No longer risky by file name, because of D1: `.env-prod`, `.env_local`, `.env2`, `.environment`. A changed line in them can still match.
  - The README table row for `secrets` (line 190) is updated.
- **R8 Pruning of the jobs folder (GP 5, GP 7, D4, D5, D10).** codex-plugin has no working policy: its `gc(ttlDays = 7)` deletes any `.json` older than 7 days by modification time, whatever the job's state, without the lock, and no command calls it (`codex-plugin/scripts/lib/jobs.mjs:130-138`; only `codex-plugin/tests/jobs.test.mjs:60-67`). claude-source's copy is the same (`scripts/lib/jobs.mjs:175-183`). D4 takes its 7 days and adds the state and lock rules.
  - `scripts/lib/jobs.mjs` gains `sweep()`, which returns the counts `{ jobs, claims, answers, locks, temp }`. `gc` is removed; `sweep()` replaces it.
  - **Trigger (D5).** `status` with no `--id` calls `sweep()` once, before it reads the list. No other command calls it: not `status --id`, `result`, `cancel`, `video` or a background run.
  - **Output (D5).** When at least one file was deleted, `status` first prints one line, `{"pruned":{"jobs":N,"claims":N,"answers":N,"locks":N,"temp":N}}`. The job list is still the last line. When nothing was deleted, the output is today's single line.
  - **Finished job records (D4).** A job record is deleted only when all of these hold:
    1. its stored state is `done`, `failed` or `abandoned` (review fix: not `submission_unknown`, whose request may have been billed; Gary approved "`submitted` and unknown jobs are never pruned"), and the record is the store's own: its `id` equals the file name, and it has `kind`, `createdAt` and a known `state` (review fix);
    2. its job file was last written more than 7 days ago (file modification time, as in `gc`);
    3. `sweep()` gets the job's lock at the first try. It does not wait. A busy lock skips the job.
    - Under the lock, the state and the age are read again. Then the claim file, the answer file and the job file are deleted, in that order, and the lock is released.
    - A saved video or image in the media folder is never deleted.
  - **Never deleted, at any age:** the record, claim file or answer file of a job whose stored state is `created`, `running`, `submitted`, `unknown` or `submission_unknown` (review fix). This covers a queued job, a running worker, a `running` job with an unapplied answer file, and a video job that xAI may still be working on. The claim of an old `created` job is what makes `status` say "may have been billed" (`scripts/grok-companion.mjs:317-318`).
  - **Side files.** `sweep()` also looks at names that end in `.claim`, `.answer.json`, `.json.lock`, `.stale` or `.tmp`. (review fix) Only the exact names the store writes count: `<id>.claim`, `<id>.answer.json`, `<id>.json.lock`, `<id>.json.lock.<uuid>.stale` and `<id>.json.<uuid>.tmp`, where `<id>` and `<uuid>` are UUIDs; any other name, and any entry that is not a regular file, is left alone. A side file younger than 1 hour is never touched. No write or lock take-over lasts that long: a lock is stale after 30 seconds (`scripts/lib/jobs.mjs:36`), and a worker lives about 6 minutes at most. Rules for an older one:

    | File | Deleted only when |
    |---|---|
    | `<id>.claim` | the job file is missing (ENOENT only; any other read error keeps it), or the job's state is `done`, `failed` or `abandoned`; checked under the job's lock taken at the first try, so a busy lock keeps it (review fix) |
    | `<id>.answer.json` | the same |
    | `<id>.json.lock` | `staleLock` says it is stale; removed by the take-over steps of `update` (move aside, check again, delete only if still stale; `scripts/lib/jobs.mjs:82-90`), which become one shared helper |
    | `<id>.json.lock.<uuid>.stale`, `<id>.json.<uuid>.tmp` (D10) | always (older than 1 hour) |

  - **Held locks.** A lock whose pid is alive and that is younger than 30 seconds is never deleted or moved. The record of a job with such a lock is skipped (rule 3).
  - `sweep()` reads only the jobs folder. Temp files of the catalog cache and of `config.json` are removed at the failed write itself (R5).
  - `sweep()` never throws; each file's error is skipped. The `status` branch also wraps the call, so a failed sweep prints nothing and `status` lists as today.
- **R9 Video estimate with an image input (GP 5, D6).** Evidence:
  - Text-to-video, 1 second, `grok-imagine-video-1.5`: `usageTicks` 800,000,000 = $0.08 (spec 005 live check).
  - Image-to-video, 1 second, same model, a 256×256 PNG as a data URL: `usageTicks` 900,000,000 = $0.09 (spec 006 Results, live check step 6).
  - xAI's documentation: "Input images add editing charges" (`docs/verification.md:27`).
  - One 1-second run cannot tell a flat $0.01 per image from $0.01 more per second.
  - **Measure first (D6).** One 2-second image-to-video run (T10 step 4) settles it. Then the image charge goes into the number:
    - flat: `2 × $0.08 + $0.01 image input = $0.17`;
    - per second: `2 × $0.09 = $0.18`.
    - Both lines keep "unverified estimate".
  - **Fallback (D6).** If Gary declines the paid run at that moment, the number stays `seconds × $0.08` and the text gains: `plus an image input charge (measured $0.01 on a 1-second job on 2026-11-22)`.
  - The refusal without `--confirm-cost` and the line printed before dispatch use the same text (`scripts/grok-companion.mjs:370, 372`). A job with no image input prints exactly what it prints today.
  - The image charge applies to a local path and to an `https://` URL alike.
- **R10 Errors and exit codes.** No new error class or exit code. `setup` changes when it exits 2 (R2). Every new refusal is `usage`, exit 9, before any billed request.
- **R11 Docs and version.** Update the README, command files and skill listed under "Files to touch". Bump the version from 0.1.6 to 0.1.7.

## Differences from codex-plugin and how this spec handles them

| Topic | codex-plugin | claude-source today | This spec |
|---|---|---|---|
| `catalogSources` | Object with `error_class` (`grok-companion.mjs:251-252`) | String (`grok-companion.mjs:555`) | R1 |
| `setup` with a rejected key | Report, exit 2 only if every kind is `auth` (`:253-254`) | Error object, exit 2 if any kind is `auth` (`:549`) | R2, with a `message` field (D9) |
| Refetch for an unknown model | One kind, from a fresh cache only, once per run (`:79-94, 103`) | Three kinds, whenever not `live` (`:166-170`) | R3 |
| `priceChanged` for an explicit model | `null` (`:109`) | The real value (`:175`) | Kept (spec 001 FR-005) |
| Env pin | Trimmed (`:122`) | As typed (`:156`) | R4 |
| Failed cache temp file | Removed (`models.mjs:93-104`) | Left (`models.mjs:85-92`) | R5 |
| Failed job or config temp file | Job temp left (`jobs.mjs:43-50`); no config file | Left (`jobs.mjs:57-64`, `grok-companion.mjs:43-49`) | R5 (D10; claude-source only) |
| No request function | No cache access (`models.mjs:118-122`) | `failedAt` written (`models.mjs:124-127, 135, 139`) | R5 |
| Credential path pattern | `.env*`, `id_rsa`, `.pem`, `credentials` (`scrub.mjs:10`) | The same (`scrub.mjs:10`) | R6: wider, `.env` as a whole part (claude-source only) |
| Risk rule file names | None | Own list (`risk.mjs:8`) | R7 (claude-source only) |
| Job-folder pruning | `gc`, never called (`jobs.mjs:130-138`) | `gc`, never called (`jobs.mjs:175-183`) | R8: `sweep()` on `status` (claude-source only) |
| Video estimate | `seconds × 0.08` as JSON (`grok-companion.mjs:198`) | `seconds × $0.08` as text (`grok-companion.mjs:369-372`) | R9 (claude-source only) |
| Error-body cap | 64 KiB (`api.mjs:83`) | None without `maxBytes` (`api.mjs:94-98`) | Not ported (D8) |
| Raced body reads | Yes (`api.mjs:64-67, 94, 103`) | No (`api.mjs:86, 96`) | Not ported (D8) |
| Cancel signal | API and media (`api.mjs:58-63`, `media.mjs:134`) | API only, partial (`api.mjs:57-58`) | Not ported (D7) |

## codex-plugin behaviour flagged, not copied as is

- **F1 `gc` deletes by age only** (`jobs.mjs:130-138`). It would delete a running job's record and an unapplied answer file, and it takes no lock. Neither plugin calls it. Handled by R8: `sweep()` keeps the 7 days, checks the state and takes the lock.
- **F2 The lost key-rejected message.** codex-plugin's report says `error_class: "auth"` per kind and nothing more. Handled by R2 (D9).

## Cost

Nothing in this spec adds a billed command or changes the body of a billed request.

- **`setup` and the catalog.** Catalog requests are unbilled GETs. R3 sends one in place of three.
- **Stop-review gate (R7).** The gate still bills at most once per distinct diff and once per stop sequence, only in a repository on the gate list. A diff that touches a file with one of the new names (R7) becomes risky and is reviewed. A diff that touches only `.env-prod`, `.env_local` or `.env2` is no longer risky by its file name. One review is one `review` request on the fast role, up to 200 KB of diff. Spec 006's live check measured $0.0015 for a small one.
- **Video estimate (R9).** Display only. The real charge does not change. The printed number rises by the image charge, so the user approves the fuller amount.
- **Credential paths (R6).** More files are refused before any request, and three `.env` name forms are no longer refused. Nothing is billed by the check.
- **Pruning (R8).** Local file deletes only. A paid text answer in a finished job older than 7 days is deleted with its record. Nothing is billed again, and nothing is re-sent.
- **Live check (D11).** Steps 1 to 3 of T10 are unbilled. Step 4 is one 2-second image-to-video job: $0.17 or $0.18 at the rates measured on 2026-11-22. Each run needs Gary's go-ahead at that moment.

## Exclusions

- **Decided against (D7): the external cancel signal.** The missing parts in Problem item 14 are not ported. The half that claude-source already has (`scripts/lib/api.mjs:57-58`) stays as it is. No Ctrl+C wiring.
- **Decided against (D8): the 64 KiB cap on error bodies and the raced body reads** (Problem items 12 and 13), and codex-plugin's `maxBytes` type check (`codex-plugin/scripts/lib/api.mjs:52`). `scripts/lib/api.mjs` is not changed.
- A new command or flag for pruning, a setting for the 7 days, and pruning of the media folder.
- A check of file names inside a diff, and a path check on `--from-image` URLs.
- A cost gate on `imagine`, `speak` or `transcribe`.
- codex-plugin's full-path `--out` (spec 004 D3), its JSON cost line (spec 005 D2), its 4096-token default (spec 005 D5), and its developer probe with `resolveWithDefer` and `resolveLiveRoutes` (spec 006 D11).
- `claude-source/codex/` (spec 006 D12), codex-plugin itself, and the Kimi and Gemini companions. No backport.

## Acceptance criteria and test plan

Unit tests with stubs only. No automated test makes a network call or a paid request. Tests that start a real process remove `XAI_API_KEY` from its environment.

- **New file `tests/setup-catalog-credentials.test.mjs`**, imported from `tests/index.mjs`. Tests 1 to 6, 12 and 14 use the `harness`. Tests 7 to 9 call `preflight`, `toParts`, `transcribeAudio` through `createMedia`, and `riskyDiff`. Tests 10 and 11 use a job store in a temporary folder, with files aged by `utimesSync`.
  1. `setup`, all kinds live: exit 0, `catalogSources` is `{ language: { source: "live" }, image: { source: "live" }, video: { source: "live" } }`, and there is no `message` field. The gate fields are still present. From `codex-plugin/tests/setup.test.mjs:21-37`. Proves R1.
  2. `setup` with one kind failing with `network`: exit 0, `apiReachable: false`; with a warm cache that kind is `{ source: "cache-stale", error_class: "network" }`, and cold it is `{ source: "fallback", error_class: "network" }` with a `fallback` route. From `:39-55`. Proves R1.
  3. `setup` with every kind failing with `auth`: the full report, exit 2, and `message` equal to the R2 text as the last field, warm and cold. A `usage` failure with "Incorrect API key provided" on every kind: the same. With one kind failing with `auth`: exit 0, that kind reported, no `message`. Without a key: exit 2 and no `message`. From `:57-75, 99-104`. Proves R2 and D9.
  4. Warm cache, `ask q --model grok-nope`: exit 8, and the only catalog call is `/language-models`. With the catalog failing: exit 0, one call, the model sent unverified. A catalog fetched live in this run: exit 8 with three calls and no refetch. From `codex-plugin/tests/pins.test.mjs:29-60`. Proves R3.
  5. Warm cache with three unknown pins, `rescue --coding scope`: exit 8 and exactly one refetch, of the language kind. An aged cache with a failing language kind: three calls and no refetch, for `ask --model` and for `setup`. Mixed freshness: `["/image-generation-models", "/language-models"]`. An id missing from the cache but listed live is used after one call. From `:148-183`. Proves R3.
  6. `GROK_COMPANION_MODEL_STRONG=" grok-4.6 "`: `adversarial-review` sends `grok-4.6` with `routeSource: "env"`. A pin of spaces only: the role route, `routeSource: "live"`. From `:185-189`. Proves R4.
  7. `preflight("", { sourcePath })`. Proves R6, D1 and D2:
     - refused: `.env`, `.env.local`, `.env.production`, `x.env`, `x.env.png`, `.envrc`, `server.key`, `cert.pfx`, `cert.p12`, `a.ppk`, `a.jks`, `a.keystore`, `id_ed25519`, `id_ed25519.pub`, `id_ecdsa`, `id_dsa`, `.npmrc`, `.netrc`, `_netrc`, `.pypirc`, `C:\Users\a\.npmrc`, `/home/a/.ssh/id_ed25519`, `id_rsa`, `key.pem`, `a/credentials/x.png`, and each in upper case;
     - allowed: `a.environment.png`, `my.envelope.txt`, `.env-prod`, `.env_local`, `.env2`, `keyboard.png`, `monkey.jpg`, `a.keys`, `notes.npmrc.md`, `key.txt`, `src/index.js`.
  8. The callers, with real files in a temporary folder. Proves R6 for each row of its table:
     - `toParts` refuses `cert.p12` and `photo.key` (PNG bytes) with no read, and accepts `a.environment.png`;
     - `video --from-image` and `imagine --source` through the CLI with the real `toParts` and a stubbed media layer exit 9 for `id_ed25519.png`, with zero media calls and zero job records;
     - `transcribeAudio` refuses an MP3 under a folder named `id_ed25519` and a file named `.netrc`, both before any upload, and its path check accepts `voice.key.mp3`, because `.key` is not at the end;
     - `speak --text-file .npmrc` exits 9 with zero media calls;
     - on Windows, `cert.pem.` (trailing dot) is refused through its real path; the case skips when the OS does not resolve the name.
  9. `riskyDiff` with a harmless changed line. Proves R7:
     - `secrets` for the paths `config/x.env`, `certs/a.p12`, `a.ppk`, `.npmrc`, `.netrc`, `.pypirc`, `keys/id_ed25519`, and still for `config/.env.local`, `a.pem`, `a.key`, `a.pfx`, `src/apiKey.js`;
     - routine for `src/environment.js`, `docs/a.environment.md` and `config/.env-prod`;
     - every pattern in the shared list is also refused by `preflight` as a file name.
  10. `sweep()` on side files. Proves R8 and D10:
      - a claim and an answer file older than 1 hour are deleted for a `done`, `failed` and `abandoned` job, and for a job with no job file; (review fix) they stay for a `submission_unknown` job;
      - an old lock that holds the pid of an ended process is deleted; an old `.stale` and an old `.tmp` file are deleted;
      - every side file younger than 1 hour stays, whatever its job's state;
      - the returned counts equal the files deleted, per kind.
  11. `sweep()` on job records, live jobs and held locks. Proves R8, D4 and GP 5:
      - a `done`, `failed` and `abandoned` job last written 8 days ago is deleted (review fix: a `submission_unknown` job stays) with its claim and answer files, and `getJob` then returns `null`;
      - the same jobs last written 6 days ago stay;
      - a `created`, `running`, `submitted` and `unknown` job last written 30 days ago stays, with its claim and answer files;
      - a `running` text job with an unapplied answer file, aged 30 days: both files stay, and `result --id` still prints the answer;
      - a `created` job with a claim, aged 30 days: the claim stays, and `status --id` still reports `submission_unknown`, not `not_started`;
      - a `done` job aged 8 days whose lock holds this test's own live pid and was just written: the record, its side files and the lock stay, and `updateJob` by the holder still succeeds;
      - a `done` job aged 8 days that another writer changes to a fresh write between the list and the lock stays (the second read under the lock);
      - a folder entry that cannot be read or deleted does not make `sweep()` throw;
      - a failed job `write` (the target is a folder) leaves no `.tmp` file and still throws.
  12. `status` through the CLI. Proves R8 and D5:
      - `sweep` returns non-zero counts: the first line is `{"pruned":{...}}` with those counts, and the last line is the job list;
      - `sweep` returns all zeros: one line only, equal to today's output;
      - `sweep` throws: one line, the list, exit 0;
      - `status --id`, `result --id`, `cancel --id`, `video` and a `--background` run make zero `sweep` calls.
  13. `writeCache` with a folder where the cache file should be: the load succeeds and no `.tmp` file is left. `loadCatalog({ env, home })` with no request function leaves a broken cache file byte-identical, creates no file in a new home, and returns `error: "network"` for every kind. `writeConfig` with a folder where `config.json` should be throws and leaves no `.tmp` file. From `codex-plugin/tests/models.test.mjs:205-216, 230-240`. Proves R5 and D10.
  14. `video scene --seconds 2 --from-image C:/photo.png` with a stubbed `toParts`: without `--confirm-cost`, exit 9 and the message holds the image-input estimate; with it, the first printed line is the same estimate. The same for an `https://` value. Without `--from-image`, both texts equal today's. Proves R9. The expected text follows the T10 step 4 result, or the D6 fallback.
- **`tests/support/harness.mjs`:**
  - the `catalog` option also takes `{ fail: [kinds], error_class }`, so one kind can fail with a chosen class (as `codex-plugin/tests/support/harness.mjs:6`). `catalogCalls` stays a list of paths;
  - the `jobs` stub gains `sweep`, which records its calls and returns zero counts.
- **`tests/cli.test.mjs`:**
  - lines 82-96 ("an unknown id refetches a cached catalog once"): `reject.catalogCalls` is `["/language-models"]`, not three calls;
  - lines 189-194 ("setup exits with the auth code"): still exit 2; the last line is the report with `catalogSources.language` equal to `{ source: "fallback", error_class: "auth" }` and the `message` field, not an error object;
  - lines 110-114 (`status`, `result`, `cancel` print JSON) pass unchanged: the list is still the last line;
  - lines 123-143 and 166-187 pass unchanged.
- **`tests/parity-gaps.test.mjs`:** test 17 (lines 359-367) keeps both exit codes; its assert on `error_class` changes to the report form, and its message assert reads the `message` field. Tests 5, 14 and 14b pass unchanged: their names (`.env.png`, `credentials.jpg`, `credentials-x`) are still refused. Tests 16, 19 and 22 to 24 are run again; a test that overrides the `jobs` stub and runs `status` is safe, because a missing `sweep` is caught.
- **`tests/models.test.mjs`:** lines 193-210 are split as in codex-plugin (`codex-plugin/tests/models.test.mjs:198-228`), because the no-request call no longer rewrites a broken cache file. Lines 212-217 gain the no-temp-file assert. Lines 148-191 and 219-278 pass unchanged.
- **`tests/jobs.test.mjs`:** lines 59-66 ("gc removes expired job records") are removed with `gc`; the case moves into test 11 with a finished job. The other six tests pass unchanged.
- **`tests/background-gate.test.mjs`:** line 252 (`config/.env.local` is `secrets`) passes unchanged. Tests 26 to 29 are run again against the shared list.
- **`tests/scrub.test.mjs`** (`.env.production` is refused), `tests/attach.test.mjs`, `tests/speak-transcribe.test.mjs` (`.env.mp3`, `credentials.mp3`, `.env`), `tests/api.test.mjs`, `tests/media.test.mjs`, `tests/image-edits.test.mjs`: pass unchanged. Their temporary folders hold no new credential word.
- **`tests/cost-gate-max-tokens.test.mjs`** (lines 101, 125) and `tests/cli.test.mjs` line 105: pass unchanged; none uses an image input.
- **`tests/packaging.test.mjs`:** lines 34-36 expect version `0.1.7`.
- **`tests/index.mjs`:** import the new file.
- New and changed tests fail before the change and pass after it. All other tests still pass, and the three JSON manifests parse.
- **Live check (D11).** See T10. Each run needs Gary's go-ahead at that moment. Approval of this spec does not authorize it.

## Files to touch

- `scripts/grok-companion.mjs`: `catalogContext` with the once-only single-kind refetch, and the refetch condition and trimmed pin in `selectRoute` (R3, R4); the `setup` report, exit code and `message` (R1, R2); the temp-file removal in `writeConfig` (R5); the `sweep()` call and the `pruned` line in the `status` branch (R8); the estimate text in `commandVideo` (R9).
- `scripts/lib/models.mjs`: `only`, the no-request path, the failure-window class, and `writeCache` (R3, R5).
- `scripts/lib/scrub.mjs`: the pattern and the exported file-name list (R6, R7).
- `scripts/lib/risk.mjs`: the shared list in the `secrets` category (R7).
- `scripts/lib/jobs.mjs`: `sweep()` in place of `gc`, the shared stale-lock helper, a single-try lock for the record delete, and the temp-file removal in `write` (R5, R8).
- `scripts/lib/api.mjs`, `scripts/lib/attach.mjs`, `scripts/lib/media.mjs`, `scripts/stop-review-gate-hook.mjs`, `scripts/print-routing-policy.mjs`, `hooks/hooks.json`, `agents/grok-rescue.md`: no change. The policy version stays `grok-companion-routing-v3`.
- `commands/setup.md`: one sentence: exit 2 means that xAI rejected the key for every catalog; a single failed catalog is reported under `catalogSources` and exits 0.
- `commands/status.md`: one sentence: listing jobs deletes finished job records older than 7 days and leftover side files, and prints the counts first; a `pruned` line is not a job.
- `commands/video.md`: one sentence: with `--from-image` the estimate includes the image input charge.
- `skills/grok-api-runtime/SKILL.md`: the `video` row (line 15), the `status` row and the `setup` row.
- `tests/setup-catalog-credentials.test.mjs` (new); `tests/support/harness.mjs`, `tests/cli.test.mjs`, `tests/parity-gaps.test.mjs`, `tests/models.test.mjs`, `tests/jobs.test.mjs`, `tests/packaging.test.mjs`, `tests/index.mjs`.
- `README.md`:
  - lines 164-167 (Overrides): a pin is trimmed, and an empty pin is ignored;
  - lines 171-174 (Cost guards, `video`): the image input charge in the estimate, with its date and evidence;
  - line 190: the `secrets` row;
  - lines 243-246 (Security model): the credential names that are refused, and the `.env` rule with the three allowed forms;
  - lines 250-251: job records are kept for 7 days after they finish, then deleted by `status`;
  - lines 274-284 (Troubleshooting): a row for `setup` exit 2 and for a single failed catalog;
  - line 282: "credential word" points to the Security model list;
  - lines 314-315 (Architecture): `jobs.mjs` prunes finished records and side files;
  - lines 351-353 (Known limitations): remove "the cost estimate does not rise for an image input";
  - lines 361-363: replace "Lock and answer files left by a killed process are not pruned" with the R8 rule;
  - lines 368-370: replace "until deleted" with the 7-day rule, and say that an unread answer older than 7 days is lost;
  - add the limits from "Accepted limits".
- `.claude-plugin/plugin.json`: version 0.1.7. `.claude-plugin/marketplace.json`: no change.
- `specs/006-parity-gaps/spec.md`: one dated note under "Parity status": item 3 is closed by spec 007, and item 4 is decided against by spec 007 D7 and D8. Nothing else in that spec changes.
- Changelog: none, as in specs 004 to 006.

## Plan

One PR on branch `feat/setup-catalog-credentials`. Tests come first in each step. T1 to T9 and T11 start only after Gary approves this revision. T10 needs its own go-ahead for each run.

- T1. Create the branch from `main`.
- T2. Catalog and temp files (R3, R4, R5): extend the harness, add tests 4 to 6 and 13, change `tests/models.test.mjs` and `tests/cli.test.mjs` lines 82-96, confirm they fail, then change `models.mjs`, `catalogContext`, `selectRoute` and `writeConfig`.
- T3. `setup` (R1, R2): add tests 1 to 3, change `tests/cli.test.mjs` lines 189-194 and test 17, confirm they fail, then change the `setup` branch.
- T4. Credential paths (R6, R7): add tests 7 to 9, confirm they fail, then change `scrub.mjs` and `risk.mjs`. Run the whole suite here: a temporary path that matches the new pattern would show now.
- T5. Pruning (R8): add tests 10 to 12, move the `gc` test, confirm they fail, then change `jobs.mjs` and the `status` branch.
- T6. Estimate (R9): add test 14, confirm it fails, then change `commandVideo`. This step waits for T10 step 4, or for Gary's "no" to it (then the D6 fallback text).
- T7. Command files, README, skill, the spec 006 note, version 0.1.7, `tests/index.mjs`, `tests/packaging.test.mjs` (R11).
- T8. Full suite and the JSON check: Haiku subagent. It runs `node tests/index.mjs` and `node --test tests/` three times, reads the full logs, and returns the failures with their decisive lines and any file left in a temporary jobs folder.
- T9. Review.
  - Code review: Sonnet subagent, with the diff and the scripts it changes (`grok-companion.mjs`, `lib/jobs.mjs`, `lib/models.mjs`, `lib/risk.mjs`, `lib/scrub.mjs`), plus `lib/attach.mjs` and `lib/media.mjs` as callers.
  - Gemini second opinion: yes. The session rule allows it only for a large or risky diff. This diff is risky on two counts: it changes a secret check and allows three name forms that are refused today (R6), and it deletes job records that hold paid answers (R8, data). It is medium in size, about 200 changed source lines. It holds no confidential code; the repository is public.
- T10. Live check (D11). Ask Gary for the go-ahead at that moment, once for the unbilled steps and once more for step 4. Run only on a yes and record each result. On a no, record "no live test" for that part.
  1. `setup` on the installed 0.1.6 and on the branch. Confirm the same five routes, exit 0, `catalogSources` with three `{ source: "live" }` objects, and no `message`. Unbilled.
  2. `setup` on the branch with `XAI_API_KEY` set to a made-up value in that one child process only. Confirm the full report, `error_class: "auth"` for every kind, the `message` field, and exit 2. Unbilled; xAI rejects the key before any work. The real key is not used or printed.
  3. With a warm cache, `ask x --model grok-nope`. Confirm exit 8 and no answer. Unbilled: only one catalog GET is sent.
  4. Paid: `video --seconds 2 --from-image <the 256×256 PNG of spec 006> --confirm-cost`, then `status --id` until `done`. Record `usageTicks`: 1,700,000,000 means a flat $0.01 per image, and 1,800,000,000 means $0.01 more per second. $0.17 or $0.18. Any other value is reported to Gary before R9 is implemented. This step can run before T6 on `main`'s 0.1.6, because it needs no code from this spec.
  - The pruning and the credential paths are not in the live check. Their tests need no request. The live `status --id` in step 4 does not prune.
- T11. Write the Results section. Commit, open the PR, merge to `main`, and update the installed plugin to 0.1.7.

REA: not applicable. This ports existing behaviour from codex-plugin and fixes local checks.

## Accepted limits (proposed)

Credential paths:
- **`.env-prod`, `.env_local` and `.env2` are allowed (D1, Gary's choice).** They are refused today. A file with such a name is caught only when its text is secret-shaped (`scripts/lib/scrub.mjs:1-9`), and it no longer makes a diff risky by its name.
- `.envs` and `.environment` are allowed too.
- The list is names, not content. A key in a file called `notes.txt` is caught only when its text is secret-shaped.
- `.key` also refuses an Apple Keynote file. Such a file is a zip and is already refused as a binary document.
- `id_ed25519.pub` and other public keys are refused with their private keys, as `id_rsa.pub` is today.
- `credentials` and `id_*` still match a folder name anywhere in the real path (spec 006 F8).
- Each new name can refuse a harmless file that has it, such as a Java `.keystore` test fixture.
- A hard link to a credential file still cannot be detected (spec 006).
- An NTFS alternate data stream name (`x.pem::$DATA`) was not checked.
- claude-source now differs from codex-plugin here: stricter on the new names, looser on the three `.env` forms. No backport.

`setup`:
- A key that xAI rejects for one catalog and accepts for the others exits 0. The report shows it under `catalogSources`.
- A script that read `catalogSources` as a string must read `.source` now.

Pruning:
- **An unread paid answer older than 7 days is lost (D4, Gary's choice).** A finished text job keeps its answer only in its record. When `status` lists jobs 7 days after the last write, the record is deleted and the answer cannot be fetched again without a new, billed request.
- A finished video job's record is deleted too. Its saved file stays in the media folder, but `result --id` then says `job not found`. A video that was never downloaded can no longer be fetched through the plugin.
- `status` with no `--id` is no longer read-only.
- A user who never runs a bare `status` never prunes.
- A job that stays `created`, `running`, `submitted` or `unknown` for ever is never pruned, with its claim and answer files. This includes a text job whose worker was killed and a video job that was never polled again.
- The age is the job file's modification time. A copied or restored jobs folder has new times, so pruning starts 7 days later.
- The 7 days cannot be configured.
- A script that reads the first line of `status` output sees the `pruned` line when something was deleted. The job list is always the last line.

Estimate:
- The image charge rests on two measurements at most, on one model and one small PNG. A larger image or another model may cost more. The line stays marked as an unverified estimate.
- If the paid run is declined, the number is still too low and only the words warn of it.

Transport (D7, D8):
- An error body has no size limit when the call gives no `maxBytes`.
- A body that stalls after the headers ends at the timeout only because Node's fetch aborts it; nothing in the plugin forces that.
- A library user cannot tell a cancel from a timeout, and a cancelled GET says `retryable: true`.

## Open questions

None. Q1 to Q11 of rev 1 are settled as D1 to D11.

## Decisions

Jev values are as reported with Gary's answers on 2026-11-22. "Jev pick adopted" means confidence above 0.70. At 0.70 or below, Gary decided. Where only the top probability was reported, only that one is shown. All decisions are dated 2026-11-22.

| Id | Choice | Decided by | Jev pick, confidence and probabilities |
|---|---|---|---|
| D1 The `.env` rule (Q1) | `.env` as a whole dot-separated part, plus `.envrc`. `.env-prod`, `.env_local` and `.env2` become allowed. | Gary | `whole_part`, 0.14: whole_part 0.43, not_followed_by_letter 0.36, keep 0.21 |
| D2 Names to add (Q2) | The six (`.key`, `.pfx`, `.p12`, `id_ed25519`, `.npmrc`, `.netrc`) plus `id_ecdsa`, `id_dsa`, `_netrc`, `.pypirc`, `.ppk`, `.jks`, `.keystore`. | Gary | `six_plus`, 0.56: six_plus 0.71, none 0.20, six 0.09 |
| D3 One source for `scrub.mjs` and `risk.mjs` (Q3) | One shared file-name list, exported by `scrub.mjs`. | Jev pick adopted (> 0.70, within the approved scope) | `shared`, 0.82: shared 0.88, leave_risk 0.09, two_lists 0.03 |
| D4 What is pruned (Q4) | Side files, plus finished job records older than 7 days with their side files. Never a live job, a held lock, or the answer file of a job still running. (review fix) "Finished" for pruning means `done`, `failed` or `abandoned`; a `submission_unknown` job is never pruned, as Gary's approval of rev 2 says ("`submitted` and unknown jobs never pruned"). | Gary | `plus_7d`, 0.20: plus_7d 0.40, plus_30d 0.25, side_files 0.20, nothing 0.15 |
| D5 When pruning runs (Q5) | When `status` lists jobs. `status` prints what it pruned, as counts. | Gary | `on_status`, 0.18: on_status 0.45, both 0.38, on_create 0.17 |
| D6 Video estimate with an image input (Q6) | Measure with one 2-second image-to-video run, then set the number. If the paid run is declined, add a note in words and keep the number. | Gary | `measure`, 0.61: measure 0.71 |
| D7 External cancel signal (Q7) | Not ported. | Gary | `decline`, 0.56: decline 0.71, port_library 0.26, ctrl_c 0.03 |
| D8 Error-body cap and raced body reads (Q8) | Neither is ported. | Gary | `neither`, 0.44: neither 0.63, both 0.19, cap_only 0.18 |
| D9 Key-rejected message in `setup` (Q9) | Add the `message` field to the report when the exit code is 2. | Gary | `add_message`, 0.42: add_message 0.71 |
| D10 Temp-file fix (Q10) | All three writers (catalog cache, `writeConfig`, job `write`), and pruning also removes old `.tmp` files. Gary's own option. | Gary | Tie, 0.00: 0.50 and 0.50 |
| D11 Live check (Q11) | The unbilled steps 1 to 3 plus the paid 2-second step, about $0.17 to $0.18. Each run still needs Gary's go-ahead at that moment. Spec approval does not authorize it. | Gary | `unbilled_plus_paid`, 0.48: unbilled_plus_paid 0.65 |

D1, D4, D5 and D8 override the rev 1 recommendation. D10 is a custom option that Jev did not list. In D10, "old `.tmp` files" is read as the temp files in the jobs folder, which `sweep()` covers; cache and config temp files are removed at the failed write. The replacement of `gc` by `sweep()`, the single-try lock for a record delete, and the place of the `pruned` line are design details inside D4 and D5 and were not rated.

Inherited and settled: spec 006 D13 (this spec ports the setup and catalog details), spec 004 D3, spec 005 D2 and D5, spec 006 D11 and D12.

## Implementation notes

Recorded during T2 to T7 (2026-11-22). Each is the smallest choice that keeps the spec's intent.

- (impl note) **R8 counts.** The spec names five counts but not where `<id>.json.lock.<uuid>.stale` goes. A moved-aside lock counts under `locks`; `<id>.json.<uuid>.tmp` counts under `temp`.
- (impl note) **R8 order.** `sweep()` makes two passes over one folder listing: side files first, then job records. An old claim or answer file of an expired finished job is therefore usually deleted by the side-file pass. The record delete still runs under the single-try lock, reads the state and age again, and deletes claim, answer and job file in that order. The counts are the same either way. A stale lock left on an expired record is removed in the first pass, so that record is pruned in the same run.
- (impl note) **R8 lock helper.** The take-over steps of `update` became `takeOverStale(lock)`, returning `removed`, `gone` or `kept`. The open-and-write-pid step became `openLock(lock)` (one try) and the release step `releaseLock`. `update` keeps its 100 tries and 10 ms waits; `sweep()` calls `openLock` once.
- (impl note) **R6 pattern.** `scrub.mjs` exports `CREDENTIAL_FILE_NAMES` (four patterns), and `CREDENTIAL_PATH` is built from them plus `credentials`. It matches the same names as the proposed pattern. The `id_*` pattern matches anywhere in a name, so `valid_dsa.txt` is refused too, as `paid_rsa.txt` was before.
- (impl note) **R9 constant (D6).** T10 step 4 has not run. `IMAGE_INPUT_ESTIMATE` in `scripts/grok-companion.mjs` is the one place the image charge enters the estimate. It holds the D6 fallback words, so the number stays `seconds × $0.08`. After T10 step 4 it is replaced by the measured amount, and test 14's `IMAGE_NOTE` with it. (Done after T10 step 4: `IMAGE_INPUT_USD = 0.01`, a flat charge; see Results.)
- (impl note) **Test 8, trailing dot.** On this machine Node does not resolve `cert.pem.` to `cert.pem` (`statSync` and `realpathSync.native` give `ENOENT`), so the case skips as the spec allows. `toParts` then reports `file not found`; nothing is read or sent.
- (impl note) **Test 11, the lock holder.** A test cannot hold the lock inside `update`. The test writes a lock with its own pid, runs `sweep()`, then releases the lock (deletes the file) and calls `updateJob`, which succeeds. The "another writer" case patches `fs.openSync` to refresh the job file just before `sweep()` opens the lock.
- (impl note) **Test 13, failure window.** The window's `network` class is checked after a failed load with class `auth`, so the test tells the window's class from the stored one.
- (impl note) **`tests/models.test.mjs`.** Split into three tests: no key; no request function (the broken cache file stays byte-identical); invalid cached ids. The last now warms the cache with a live load first, because the no-request call no longer writes it.
- (impl note) **Jev.** Jev unavailable (no-network rule); design details inside approved decisions.
- (impl note, review fix) **Names.** `sweep()` matches only `<uuid>.json` records and the five side-file names with UUID ids, because `createJob` always uses `crypto.randomUUID()`. A store built with a custom `idFactory` that makes non-UUID ids is never pruned.
- (impl note, review fix) **Side-file lock.** A claim or answer file is deleted only under its job's lock, taken at the first try. A claim beside a lock that is stale but not yet removed waits for the next `status`.
- (impl note, review fix) **Young locks.** The review asked that a young lock with an ended pid be removed. The spec's side-file rule says a side file younger than 1 hour is never touched, so it stays until it is 1 hour old; test 10 proves it stays. An old lock with a live pid is stale after 30 seconds (`staleLock`) and is removed, as the spec says.
- (impl note, review fix) **`listJobs`.** A job file that vanishes between the folder listing and its read (a concurrent `sweep()`) is skipped; any other read error still throws, as before.
- (impl note, review fix) **Header paths.** `riskyDiff` trims trailing whitespace from a `---`/`+++` path before unquoting it, because git ends a path that holds a space with a tab.

## Results (2026-11-22)

- **Implementation.** T2 to T9 were done test-first; the deviations are listed under "Implementation notes".
- **Tests.**
  - `node tests/index.mjs` and `node --test tests/` each ran 198 tests: 195 pass, 0 fail, 3 skipped. Before this spec there were 180.
  - The 3 skips are cases this Windows machine cannot set up: two file-symlink cases, and a trailing-dot path that Node does not resolve.
  - A Haiku 5.5 subagent ran the suite three times. There were no flaky tests, the real jobs folder was unchanged before and after, no `.tmp` file was left, and no worker process remained.
  - `codex/` passed 68 of 68 and is unchanged.
- **Review.** A Sonnet 5.5 subagent's findings were fixed test-first (tests 10, 11, 15, 15b and 15c):
  1. `sweep()` deleted non-job files in a shared `GROK_JOBS_DIR`: any old `.tmp`, `.stale`, `.claim` or `.answer.json` file, and any `.json` file with a terminal `state`. It now matches only the store's exact UUID file names, and checks the record's `id` and required fields before deleting.
  2. The shared credential list missed `---` and `+++` header paths that git ends with a TAB when the path contains a space (for example `my dir/.env`). This was a regression from the old `/^\.env/` rule. Header paths are now trimmed before matching.
  3. Pass 1 treated any stat error as "job missing" and deleted claim and answer files without taking the lock. Now only ENOENT counts as missing, and each delete takes the job's lock in a single try.
  4. `submission_unknown` jobs were pruned. That went against Gary's approval ("`unknown` never pruned"), so they are now kept.
  5. `listJobs` could throw while a concurrent sweep ran. It now skips a file that disappears between the listing and the read.
  6. The lock tests now prove the live-pid case, the real-holder case, the young and the old lock, and junctions.
- **Gemini second opinion.** gemini-3.8-flash and gemini-3.5-flash-lite reviewed the code before the review fixes and found it sound, with no findings. Cost $0.124. Gemini did not catch findings 1 to 4.
- **Live check (D11).** Gary gave the go-ahead on 2026-11-22, once for the unbilled steps and once for step 4.
  1. `setup` on 0.1.6 and on the branch gave the same five routes (fast `grok-4.3`, strong `grok-4.7`, coding `grok-4.5`, image `grok-imagine-image-2.0`, video `grok-imagine-video-1.5`). Both exited 0 with no `message`. The branch showed `{ source: "live" }` for all three kinds. Unbilled.
  2. `setup` with a made-up key, set only in that one child process, reported `{ source: "fallback", error_class: "auth" }` for every kind, included the `message` field, and exited 2. A `setup` straight after with the real key showed all kinds live, so the failed run left no failure in the cache. Unbilled.
  3. `ask x --model grok-nope` returned `capability_unavailable`, exited 8 and gave no answer. Unbilled.
  4. Paid: a 2-second `video --from-image` with the same 256×256 PNG used in spec 006 reached `done` in about 20 s. `usageTicks` was 1,700,000,000, that is $0.17. With the 1-second job at $0.09, this shows the image input charge is a **flat $0.01 per job**. T6 was then finished:
     - `IMAGE_INPUT_USD = 0.01`;
     - the estimate reads `2 × $0.08 + $0.01 image input = $0.17`;
     - test 14 and the docs were updated.
  - Total live spend: $0.17.
- **Release.** Version 0.1.7.

## Parity status after this spec

claude-source then has full parity with codex-plugin, except where Gary decided against it. Every codex-plugin command, flag, routing rule, setup rule, catalog rule and safety check is in claude-source. No codex-only item is left open or undecided.

codex-plugin can do these and claude-source cannot, each by a recorded decision:

1. **`--out` as a full path.** claude-source keeps the base name and saves in `~/.grok-companion/media` (spec 004 D3).
2. **A JSON cost line for `video`** (spec 005 D2) and **a default output limit of 4096 tokens** (spec 005 D5).
3. **A developer probe**, with `resolveWithDefer` and `resolveLiveRoutes` (spec 006 D11).
4. **A cancel signal as a library option** for API calls, speech, transcription and downloads, with a "canceled" message (spec 007 D7). No codex-plugin command uses it. claude-source's API calls accept a signal and abort on it, but do no more.
5. **A 64 KiB cap on error bodies and body reads raced against the timeout** (spec 007 D8).

Two differences are not missing features:

- codex-plugin reports `priceChanged: null` for an explicit model; claude-source reports the real value (spec 001 FR-005).
- codex-plugin refuses `.env-prod`, `.env_local` and `.env2` as attachment names; claude-source allows them (spec 007 D1).

claude-source can do these and codex-plugin cannot:

1. Slash commands, the SessionStart routing policy, and the per-repository stop-review gate with its risky-diff rule.
2. `--background` on the five text commands, with `status`, `result` and a `cancel` that stops only a verified worker; a paid background answer kept when the job lock is busy.
3. A per-command flag table, the `--` terminator, and strict integer parsing.
4. A `video` refusal that shows the computed total, `--from-image` checked before the cost gate and for secrets in a URL, and the provider job id kept when `--wait` fails.
5. `speak --text-file`; relative paths for `transcribe --file`; a verified `transcribe --model`; transcripts inside the untrusted envelope.
6. Windows fixes: the native real path for credential checks, `O_NONBLOCK` handled when it is undefined, and lock take-over that survives a killed process.
7. A refusal of a diff over the 10 MB read limit; a downloaded artifact that is never lost to a bad name; `--out` checked before a billed image; "may have been billed" notes on errors after a sent request.
8. After this spec:
   - a wider credential-path list: `.key`, `.pfx`, `.p12`, `.ppk`, `.jks`, `.keystore`, `id_ed25519`, `id_ecdsa`, `id_dsa`, `.npmrc`, `.netrc`, `_netrc`, `.pypirc`;
   - a `.env` rule that no longer refuses `a.environment.png`;
   - one list of credential file names for the path check and the risk rule;
   - pruning on `status`: finished job records older than 7 days and leftover claim, answer, lock and temp files, with the counts printed (codex-plugin's `gc` is never called);
   - no temp file left by a failed job or config write;
   - a video estimate that includes the image input charge;
   - a key-rejected message in the `setup` report.
