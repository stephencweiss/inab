# Slice 2: YNAB Bootstrap Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Follow the repository's red-green-refactor convention. Do not implement from the earlier planning draft.

**Goal:** Offer start fresh or one YNAB migration during initial setup, with complete source history, guided review, safe atomic import, and later historical inspection.

**Architecture:** File adapters read and validate the two CSVs and a private review file. Pure rules derive row decisions and balance evidence; application operations commit through one storage transaction. Source history remains distinct from live ledger entries, manual snapshots, and future envelope calculations.

**Tech Stack:** Existing Node.js 24.16.0, TypeScript, Drizzle ORM, better-sqlite3, Vitest, and pinned `csv-parse@7.0.3` (to be installed during implementation).

Status: implementation executed October 22, 2026; automated verification passed locally and user manual review is pending. The tasks below record the approved plan. See the execution record for test evidence and implementation adjustments. Worktree: `/Users/sweiss/.codex/worktrees/slice-2/inab`; branch: `codex/slice-2-ynab-import`; starting commit: `e7e60bf`.

## Read before work

The [Slice 2 design](../specs/2026-10-22-slice-2-bootstrap-import-design.md) defines the full command, review-file, parsing, and storage contracts. The [project design](../specs/2026-10-17-inab-design.md) owns the roadmap. Read the [setup-only decision](../../decisions/2026-10-21-ynab-bootstrap-only.md), [opening-history decision](../../decisions/2026-10-20-import-opening-history.md), [Tracking decision](../../decisions/2026-10-20-tracking-balance-adjustments.md), and [verification guide](../../verification.md).

Read the conventions for [interfaces](../../conventions/interfaces.md), [types](../../conventions/type-inference.md), [helpers](../../conventions/utilities.md), [comments](../../conventions/jsdoc.md), [database access](../../conventions/database-access-rules.md), [schema](../../conventions/database-schema.md), [feature maps](../../conventions/feature-map.md), [private data](../../conventions/agent-safety.md), and [red-green development](../../conventions/red-green-development.md).

Keep the unrelated files in the original checkout and quality-gate worktree unchanged. Do not fetch another branch's tooling changes into this task. All dates in examples are synthetic; inject the clock rather than relying on the host date.

## Fixed product rules

- Migration requires an empty database with setup open. Confirming start fresh closes migration even if no accounts exist. Existing household data/audit history blocks migration. Init/schema metadata is permitted.
- Review can pause and resume outside the database. Successful import and setup completion are one transaction. A repeated successful confirmation writes nothing. No later YNAB import or merge is available.
- Preserve identical purchases, zero rows, blank source text, flags, monthly source values, original bytes, and source row identity. Do not infer account class, split parents, transfer identity, bank posting dates, or observed balances.
- Every account is new to this setup. Confirm Cash/Credit/Tracking and closed state. Cash/Credit require explicit opening values. Source history included in that opening remains outside the live register.
- Tracking observations are day-end closing balances. Retain one per account/day, selected by the user. Confirmed posted activity through the effective date precedes its adjustment; pending activity is excluded. Unknown posting remains unverified.
- Preserve a source adjustment once. The observed balance is a target, not another transaction. Changes to covered evidence flag review; adjustment revision requires explicit user confirmation and preserved audit history.
- General manual Tracking commands and provider updates remain future work. Slice 2 implements these rules only for bootstrap and historical inspection. Existing manual snapshots/CLI workflows remain available.

## Source inspection and package evidence

Read-only format inspection found a BOM in both files, `MM/DD/YYYY` register dates, English `Mon YYYY` plan months, dollar amount strings, source clearing labels, exact duplicate rows, zero movements, blank payees/categories, and a multiline quoted field. No transaction IDs, posting dates, split parent IDs, or observed balances are supplied. Tests must recreate these shapes from new synthetic values, never copy household rows.

Package registry lookup on October 22, 2026 returned `csv-parse` version `7.0.3`. Use its [sync API](https://csv.js.org/parse/api/sync/) and [options](https://csv.js.org/parse/options/) through the adapter. Pin this version; do not add a custom CSV splitter. No source files were uploaded to the registry or documentation service.

## File responsibilities

All paths in this table are relative to the worktree and proposed unless already installed.

| Files | Responsibility |
| --- | --- |
| `src/adapters/ynab/csv.ts`, `src/adapters/ynab/values.ts` | Bounded CSV decoding and external value validation |
| `src/adapters/ynab/files.ts`, `src/adapters/ynab/review-file.ts` | File identity, source bytes, private review IO and locking |
| `src/accounts/imports/types.ts`, `review.ts`, `report.ts`, `tracking.ts` | Pure validated decisions, dispositions, accounting, and Tracking evidence |
| `src/application/setup-ports.ts`, `setup.ts` | Setup state and application-owned contracts |
| `src/application/import-ports.ts`, `import-review.ts`, `imports.ts`, `import-history.ts` | Guided review, one-shot commit, and history queries |
| `src/storage/schema/setup.ts`, `import-sources.ts`, `import-history.ts`, `import-observations.ts` | Explicit Drizzle tables and inferred stored row types |
| `src/storage/setup.ts`, `import-review-state.ts`, `imports.ts`, `import-history.ts` | Setup guards, empty-target identity, atomic commit, snapshot queries |
| `src/cli/setup-parse.ts`, `setup.ts`, `imports.ts`, `import-history.ts` | Dedicated command parsing, prompts, output and exit codes |
| `src/bootstrap.ts` | Sole composition point |
| `src/cli/main.ts`, `src/cli/parse.ts` | Route the new command families without expanding every legacy command field |
| `src/storage/accounts.ts`, `src/storage/database.ts` | Atomic fresh-selection compatibility and setup initialization |
| `scripts/checks/boundaries.ts`, `tests/policy/boundaries.test.ts` | Check nested pure import rules and adapter permissions |
| `tests/fixtures/ynab/`, `tests/helpers/ynab.ts` | Synthetic sources and review builders |
| `tests/unit/ynab-*.test.ts`, `tests/integration/import-*.test.ts`, `tests/cli/setup*.test.ts`, `tests/cli/import-*.test.ts` | Focused behavior coverage |
| `drizzle.config.ts`, `db/migrations/` | Explicit schemas, generated SQL and metadata |
| `docs/agent/feature_map.json`, `tests/policy/feature-map.test.ts`, `docs/slice-2-demo.md` | Runnable, bounded terminal workflow evidence |

Do not create barrels or empty files to match this table. Split files only at these responsibilities. Pure nested import rules may import their own directory, `src/lib/`, and the two existing pure balance/register modules for canonical live validation; application operations use application-owned ports. The adapter may use the CSV library and Node IO, not write household tables. Storage may use Drizzle/SQLite. CLI reaches concrete services through bootstrap.

## Execution rules

Each task's test step names a real proposed file to create first. Run its exact command and confirm failure for the intended missing behavior, not a broken fixture or unavailable runtime. After the implementation step, rerun the same command and expect all tests in those files to pass. Run any named regressions before the commit. Do not weaken timeouts, skip checks, use real files in tests, or claim a planned test passed.

Use Node.js 24.16.0. If a shell selects another version, select the installed Node 24 runtime first. Existing child-process tests have a ten-second process bound, workflow tests have separate thirty-second limits, and Vitest uses one worker. Partition new CLI scenarios rather than sharing one long timeout. These are documentation-only changes until execution is approved.

Before each commit, inspect the exact staged paths; do not stage private review files, exports, databases, or unrelated work. Each task below has one suggested commit subject. Stage its listed source/test/generated files explicitly.

## Task 1: Bounded CSV parsing and synthetic fixtures

**Create:** `src/adapters/ynab/csv.ts`, `tests/helpers/ynab.ts`, `tests/fixtures/ynab/register.csv`, `tests/fixtures/ynab/plan.csv`, `tests/unit/ynab-csv.test.ts`.
**Modify:** `package.json`, `package-lock.json`.

- [x] Write synthetic header/row builders and the failing parser tests. Include BOM/no BOM, LF/CRLF, header reordering, quoted comma, escaped quote, multiline memo, blank text, exact duplicates, zero movements, duplicate/missing/unknown headers, malformed quote, inconsistent width, invalid UTF-8, empty lines, and size/count limits. Fixtures are entirely new examples.
- [x] Run `npm test -- tests/unit/ynab-csv.test.ts`. Expect missing `parseYnabCsv` or unimplemented behavior; fixture construction must be valid independently.
- [x] Run `npm install --save-exact csv-parse@7.0.3` in this worktree. Implement `parseYnabCsv(role, bytes)` with `bom: true`, strict field counts, `cast: false`, `skip_empty_lines: true`, `raw: true`, record metadata, and a bounded `on_record` callback. Validate the full header array before creating named records; a duplicate header must not overwrite an earlier value. File limit 64 MiB, record limit 1 MiB, record count 250,000 per source. Preserve raw bytes and logical record ordinals; ignore only truly empty lines.
- [x] Rerun `npm test -- tests/unit/ynab-csv.test.ts`; expect PASS. Run `npm run typecheck` and `npm run lint`. Confirm package and lockfile pin exactly 7.0.3.
- [x] Commit listed files: `feat: parse bounded YNAB CSV sources`.

Planned boundary result:

```ts
type CsvResult =
  | { ok: true; value: { headers: string[]; rows: CsvRow[] } }
  | { ok: false; reason: "invalid-csv" | "unsupported-header" | "input-limit" };
type CsvRow = { ordinal: number; fields: string[]; raw: string };
```

The file adapter owns byte hashing. `ordinal` is not a physical line number.

## Task 2: Normalize source amounts, dates, and labels

**Create:** `src/adapters/ynab/values.ts`, `src/accounts/imports/types.ts`, `tests/unit/ynab-values.test.ts`.
**Modify:** `tests/helpers/ynab.ts`.

- [x] Write failing tests for USD values `$1,234.56`, `-$12.34`, `$0.00`, plain decimal compatibility, illegal separators/signs, non-USD symbols, fractional excess, safe-integer boundaries, invalid calendar dates, leap days, explicit US date ordering, English month names, and unsupported clearing labels. Outflow/inflow cannot both be nonzero or negative. Blank payees/categories remain valid history. All amounts remain exact cents.
- [x] Run `npm test -- tests/unit/ynab-values.test.ts`; expect missing normalization behavior.
- [x] Implement `parseRegisterRecord` and `parsePlanRecord` returning validated rows or field errors with ordinal/column/reason and no private field contents. Use strict string normalization, `BigInt`, and existing `parseDate`/`parseMoney`. Do not use `parseFloat` or `Date.parse` on locale text. Use complete types with `postedOn: null` until a review decision supplies evidence; store source clearing label independently. Raw field errors are retained for review and block full-history commit.
- [x] Rerun `npm test -- tests/unit/ynab-values.test.ts tests/unit/ynab-csv.test.ts`; expect PASS. Check that zero movement has cents 0 and is not passed to manual transaction validation.
- [x] Commit: `feat: validate YNAB source values without inventing evidence`.

Representative assertions:

```ts
expect(parseYnabAmount("-$12.34")).toEqual({ ok: true, value: -1234 });
expect(parseYnabDate("10/22/2026")).toEqual({ ok: true, value: "2026-10-22" });
expect(parseYnabDate("02/30/2026").ok).toBe(false);
```

## Task 3: Pure review decisions, source accounting, and boundaries

**Create:** `src/accounts/imports/review.ts`, `src/accounts/imports/report.ts`, `tests/unit/ynab-review.test.ts`, `tests/unit/ynab-report.test.ts`.
**Modify:** `scripts/checks/boundaries.ts`, `tests/policy/boundaries.test.ts`, `tests/helpers/ynab.ts`.

- [x] Write failing tests for source+ordinal identity, identical purchases staying distinct, every row having one primary disposition, blank categories, ambiguous transfers/splits, invalid field blocking, month/group/category conflicts, missing mappings/openings, future/zero row promotion refusal, and preservation of source labels. Add boundary tests showing that `src/accounts/imports/` cannot import parent account files, runtime, adapters, or storage, while application operations can call these pure rules.
- [x] Run `npm test -- tests/unit/ynab-review.test.ts tests/unit/ynab-report.test.ts tests/policy/boundaries.test.ts`; expect failures for new rules.
- [x] Implement `deriveReview(sources, decisions, today)` and `buildImportReport(review)`. Source record identity includes file role, digest, and ordinal. Default to history treatment; promotion requires explicit evidence. Required unresolved mappings, openings, malformed values, or illegal live promotions block commit. Unreconstructable relationships and missing Tracking evidence can remain historical warnings after acknowledgment; acknowledgment cannot bypass a required constraint. Keep duplicate plan rows and a `null` canonical selection when conflicting historical values are only acknowledged. Report source cents separately from live effects; use checked sums, and return unavailable totals with a reason on invalid/overflowing input.
- [x] Rerun the same command; expect PASS. Run `npm run check:boundaries`. No unrelated permission in the checker may change. Do not make split reconstruction or manual matching modules.
- [x] Commit: `feat: derive source-linked migration review decisions`.

Report invariants:

```text
sourceRows = historyOnly + liveLinked + observationEvidence + invalid
warnings do not add to sourceRows
sourceNetCents is not liveBalanceEffectCents
monthly Available is not a cross-month balance
```

## Task 4: Setup metadata, eligibility, and migration

**Create:** `src/storage/schema/setup.ts`, `src/storage/setup.ts`, `src/application/setup-ports.ts`, `tests/integration/import-setup.test.ts`.
**Modify:** `drizzle.config.ts`, `src/storage/database.ts`, `tests/integration/migrations.test.ts`, generated files in `db/migrations/`.

- [x] Write failing temporary-database tests: fresh init creates open setup metadata; empty initialized database is eligible; household accounts/transactions/snapshots/reconciliations/evidence/audit/import rows block migration; completed fresh with zero accounts blocks migration; a missing legacy setup marker does not bypass household checks. Test two target identities, migration rollback, FK enforcement, enum and singleton checks.
- [x] Run `npm test -- tests/integration/import-setup.test.ts tests/integration/migrations.test.ts`; expect missing setup state failures.
- [x] Define the singleton schema, generate with `npm run db:generate -- --name=slice_2_setup`, and review SQL/metadata. Store a stable random target token, positive revision, state, completion timestamp, and nullable import ID. Seed setup during migration: classify legacy databases with household rows/audit as fresh-complete, empty ones as open. A custom seed SQL statement in the generated chain may use `lower(hex(randomblob(16)))` for target identity. Add the schema path explicitly. Reuse the current validated migration runner and backup-first upgrade path. No `drizzle-kit push` or separate runner.
- [x] Rerun both test files; expect PASS. Test fresh schema, prior-schema upgrade, refused import of upgraded manual data, failed upgrade recovery, and repeat init without resetting state. Inspect generated SQL and journal with `git diff -- drizzle.config.ts db/migrations`.
- [x] Commit schema, generated migration and metadata, storage changes, and tests: `feat: persist initial setup eligibility`.

## Task 5: Start-fresh operation and legacy manual compatibility

**Create:** `src/application/setup.ts`, `tests/integration/import-setup.test.ts`.
**Modify:** `src/storage/setup.ts`, `src/storage/accounts.ts`, `src/application/accounts.ts`, application-owned setup ports as needed, `tests/cli/accounts.test.ts`, `tests/cli/prompts.test.ts`.

- [x] Write failing tests: confirmed fresh closes setup without creating accounts; cancelled fresh leaves open setup; first confirmed manual account creation chooses fresh in the same transaction; failed account creation leaves setup unchanged; read-only commands leave setup open; existing manual installations retain IDs and output contracts. Preview must state the consequence of choosing fresh. Never call an independently committed setup operation from inside an account commit.
- [x] Run `npm test -- tests/integration/import-setup.test.ts tests/cli/accounts.test.ts tests/cli/prompts.test.ts`; expect the new assertions to fail while old assertions remain meaningful.
- [x] Implement `createSetup(store, runtime).status()` and `.chooseFresh(expectedRevision)` with explicit stale/setup-closed results. Add the state transition to the account creation storage transaction, using the shared setup helper and injected clock. Keep the legacy `--confirm` workflow operational; in a TTY show that it selects start fresh. Reject a stale import review after this write. Schema/data init alone does not choose fresh.
- [x] Rerun all three test files and `npm test -- tests/integration/accounts.test.ts tests/integration/snapshots.test.ts`; expect PASS with unchanged manual arithmetic and snapshot rules.
- [x] Commit: `feat: close migration when starting a fresh plan`.

## Task 6: Source identity and private review file IO

**Create:** `src/adapters/ynab/files.ts`, `src/adapters/ynab/review-file.ts`, `src/storage/import-review-state.ts`, `src/application/import-ports.ts`, `tests/integration/import-files.test.ts`.
**Modify:** `tests/helpers/ynab.ts`.

- [x] Write failing tests using only temp files: regular-file inputs, byte bounds before reads, strict UTF-8, SHA-256 of exact BOM-containing bytes, symlink/source/database aliases refused, initial review path exclusive, file mode 0600/new directory mode 0700, malformed/oversized/unknown-version JSON rejected, atomic update failure preserves prior review, revision conflicts and exclusive lock behavior. A stale lock must fail without stealing it. Tests must not access real export paths.
- [x] Run `npm test -- tests/integration/import-files.test.ts`; expect missing adapters.
- [x] Implement file adapters and the complete envelope from the design. Open and bound source files, hash bytes read through those descriptors, and pass those same bytes onward. Review mutations lock, reread revision, validate decisions, write a complete private temporary file, and atomically publish it. Preview target identity includes stable ID, canonical path, schema version, setup revision, and `fileIdentity: { device: string; inode: string }` from bigint filesystem stats. Persist and compare every field; the string fields avoid unsafe numeric conversion. Replacing a database with a byte-identical file at the same path invalidates the review. Initial preview cannot overwrite anything. Commit holds the review lock through final snapshot validation and database confirmation so concurrent review mutation cannot invalidate the user's named revision during commit. Release owned locks/temporary files in `finally`; do not touch someone else's lock.
- [x] Rerun the same test command; expect PASS. Include wrong-target, restored/replaced file identity, source mutation after preview, and concurrent review writer tests.
- [x] Commit: `feat: save private resumable migration reviews`.

## Task 7: Application preview and guided review operations

**Create:** `src/application/import-review.ts`, `tests/integration/import-review.test.ts`, `tests/unit/ynab-review-input.test.ts`.
**Modify:** `src/application/import-ports.ts`, `src/accounts/imports/types.ts`, `tests/helpers/ynab.ts`.

- [x] Write failing tests: preview leaves all household tables empty; review resumes after service restart; every source account needs class/closed confirmation; mappings propose stable local UUIDs; per-account opening evidence is required for Cash/Credit; Tracking without observation shows no observed balance; duplicate source names require explicit row grouping resolution instead of name merging; changed source/target requires new preview. Test every tagged decision parser against unknown keys, missing/null values, wrong types, invalid cents/dates and unsupported actions.
- [x] Run `npm test -- tests/integration/import-review.test.ts tests/unit/ynab-review-input.test.ts`; expect missing review service.
- [x] Implement `preview`, `inspectReview`, and versioned decision updates using the adapters and pure rules. Store only decisions plus source/target identity; recompute counts/readiness every time. Review JSON cannot supply trusted totals, `ready`, SQL, or arbitrary account mutations. Preview supplies stable default group keys for exact source labels. Implement `account SOURCE_ACCOUNT --new-group` to create and return a second stable group key/local UUID for that source label, without moving any rows automatically. Add `--account GROUP_KEY` on row decisions to explicitly resolve ambiguous source-account group membership; require full coverage and exactly one mapping per row. Confirm class/closed/opening values independently for every nonempty group; refuse empty unused groups at commit. Test two groups sharing a source name, separate row assignments, and identical keys/UUIDs after resume. Do not normalize away identity-changing whitespace or infer class from names. Default history requires explicit acknowledgment of unverified coverage; it is not silently considered a verified migrated ledger.
- [x] Rerun both test files plus `npm test -- tests/unit/ynab-review.test.ts`; expect PASS. Verify stale expected review revisions return code-4-compatible conflicts with no file/database changes.
- [x] Commit: `feat: review bootstrap mappings without writing accounts`.

## Task 8: Imported history schema and recovery coverage

**Create:** `src/storage/schema/import-sources.ts`, `src/storage/schema/import-history.ts`, `src/storage/schema/import-observations.ts`, `tests/integration/import-schema.test.ts`.
**Modify:** `drizzle.config.ts`, `src/storage/rows.ts` (only needed row guards), `tests/integration/backup.test.ts`, generated files in `db/migrations/`.

- [x] Write failing tests for a new schema and prior-version upgrade. Check source blob digest/role uniqueness, row ordinal uniqueness, source/account relationships, immutable original fields, zero-safe historical cents, explicit observation and adjustment linkage, one retained observation/account/date, and one completed migration per setup. Check that the schema can represent unresolved transfer/split evidence and blank payee/category fields. Raw historical rows must not use manual transaction constraints.
- [x] Run `npm test -- tests/integration/import-schema.test.ts tests/integration/backup.test.ts`; expect absent schema behavior.
- [x] Define explicit Drizzle tables for source blobs, import runs/decisions, new account mappings (including closed state), register history, monthly plan history, source-to-live links, and Tracking observations/active adjustment revisions. Keep original source bytes/values immutable. Store source row ordinal and role/digest lineage, normalized cents, source label, optional confirmed posting evidence, primary disposition, and issue flags. Derive row types. Generate with `npm run db:generate -- --name=slice_2_import_history`; review every SQL CHECK/FK/unique rule and the generated metadata; list each schema file explicitly. Extend setup eligibility to every new household table.
- [x] Rerun both test files plus `npm test -- tests/integration/migrations.test.ts tests/integration/import-setup.test.ts`; expect PASS. Test recovery of source blobs, original values, decisions, IDs, dispositions, observations, revised adjustments, and completed setup status, including raw-byte equality. Test restoring an open pre-import backup remains open and empty.
- [x] Commit: `feat: store source-linked bootstrap history`.

## Task 9: Tracking evidence, observation selection, and review resolution

**Create:** `src/accounts/imports/tracking.ts`, `tests/unit/ynab-tracking.test.ts`.
**Modify:** `src/application/import-review.ts`, `src/accounts/imports/review.ts`, `tests/integration/import-review.test.ts`.

- [x] Write failing tests for baseline 100, -10, +15, source adjustment +25, confirmed observation 130. Check one retained observation/day; reject a source adjustment row linked to two retained observations, including on different dates; explicit selection discards other observation candidates but preserves source dispositions. Check source adjustment is counted once, target 130 is never added as a delta, missing baseline/posted dates/target returns unavailable evidence, label `Reconciled` alone does not create observation/evidence, and no source label invents INAB reconciliation.
- [x] Run `npm test -- tests/unit/ynab-tracking.test.ts tests/integration/import-review.test.ts`; expect new Tracking assertions to fail.
- [x] Implement pure Tracking derivation: baseline is explicit; include confirmed postings through the date, then one selected adjustment. Keep pending rows outside observed-balance arithmetic. If -10 is corrected by review evidence to -15, original +25 gives 125 against 130 and needs review; only an explicit revised adjustment of +30 restores 130. Correction of an erroneous exported amount requires a new corrected export, not editing original source fields. Test this arithmetic through synthetic revised source input and pure rules, without adding post-setup re-import. Preserve original adjustment and evidence in audit history; zero required delta retains observation without a zero live transaction. Later posting after cutoff preserves earlier observation; on/before cutoff flags affected observations; unknown posting remains unverified. `defer` leaves the flag. No manual Tracking command is added.
- [x] Rerun both test files and `npm test -- tests/unit/ynab-review.test.ts tests/unit/ynab-report.test.ts`; expect PASS. Test later affected observations, negative/zero observed balances, safe integer overflow, source adjustment revision accounting, and original/manual snapshot preservation.
- [x] Commit: `feat: inspect imported Tracking balance evidence`.

Planned pure output:

```ts
type ObservationCheck =
  | { status: "verified"; observedCents: number; recordedCents: number; differenceCents: 0 }
  | { status: "needs-review"; observedCents: number; recordedCents: number; differenceCents: number }
  | { status: "unverified"; reason: "missing-opening" | "missing-posting" | "missing-observation" };
```

These statuses describe supplied evidence, not bank-verified historical accounting equivalence.

## Task 10: One atomic bootstrap commit

**Create:** `src/application/imports.ts`, `src/storage/imports.ts`, `tests/integration/import-commit.test.ts`, `tests/integration/import-concurrency.test.ts`.
**Modify:** `src/application/import-ports.ts`, `src/storage/setup.ts`, source/history schemas only as needed for tested constraints.

- [x] Write failing tests for complete commit, required decisions blocking commit, one-to-one source-to-live links, history/opening separation, identical real purchases, zero/future rows only in history, unknown posting never made posted, selected Cash/Credit live entries and preserved blank source payee, confirmed baseline/observations, and completed setup. Missing/setup-completed/replaced/legacy-populated targets must fail without changes. Review must not be trusted merely because it has valid JSON.
- [x] Run `npm test -- tests/integration/import-commit.test.ts tests/integration/import-concurrency.test.ts`; expect missing commit behavior.
- [x] Implement the design's commit sequence through one immediate Drizzle transaction, reusing recovery backup and storage primitives instead of nested per-command commits. Bind confirmation to locked review revision and held parsed byte snapshots. Create a new private backup before writes; backup failure prevents import. Recheck target identity, setup revision/state, household emptiness, source identity, and rederived decisions inside the write boundary. Insert all source/history/accounts/selected live entries/links/observations/reports/audit/setup completion together. All generated IDs come from the reviewed plan or injected runtime and remain stable on same-review retries.
- [x] Rerun both test files; expect PASS. Add fault injection after source, accounts, history, live entries, observations, and setup writes; assert complete rollback and original source/review preservation. Race two connections: one imports, the other returns stored success for the same identity or setup closed for another. Simulate post-commit output failure and then status lookup; repeat confirmation writes no rows/revisions/adjustments/audit. Corrupting or editing a leftover review cannot reopen setup. Test backup destination race, stale lock, and wrong-source byte snapshots.
- [x] Run `npm test -- tests/integration/import-setup.test.ts tests/integration/import-schema.test.ts tests/integration/backup.test.ts`; expect PASS. Commit: `feat: commit YNAB setup atomically`.

Expected final state assertions:

```text
setup.state = ynab; setup.importId = committedImportId
all original source rows retained; all counts explained
history covered by opening contributes zero live balance effect
unknown posting evidence remains null
second successful confirmation changes no household or audit row
```

## Task 11: Setup and review terminal commands

**Create:** `src/cli/setup-parse.ts`, `src/cli/setup.ts`, `src/cli/imports.ts`, `tests/cli/setup.test.ts`, `tests/cli/import-review.test.ts`, `tests/cli/import-commit.test.ts`, `tests/unit/ynab-cli-parse.test.ts`.
**Modify:** `src/bootstrap.ts`, `src/cli/main.ts`, `src/cli/parse.ts`, `tests/cli/help.test.ts`, `tests/cli/prompts.test.ts`.

- [x] Write failing parser and subprocess tests for every command/flag in the design, complete script flags, duplicate/unknown flags, positional arity, explicit DB/review paths, expected revisions, JSON isolation, error codes, cancellation, source/DB/refused target handling, and first-launch path choice in a TTY. Use fixed temporary fixtures and the existing `runCli` helper. Separate preview/review/commit and failure scenarios into independent tests within current bounds.
- [x] Run `npm test -- tests/unit/ynab-cli-parse.test.ts tests/cli/setup.test.ts tests/cli/import-review.test.ts tests/cli/import-commit.test.ts`; expect unavailable new commands, with expected input/output fixtures valid.
- [x] Keep the existing help text in `src/cli/main.ts`; no help module exists yet and none is required solely for this task. Implement dedicated complete tagged command values and dispatch before legacy `parseArguments`, extending command routing rather than adding dozens of unused nullable fields to every existing command. Bootstrap composes file/review/setup/import services; CLI never imports storage or the CSV package. Implement `setup` prompts and explicit scripted commands. Route review updates only to the review file; commit requires `--confirm --expected-review`. Source selectors/issue keys come from preview output. `--treatment posted` requires a posting date; `--role`, `--payee`, and row `--account` flags follow the design. Never echo private source fields in errors.
- [x] Rerun the same command plus `npm test -- tests/cli/help.test.ts tests/cli/accounts.test.ts tests/cli/prompts.test.ts`; expect PASS. Verify `setup fresh --confirm` closes import even in an empty DB; completed `setup` shows status and never offers migration. Built CLI routing is verified in Task 13.
- [x] Commit: `feat: guide initial setup and migration review in the terminal`.

Synthetic shell flow to encode in subprocess tests (proposed commands, not yet runnable):

```sh
npm run inab -- --db /tmp/SYNTHETIC/plan.sqlite init --confirm --json
npm run inab -- --db /tmp/SYNTHETIC/plan.sqlite setup migrate preview --register /tmp/SYNTHETIC/register.csv --plan /tmp/SYNTHETIC/plan.csv --review /tmp/SYNTHETIC/review.json --json
npm run inab -- --db /tmp/SYNTHETIC/plan.sqlite setup migrate review --review /tmp/SYNTHETIC/review.json --json
```

Tests capture preview keys/revision with runtime guards, apply account/opening/history-warning decisions through the documented commands, and confirm with that final revision. Never hardcode household names or a real file path.

## Task 12: Historical account, register, plan and report inspection

**Create:** `src/application/import-history.ts`, `src/storage/import-history.ts`, `src/cli/import-history.ts`, `tests/integration/import-history.test.ts`, `tests/cli/import-history.test.ts`.
**Modify:** `src/bootstrap.ts`, `src/cli/setup-parse.ts`, `src/cli/main.ts`.

- [x] Write failing tests for account history mappings/classes/closed state, raw/source row lineage, blank/zero rows, exact duplicates, source amounts and monthly values, ambiguous transfer/split flags, imported observations and review states, and account/month/import filters. Test a default 100-row page, maximum 1,000, integer nonnegative offset, deterministic sort, and missing record handling. Confirm source clearing labels and missing posting evidence are visible without claiming INAB reconciliation.
- [x] Run `npm test -- tests/integration/import-history.test.ts tests/cli/import-history.test.ts`; expect missing history queries.
- [x] Implement read-only coherent queries through the history port. Order Cash/Credit source register history by occurrence date then source ordinal, exposing posting evidence separately. For Tracking, order confirmed entries by posting date then ordinal and place the closing observation after those entries on its date. Put pending/unverified entries in a separately labeled section sorted by occurrence date then ordinal. Test two rows with reversed occurrence/posting order and an observation on the posting cutoff; do not substitute occurrence dates for unknown postings or claim ordinal is bank order. Filter by mapped account/import; order plan history by month/group/category/source ordinal. Display Tracking observations as last known observed balance with effective date/source/review state, or no observed balance. Keep `account show/list` and `latestSnapshot` JSON contracts unchanged; this view is explicitly imported history. Reports include all primary dispositions, rejected/blocked source evidence, missing relationships, unavailable totals, and separate source/live/adjustment totals.
- [x] Rerun both test files plus `npm test -- tests/cli/accounts.test.ts tests/cli/snapshots.test.ts`; expect PASS. Read test responses within one database snapshot and verify history reads never reopen setup or mutate audit records.
- [x] Commit: `feat: inspect imported account and plan history`.

## Task 13: Workflow map, synthetic demo, and complete verification

**Create:** `docs/slice-2-demo.md`.
**Modify:** `docs/agent/feature_map.json`, `tests/policy/feature-map.test.ts`, `README.md`, `docs/README.md`, `docs/verification.md`, `docs/superpowers/specs/2026-10-17-inab-design.md`, and the plan's completion record.

- [x] First write failing map validation/execution tests for setup choice, paused review with empty tables, migration confirmation, source history inspection, completed-setup refusal, safe retry, and recovery. Extend only the fixed temporary fixture vocabulary: `${registerCsv}`, `${planCsv}`, `${review}`, `${reviewRevision}`, `${sourceAccountKey}`, `${importId}`. Validate source paths point to copied synthetic fixtures, writable review/DB/backup paths remain under the test temp directory, and captured values pass guards. Malicious path substitutions and unsupported source reads must fail validation.
- [x] Run `npm test -- tests/policy/feature-map.test.ts`; expect missing new workflow support. Implement the narrow fixture/capture changes and hand-edit map entries with real installed commands/source files. Do not remove existing workflow assertions. Partition scenarios within the current separate test timeouts.
- [x] Write and run the synthetic demo using real CLI output. Include start-fresh choice and import refusal, two-file preview, resume after quitting with empty household tables, exact duplicate/zero/multiline sources, confirmed mappings/openings, source-only warnings, commit, inspection, safe confirmation retry, failure rollback, backup/restore, and refusal of later imports. Use built output from a different working directory. No real household migration is authorized by this plan.
- [x] Run these installed checks after implementation; all must exit 0:

```sh
npm run check
npm run check:tracked -- --tracked
npm run check:secrets -- --tracked
npm run check:secrets -- --staged
npm run check:secrets -- --history
```

Also run the focused suites once after any substantive fix exposed by these checks. Keep household exports, review files, backups, and database paths out of staged files. The document guide and README can describe new behavior only when it works.

- [x] Record the actual test counts/commands, demo outputs, remaining source-evidence limits, and any unresolved manual review. Update verification status from planned only for checks now installed. Commit the mapped workflow and evidence: `docs: verify the initial YNAB migration workflow`. Present the result for user manual review before household use; do not begin Slice 3 automatically.

## Review and execution handoff

Run one independent document review against this plan, the Slice 2 design, and the agreed decisions. Resolve material gaps before execution; advisory style changes do not block it. Record review findings and repairs here without claiming application tests exist.

Once the written design and plan have been reviewed, execute tasks in order using superpowers:executing-plans, with red/green evidence per task. Review after each coherent task group. No implementation, package installation, household import, database reset, publication, or branch merge is part of this planning turn.

## Planning verification record

- October 22, 2026: read-only structural inspection of local source files; no private rows printed or copied.
- Existing worktree baseline previously passed `npm run check`: 344 tests. This is Slice 1 evidence, not evidence for the planned importer.
- Independent document review initially found three material gaps: missing target file identity in the saved envelope, no command to create a second group for an ambiguous source account name, and inconsistent Tracking history ordering. The design and tasks now specify device/inode identity, `--new-group` plus explicit row assignment, and posting-date ordering with a separate unverified section. Advisory corrections also removed a nonexistent help-file reference and added a source-adjustment reuse test.
- The second independent review approved the complete plan and design with no remaining implementation-blocking findings. No private exports were provided to the reviewer, and no application tests were run by the reviewer.
- Planning checks: document links/indexes, Prettier on all changed planning files, current candidate private-path checks, and current-file Secretlint passed. These checks do not prove any proposed importer behavior.

## Execution record — October 22, 2026

- Implemented parser/value boundaries with pinned `csv-parse@7.0.3`; entirely synthetic fixtures cover duplicate, zero, blank, multiline, invalid and oversized inputs.
- Implemented setup metadata, migration guards, legacy classification, private review IO, strict decision parsing, guided terminal review, atomic import and receipt reuse, source history and observation storage, paginated inspection, and backup/restore coverage. New schema version is 4.
- Task groups sharing the same generated schema were integrated together. No applied migration was changed. Domain code reuses the existing pure account balance/register modules through a narrow tested boundary allowance, rather than duplicating financial arithmetic.
- Spec review found discarded observation adjustment effects, missing selection audit, and absent relationship warnings. Each defect received a failing regression before its fix. Replaced observations now preserve original selection/target/resolution, clear stale resolutions, and exclude discarded adjustments while retaining source rows. Warnings expose unknown split parents and transfers without inventing links. Spec re-review approved the result.
- Quality review found cleared/uncleared range checks could differ from source-order working totals. Three tests failed before canonical register ordering and existing balance validation were reused; the focused 60-test group then passed. Quality re-review approved the fix.
- The documented synthetic built-CLI demo passed, including source deletion followed by safe receipt reuse, refusal of later imports, and explicit Tracking adjustment revision from +25 to +30 to reach an observed 130. No household export/database was imported.
- Final `npm run check` passed: 53 files and 502 tests, plus documents, private paths, boundaries, formatting, lint, types, current-file secrets, and CLI build. The last targeted range/order regression run also passed all 60 checks before the full run.
- Commit groups: `d68ee65` CSV parser; `4783f1c` source values; `e44f1bd` review/Tracking/boundaries; `b660cfa` setup/schema/recovery; `766b0bd` private review IO; `d3b852d` review and atomic commit; `0214187` historical queries; `1f7201c` terminal workflows. Hooks passed for each. Workflow-map/demo/evidence documentation forms the final commit.
- Setup/fresh coverage was combined in `tests/integration/import-setup.test.ts`; setup and history schema definitions were generated together in migration 0002, followed by the seed/guard migration 0003. The separate conceptual tasks did not require a second redundant schema generation.
- Working-file/staged/private-path scans are part of completion; the final history scan runs after the commits. Existing planning evidence above is historical and does not claim importer behavior passed before implementation.
