# Slice 1: Manual Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can create local Cash, Credit, and Tracking accounts, record activity, reconcile Cash/Credit balances, and back up and restore the database without YNAB or Plaid.

**Architecture:** One terminal application calls small application operations. Pure account rules compute balances; SQLite repositories persist changes atomically. A single composition module connects the terminal, operations, and repositories so a later web interface can reuse the operations.

**Tech Stack:** Agreed: TypeScript, Node.js, Drizzle ORM with better-sqlite3 and SQLite, Drizzle Kit for generated migrations, and USD. Proposed implementation choices: Node 24 LTS, npm, Vitest, ESLint, Prettier, tsx for development, and tsc for production output. No web framework, provider SDK, or model runtime.

---

## Authority and current state

Read the [design](../specs/2026-10-17-inab-design.md), [manual-account decision](../../decisions/2026-10-17-manual-account-defaults.md), [conventions](../../../README.md), and [verification guide](../../verification.md). Those documents own product decisions. This plan supplies implementation choices and test cases; choices marked proposed are recommendations for this slice, not prior user decisions.

The repository has an initial commit and the remote `https://github.com/stephencweiss/inab.git`. `.npmrc` selects the public npm registry. The check baseline is installed for Node.js 24.16.0: TypeScript, ESLint, Vitest, Prettier, Secretlint, a Husky hook, and GitHub Actions. `npm run check` is the full command. Custom lint rules live under `tools/eslint-plugin-*`, with tests in `tests/unit/`. Preserve those files and extend them. Drizzle, better-sqlite3, private storage initialization, and manual account management are installed. The account feature map is checked through real terminal commands. Manual transaction entry, correction, clearing, and registers are implemented. Cash/Credit reconciliation and original balance evidence are implemented. Correction invalidation now preserves evidence and marks affected checks for review. Snapshots and user recovery workflows remain planned. Do not initialize another repository, push, or copy SuChef application dependencies.

All paths below are relative to `/Users/sweiss/code/inab`. Use the current checkout unless execution needs isolation. Never read real YNAB exports for these tests. Use generated synthetic records and temporary database directories. Do not commit or publish private data. No remote creation, push, paid service, or deployment is part of this plan.

## Scope and proposed implementation rules

Agreed behavior: USD integer cents; local IDs independent of providers; opening balance is the posted closing balance on its date; pending purchases excluded; Uncleared/Cleared/Reconciled states; no silent balancing entry; Tracking uses dated snapshots.

Proposed details for implementation:

- Use UUIDs from `crypto.randomUUID()` at the application boundary. Inject ID and clock functions in tests. Do not use names, dates, or amount hashes as identity.
- Use signed amounts throughout: cash inflow positive, outflow negative; credit debt negative, payment or refund positive; Tracking assets positive and liabilities negative. Explain this in prompts and output.
- Store cents as safe integer numbers, checked on parsing and after every sum. Use BigInt while parsing decimal text, then reject values outside the safe integer range. Never multiply a floating-point currency value by 100. Read SQLite integers safely and reject unsafe conversions.
- Store dates as validated `YYYY-MM-DD` strings, timestamps as UTC ISO strings. The CLI uses the local calendar date for defaults, shows it, and allows an explicit date. Tests inject today's date. Do not convert date-only fields through UTC midnight.
- Retain separate `occurred_on` and nullable `posted_on`. An uncleared purchase can occur before the opening date if it was still pending then. Clearing requires a posting date later than the opening date. Refuse an already-posted entry on or before the opening date with a clear explanation; extending history arrives in Slice 2.
- In Slice 1, reject future-dated activity and snapshots with an explanation that scheduled entries are deferred. This does not discard future rows during the later import slice.
- Working balance = opening cents + all register amounts. Cleared balance at date D = opening cents + amounts with a posting date after opening and on/before D. Uncleared amount = sum of entries without a posting date. Reconciled entries remain part of the cleared total.
- The stored clearance state is `uncleared` or `cleared`. Display `reconciled` only when valid reconciliation evidence matches the current balance-relevant transaction values; metadata-only revision changes preserve coverage. Do not store a second conflicting reconciliation flag on a transaction.
- Reconciliation uses an explicit closing date and bank posted balance. A mismatch produces a report and no reconciliation record. Matching balances can be confirmed; confirmation rechecks the account revision inside the write transaction.
- Any mutation that changes a prior reconciled balance invalidates affected reconciliations from the earliest affected posting date onward. Opening balance changes invalidate all reconciliations. Earlier valid checks remain valid. Memo/payee-only edits keep balance checks valid; retain revision history. Never delete prior reconciliation evidence.
- Show invalidated checks as `needs review`. Entries covered only by invalid checks display `cleared`, not `reconciled`. A new successful reconciliation does not rewrite old evidence.
- Do not deduplicate manual entries: two identical purchases can be real. Command retries must not be automatic after a write result is uncertain; show the last operation IDs for inspection.
- Allow account rename and opening-balance correction with preview, expected version, and explicit confirmation. Account class and currency cannot change after creation in this slice. No hard deletion, automatic transfer matching, splits, categories, budgets, imports, sync, or month-end scheduling.
- Tracking snapshots are observations, not additive transactions. Latest effective date determines the last known balance, displayed with that date; it is not a verified balance for today. A second entry for the same account/date offers an explicit correction, not a silent overwrite.
- Restore to a new, non-existing database path only in this slice. The user can inspect the restored database and select it explicitly. No in-place replacement of a live database.

## Terminal contract

Proposed command forms, available through `npm run inab --` during development and `node dist/cli/main.js` after build:

```text
inab --db PATH init
inab --db PATH account add --name NAME --kind cash|credit --opening AMOUNT --as-of DATE
inab --db PATH account add --name NAME --kind tracking
inab --db PATH account list
inab --db PATH account show ID
inab --db PATH account rename ID --name NAME --expected-version N
inab --db PATH account opening ID --amount AMOUNT --as-of DATE --expected-version N
inab --db PATH transaction add --account ID --date DATE --amount AMOUNT --payee TEXT [--memo TEXT] [--posted-on DATE]
inab --db PATH transaction edit ID --date DATE --amount AMOUNT --payee TEXT --memo TEXT --expected-version N
inab --db PATH transaction clear ID --posted-on DATE --expected-version N
inab --db PATH transaction unclear ID --expected-version N
inab --db PATH register ID
inab --db PATH reconcile ID --as-of DATE --bank-balance AMOUNT
inab --db PATH reconciliation list --account ID
inab --db PATH snapshot add --account ID --as-of DATE --balance AMOUNT
inab --db PATH snapshot correct ID --balance AMOUNT --expected-version N
inab --db PATH snapshot list --account ID
inab --db PATH backup --to NEW_PATH
inab restore --from BACKUP_PATH --to NEW_PATH
```

Flags are optional only at the parser boundary. Interactive mode prompts for missing values and shows a preview for writes. In non-interactive mode, missing required values fail instead of waiting for stdin. `--confirm` accepts the displayed operation for scripts; edits still require an expected version. All reads support `--json`; write results also support JSON with IDs and versions. JSON stdout contains only the result; diagnostics go to stderr.

Exit codes: 0 success; 2 invalid input; 3 unavailable record; 4 stale version or reconciliation mismatch; 1 unexpected storage/system error. Cancellation makes no write and returns 0 with a canceled result. Refuse unknown flags. Global `--db` is required for database operations except restore, which requires explicit `--from` and `--to` paths. Help and version commands require no database. Only `init` creates a new database; a path typo on a read must fail, not create an empty file.

## File ownership

Create files when their task first needs them, not empty scaffolding in advance.

| Files | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json`, `.nvmrc`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `eslint.config.mjs`, `.prettierignore`, `.prettierrc.json` | Reproducible tool setup |
| `scripts/check-documents.ts`, `scripts/check-tracked-paths.ts`, `scripts/check-boundaries.ts`, `scripts/check.ts` | Document, tracked-path, dependency, and full-check entry points |
| `tools/eslint-plugin-inab/index.cjs`, `interfaces.cjs`, `type-inference.cjs`, `comments.cjs` in that directory | Adapted custom lint rules, only where standard rules do not suffice |
| `src/lib/money.ts`, `src/lib/date.ts` | Decimal parsing, checked sums, calendar validation |
| `src/accounts/types.ts`, `balances.ts`, `reconciliation.ts` in that directory | Pure account contracts and balance/reconciliation rules |
| `src/application/ports.ts`, `accounts.ts`, `transactions.ts`, `reconcile.ts`, `snapshots.ts`, `backup.ts` in that directory | Application operations and narrow storage contracts |
| `src/storage/database.ts`, `migrate.ts`, `rows.ts`, `accounts.ts`, `transactions.ts`, `reconciliations.ts`, `snapshots.ts`, `backup.ts` in that directory | SQLite implementation; SQL exists only here and in migrations |
| `drizzle.config.ts`, `src/storage/schema/accounts.ts`, `transactions.ts`, `reconciliations.ts`, `snapshots.ts`, `changes.ts` in that schema directory | Authoritative Drizzle table definitions and explicit schema-file list |
| `db/migrations/` | Drizzle Kit-generated SQL and metadata, plus reviewed custom migrations |
| `src/cli/main.ts`, `parse.ts`, `prompts.ts`, `render.ts` in that directory | Arguments, prompts, output, and exit codes |
| `src/bootstrap.ts` | Only composition module that constructs concrete storage and application dependencies |
| `tests/helpers/database.ts`, `cli.ts` in that directory | Temporary databases and real CLI process execution |
| `tests/unit/`, `tests/integration/`, `tests/cli/`, `tests/policy/` | Focused behavior and enforcement tests |
| `.husky/pre-commit`, `.github/workflows/check.yml`, `.secretlintrc.json` | Local hook and CI policy, added at the specified tasks |
| `docs/agent/feature_map.json`, `docs/slice-1-demo.md`, `docs/superpowers/plans/2026-10-17-slice-1-progress.md` | Implemented workflows, demo, and evidence |

`src/accounts/` is a pure domain module, like the planned `src/budget/`. It may import `src/lib/` only. Update the utilities convention and design to name it before coding. Application modules depend on domain modules and their own ports, not SQLite. `src/bootstrap.ts` is the sole wiring exception. CLI modules import application contracts, parsers, rendering, and the bootstrap entry point; never SQL or the database driver. Use `.js` import specifiers with TypeScript NodeNext compilation. Keep test types separate from stored row types.

## Storage contract

Use Drizzle TypeScript tables as schema authority. Derive stored row types with `$inferSelect` and `$inferInsert`; do not handwrite duplicate row interfaces. Generate SQL and metadata with Drizzle Kit, review them, and commit them together. Use Drizzle queries and transactions over better-sqlite3. All amount columns use SQLite INTEGER with safe-range and `typeof(column) = 'integer'` CHECK constraints; nullable amounts explicitly allow NULL. Use explicit NOT NULL, class/status CHECKs, and foreign keys. Do not assume a TypeScript enum or integer annotation enforces a SQLite constraint. Use bound SQL only for migrations, pragmas, or operations the query builder does not express. Each database connection enables and verifies foreign keys and uses a bounded busy timeout. Use rollback journal mode initially; no need for WAL tuning in a terminal app.

Application tables in the first generated migration (Drizzle owns its migration ledger):

| Table | Required columns and constraints |
| --- | --- |
| `accounts` | UUID primary key, nonblank name, kind, currency constrained to USD, nullable opening cents/date, revision, created timestamp. Cash/Credit require an opening pair; Tracking requires both null |
| `transactions` | UUID primary key, account foreign key, occurred date, nullable posted date, nonzero signed cents, payee, memo, revision, created/updated timestamps. Nullable posted date determines clearance |
| `reconciliations` | UUID primary key, account foreign key, cutoff date, bank cents, computed cents, opening cents/date snapshot, account revision at confirmation, status valid/needs-review, recorded timestamp |
| `reconciliation_entries` | Reconciliation ID, transaction ID, recorded transaction revision, recorded amount and posting date; composite primary key. Preserve evidence after later edits |
| `snapshots` | UUID primary key, account foreign key, effective date, balance cents, source constrained to manual in this slice, observed timestamp, revision; unique account/date |
| `changes` | UUID primary key, operation name, entity ID, before/after JSON, recorded timestamp. Private audit history, written in the same transaction as the mutation |

Enforce Slice 1 scope in application operations and tests: manual transaction commands accept Cash/Credit only, and standalone balance snapshot commands accept Tracking only. These are workflow limits for this slice, not permanent account-class prohibitions. Future Tracking transaction support must define how transactions and snapshot boundaries interact to prevent double counting. Cash/Credit still retain opening and reconciliation balance evidence. Reconciliation entries must belong to the same account as the reconciliation; validate in the transaction and use a database trigger for this cross-table condition. Track aggregate account revisions for every register-affecting mutation, including insertions and clearing changes. Use a Drizzle transaction with immediate behavior through the pinned better-sqlite3 adapter; compare expected versions, validate, mutate, append history, and commit. Verify this adapter option in a two-connection test. Roll back on any failure.

Use schema-inferred types for ordinary Drizzle query results. Keep `src/storage/rows.ts` for validation of raw SQL results and mapping stored values to domain contracts; never assert unchecked external or raw database values into domain types. Inferred types do not replace runtime currency, amount-range, or date checks. Do not build a general repository framework. Add only the operations each task uses.

## Task execution rules

Run tasks in order. For each behavior, write the listed failing case, run the exact focused command, implement only that behavior, rerun, then refactor. Split a checkbox into smaller red/green loops when it covers multiple cases. A work session may stop after any green task; do not weaken checks to meet a time estimate.

Before each task commit, run the listed focused checks plus `npm run lint` and `npm run typecheck` once those exist. Stage only that task's files, inspect `git diff --cached --name-only`, run the tracked-path check when available (inspect staged paths manually before Task 2 installs it), and commit with the suggested message. Preserve unrelated user changes. Do not push. Record red/green evidence in the progress file. Commands below are planned, not available today.

### Task 1 — Reproducible CLI and test harness

**Create or extend:** tool setup files listed above, `src/cli/main.ts`, `tests/cli/help.test.ts`, `tests/helpers/cli.ts`.
**Modify:** `.gitignore` only if new generated paths need exclusion; preserve `.npmrc`.

- [x] Pin a currently supported Node 24 patch in `.nvmrc`; select compatible exact versions for TypeScript, tsx, Vitest, ESLint/typescript-eslint, Prettier, drizzle-orm, drizzle-kit, better-sqlite3 and its types, and Husky. Pin a mutually compatible released ORM/Kit pair; do not mix stable packages with release-candidate documentation. Check official package engine requirements. Record versions in the progress file. Use npm and commit the lockfile. Do not copy SuChef version pins. Reuse the existing `.nvmrc` rather than adding another runtime pin file; replace its major-only value with the selected patch.
- [x] Add `inab` = `tsx src/cli/main.ts`, `build` = `tsc -p tsconfig.build.json`, `typecheck` = `tsc --noEmit`, `test` = `vitest run`; add lint/format scripts in Task 2. Retain strict NodeNext config and `noUncheckedIndexedAccess`; add `exactOptionalPropertyTypes`. Extend the current Vitest include pattern to cover `tests/{unit,integration,cli,policy}/**/*.test.ts`; otherwise the focused commands below will discover no tests. Preserve source support in the no-emit config, but override `allowImportingTsExtensions` to false in the emitting build config and use `.js` import specifiers. Build emits `dist/cli/main.js`; copy reviewed migration SQL through a build script when Task 5 adds it.
- [x] Write a subprocess test: `--help` exits 0, shows manual-account commands, and creates no database. An unknown command exits 2. Run `npm test -- tests/cli/help.test.ts`; expect failures for missing behavior, not a broken test runner.
- [x] Implement help and error dispatch only. Use Node argument/readline facilities; do not add a UI framework.
- [x] Run the same test, `npm run typecheck`, and `npm run build`; expect pass. Run `node dist/cli/main.js --help`; expect the same help.
- [ ] Commit: `chore: establish terminal and test harness`.

### Task 2 — Baseline rules and private-data checks

**Create:** `scripts/check-documents.ts`, `scripts/check-tracked-paths.ts`, `scripts/check-boundaries.ts`, `scripts/check.ts`, `tests/policy/docs.test.ts`, `private-files.test.ts`, `boundaries.test.ts` in that test directory; formatter/linter configuration.
**Modify:** `package.json`, `docs/conventions/utilities.md`, `docs/verification.md`, design architecture section.

- [x] Add tests with a broken local Markdown link, mismatched convention indexes, and a valid document pair. Use a temporary fixture tree, not modifications to repository docs.
- [x] Add a temporary Git fixture: force-stage a synthetic `.sqlite` file and an export under `ynab-export/`; expect rejection even though ignored. A generated synthetic JSON fixture under `tests/fixtures/` passes. Use `git ls-files -z` and argument arrays, never shell interpolation. Test staged mode and complete tracked-file mode.
- [x] Add boundary fixtures: domain importing SQLite, filesystem, network, or CLI must fail; application importing concrete storage fails; `src/bootstrap.ts` wiring passes. Test relative paths, aliases, re-exports, and dynamic imports; reject computed dynamic imports in restricted modules.
- [x] Run `npm test -- tests/policy/docs.test.ts tests/policy/private-files.test.ts tests/policy/boundaries.test.ts`; expect the planned violations to be missed before implementing checks. Implement checks with TypeScript AST/module resolution for imports, not text matching alone.
- [x] Keep the existing script names `check:documents`, `check:tracked`, `check:format`, and `lint`; add `check:boundaries`. `check:tracked` checks tracked names and preserves its existing candidate scan by default. Retain the installed secret scan; staged-blob and history scanning come in Task 12. The full `check` runner invokes available checks sequentially and fails on the first nonzero exit. Skip no installed check silently.
- [x] Run the focused suite, all new commands, and typecheck. Expect pass. Record docs/policy checks as active only after this succeeds.
- [x] Commit: `chore: enforce source and private-data boundaries`.

### Task 3 — Port focused SuChef lint rules

**Create:** `tools/eslint-plugin-inab/{index,interfaces,type-inference,comments}.cjs`, `tests/policy/lint-rules.test.ts`.
**Modify:** `eslint.config.mjs`, relevant convention enforcement-status lines, `package.json`.

- [x] Inspect the corresponding SuChef rule code and tests. Copy/adapt only these rules; preserve any license notices. Keep standard ESLint rules for unnecessary assertions and inferable literal types.
- [x] Write valid/invalid rule tests for optional application fields, undefined result types, unparsed unknown inputs, redundant annotations, and comment forms. Include legal parser input, SDK boundary types, type guards, tagged unions, and test comments.
- [x] Run `npm test -- tests/policy/lint-rules.test.ts`; confirm failures for the missing scope checks. Existing rule behavior was already present.
- [x] Implement scope-aware rules. Domain/application records must be complete; raw parser inputs can be optional. Unknown is allowed at parsers, row validators, and guards; it must not reach budget operations. Avoid blanket adapter-folder exemptions for application outputs. Application source must be `.ts` (later `.tsx` when UI arrives); config/tool files may use `.mjs`/`.cjs`.
- [x] Run focused tests, `npm run lint`, and `npm run typecheck`; expect pass for legitimate code and failure for each violation fixture.
- [x] Commit: `chore: enforce explicit contracts and useful comments`.

### Task 4 — Money, dates, and balance examples

**Create:** `src/lib/money.ts`, `src/lib/date.ts`, `src/accounts/types.ts`, `src/accounts/balances.ts`, `tests/unit/money.test.ts`, `dates.test.ts`, `balances.test.ts`.

- [x] Write tests for `12.34 → 1234`, `-0.01 → -1`, zero opening balance, invalid fractions/exponents/NaN, overflow, invalid leap days, and date-only handling across time zones. Transactions reject zero amounts; snapshots and opening balances allow zero.
- [x] Write the synthetic balance example below. Include negative card debt and a positive card balance. Run `npm test -- tests/unit/money.test.ts tests/unit/dates.test.ts tests/unit/balances.test.ts`; expect missing functions or incorrect results.
- [x] Implement exact decimal parsing, date validation, checked addition, and pure balance functions. Types must carry account kind and USD; no database or IO imports.
- [x] Separate occurred and posted dates; pending old purchases count in working balance but not the cleared total until posted after opening. Reject clearing into the opening period.
- [x] Run focused tests, lint, and typecheck. Commit: `feat: define exact manual-account balances`.

Example test contract (the fixture helper supplies complete fields):

```ts
it("keeps pending purchases outside the cleared balance", () => {
  const account = cashAccount({ openingCents: 100000, openingDate: "2026-10-16" });
  const entries = [
    purchase({ cents: -6000, occurredOn: "2026-10-17", postedOn: null }),
    purchase({ cents: -2500, occurredOn: "2026-10-17", postedOn: "2026-10-17" }),
  ];
  expect(balances(account, entries, "2026-10-17")).toEqual({
    workingCents: 91500,
    clearedCents: 97500,
    unclearedCents: -6000,
  });
});
```

### Task 5 — Initialize safe storage and migrations

**Create:** `drizzle.config.ts`, the five schema files listed above, generated SQL and metadata under `db/migrations/`, `src/storage/database.ts`, `migrate.ts`, `migration-history.ts`, `rows.ts`; `tests/helpers/database.ts`, `tests/integration/migrations.test.ts`; `scripts/copy-migrations.ts`. Let the pinned Drizzle Kit version name generated artifacts; do not handwrite a parallel numbered migration set.
**Modify:** CLI init handling, build command, `tests/cli/init.test.ts` (create).

- [x] Write tests for fresh init, repeated init with no changes, foreign keys enabled, unknown newer schema rejected, tampered migration checksum rejected, and failure midway through a migration leaving no partial schema. Run `npm test -- tests/integration/migrations.test.ts tests/cli/init.test.ts`; expect missing storage behavior.
- [x] Define the schema with `sqliteTable` and derive row types beside each table. Set `dialect: "sqlite"`, `out: "./db/migrations"`, and list every schema file explicitly in `drizzle.config.ts`. Add `db:generate` = `drizzle-kit generate` and run `npm run db:generate -- --name=manual_accounts`. Review generated CHECKs, indexes, and foreign keys before applying. No `drizzle-kit push` against persistent data.
- [x] Use the Drizzle better-sqlite3 migrator inside `src/storage/migrate.ts`, with explicit target validation and backup first. Create `src/cli/migrate.ts` and add `db:migrate` = `tsx src/cli/migrate.ts`; require `--db PATH`. Use Drizzle's migration order/ledger; do not add an independent `schema_migrations` runner. Verify recorded migration hashes against committed artifacts in a preflight check; fail closed on unknown or changed history. Test the pinned migrator's rollback behavior rather than assuming it. Set an application ID and use the known migration sequence as the schema version for restore checks. Copy all required migration metadata as well as SQL into the built output; resolve paths relative to the built module.
- [x] Generate a custom migration for cross-table triggers not represented by Drizzle. Commit its SQL and metadata in the same migration chain. Verify same-account reconciliation membership, integer constraints, and that regenerating an unchanged schema produces no new schema diff. Test that every schema file is listed in the config. Do not manually edit an already-applied migration.
- [x] Create private directories/files with owner-only permissions on macOS/Linux, including journals and backups. Reject symlink database targets. Never chmod unrelated parent directories. Missing DB reads fail; only init creates.
- [x] For existing-data upgrades, require a SQLite-consistent backup before migration. Implement the minimal snapshot primitive now using the driver's backup API; Task 11 exposes it and restore to users. Add a synthetic prior-version upgrade fixture, not real account data.
- [x] Run focused tests, build, and the built CLI init test from a different working directory. Expect pass and identical schema after restart.
- [x] Commit: `feat: initialize private SQLite storage`.

### Task 6 — Create, inspect, and correct local accounts

**Create:** `src/application/ports.ts`, `accounts.ts`; `src/storage/accounts.ts`; `src/bootstrap.ts`; `src/cli/parse.ts`, `prompts.ts`, `render.ts`; `tests/integration/accounts.test.ts`, `tests/cli/accounts.test.ts`.
**Create when first workflow works:** `docs/agent/feature_map.json`, `tests/policy/feature-map.test.ts`.

- [x] Write CLI and integration tests for Cash/Credit opening balance creation and Tracking creation without an opening pair. Reject blank names, non-USD currency, and malformed dates. Duplicate names require explicit selection by ID; never merge accounts by name.
- [x] Run `npm test -- tests/integration/accounts.test.ts tests/cli/accounts.test.ts`; expect failure. Implement account add/list/show through the application and storage boundaries, returning generated ID and revision.
- [x] Add a rename test proving ID stability. Add opening correction tests: preview old/new balance and date, require confirmation and expected version, and roll back account/history writes together on failure. Refuse corrections that would place an existing posted transaction inside the new opening period.
- [x] Implement audit records and optimistic version checking. Show target database path in write previews. A cancelled prompt performs no write. JSON results include complete values; absent values use null.
- [x] Hand-write the first feature-map entry with synthetic setup and exact terminal steps. Add schema, file-reference, and command execution checks; derive neither the map nor its success criteria from implementation output.
- [x] Run focused tests, feature-map test, lint, typecheck, and restart inspection. Commit: `feat: manage local accounts from the terminal`.

### Task 7 — Enter, edit, and clear manual transactions

**Create:** `src/application/transactions.ts`, `src/storage/transactions.ts`, `tests/integration/transactions.test.ts`, `tests/cli/transactions.test.ts`.
**Modify:** CLI parser/rendering, application ports, feature map.

- [x] Test the $1,000 example through real CLI subprocesses: add a $60 uncleared outflow and a $25 cleared outflow, restart, and verify working $915 / cleared $975 / uncleared -$60. Two identical purchases get two IDs.
- [x] Test a purchase occurring before opening but posting after it; clearing on/before opening fails. Future entries fail with a scheduling explanation. Tracking transaction writes fail with an explanation that they are not supported in Slice 1. Run `npm test -- tests/integration/transactions.test.ts tests/cli/transactions.test.ts`; expect red.
- [x] Implement add/edit/register and clear/unclear commands with exact input parsing. Edit changes amount/date/payee/memo, retaining posting state; clearing changes the posting date through its own command. Validate posting date is not before occurrence. No SQL in handlers.
- [x] Add tests for amount correction, clearing and unclearing, stale expected version, and forced audit-write failure. Implement the mutation and account revision update in one transaction; no partial register change on failure.
- [x] Test safe integer overflow in totals before commit. Reject it and leave data unchanged. Ensure register ordering is stable by occurrence date, created time, then ID.
- [x] Run final checks and reviews. Commit: `feat: record and clear manual transactions`.

### Task 8 — Reconcile an account balance

**Create:** `src/accounts/reconciliation.ts`, `src/application/reconcile.ts`, `src/storage/reconciliations.ts`, `tests/unit/reconciliation.test.ts`, `tests/integration/reconciliation.test.ts`, `tests/cli/reconciliation.test.ts`.
**Modify:** ports, CLI commands, feature map.

- [x] Test the running example with bank balance $970: expect difference -$5, exit 4, and no inserted reconciliation or adjustment. Test $975: preview matches, confirmation records the cutoff, amounts, and covered entry revisions; pending $60 remains uncleared.
- [x] Run `npm test -- tests/unit/reconciliation.test.ts tests/integration/reconciliation.test.ts tests/cli/reconciliation.test.ts`; expect red.
- [x] Implement preview with account revision. On confirmation, begin a transaction, re-read revision and balance, reject stale preview, then insert the reconciliation and its evidence. Use signed amounts for card reconciliation; show debt clearly.
- [x] Test repeated confirmation at the same cutoff and unchanged account revision: return the existing result rather than duplicate evidence. Test no-transaction accounts, earlier cutoffs, later posted entries, invalid cutoffs before opening, and mismatched accounts.
- [x] Derive displayed reconciliation status from valid evidence and current balance-relevant data. A metadata-only edit can preserve coverage, but evidence retains its original revision and record values. Add a documented comparison helper instead of treating every revision difference as invalid.
- [x] Run focused checks and feature map. Commit: `feat: reconcile cleared balances with bank records`.

### Task 9 — Keep reconciliation honest after corrections

**Modify:** account/transaction operations and repositories, reconciliation module, feature map.
**Create:** `tests/integration/reconciliation-corrections.test.ts`, `tests/cli/reconciliation-corrections.test.ts`.

- [x] Write cases for changing amount, moving posting date across a cutoff, unclearing an entry, adding a backdated cleared entry, and changing opening balance. Each must mark all affected later checks `needs review`, preserving their evidence.
- [x] Add control cases: a payee/memo change preserves validity; an entry after a cutoff does not invalidate that cutoff; earlier unaffected checks remain valid. Run `npm test -- tests/integration/reconciliation-corrections.test.ts tests/cli/reconciliation-corrections.test.ts`; expect red.
- [x] Implement invalidation in the same write transaction as the correction. Show affected reconciliation IDs/dates in the preview and require confirmation. Recheck account revision before applying. Audit before/after values.
- [x] Add failure injection after invalidation but before mutation/history completes; all changes must roll back. Add a two-connection stale-update case.
- [x] Reconcile the corrected balance. Expect a new valid record, while old records remain marked for review. Run focused checks and feature map.
- [x] Commit: `feat: flag reconciliations affected by corrections`.

### Task 10 — Record Tracking balance snapshots

**Create:** `src/application/snapshots.ts`, `src/storage/snapshots.ts`, `tests/integration/snapshots.test.ts`, `tests/cli/snapshots.test.ts`.
**Modify:** account show/list rendering, ports, feature map.

- [ ] Test snapshots of $5,000 and $5,200 on different dates: last known balance is $5,200 with its effective date, not $10,200 or an unqualified current balance. Insert an older snapshot and verify it does not replace the latest observation. Negative liabilities and zero balances work.
- [ ] Test same-date add conflict, explicit correction with version, restart, and refusal on Cash/Credit accounts. Run `npm test -- tests/integration/snapshots.test.ts tests/cli/snapshots.test.ts`; expect red.
- [ ] Implement add/list/correct; store observed timestamp separately from effective date. Label source manual. Snapshot correction writes audit history atomically. Empty Tracking accounts display `no balance recorded`, not zero.
- [ ] Test that snapshots do not appear in a transaction register or reconciliation workflow. No aggregate budget or net-worth total is required yet.
- [ ] Run focused checks and feature map. Commit: `feat: record manual Tracking balances`.

### Task 11 — Back up and restore to a new database

**Create:** `src/application/backup.ts`, `src/storage/backup.ts` (or extend Task 5 primitive here), `tests/integration/backup.test.ts`, `tests/cli/backup.test.ts`.
**Modify:** CLI dispatch, ports, feature map.

- [ ] Create a synthetic database with accounts, entries, snapshots, corrections, and reconciliation evidence. Test backup and restore to a fresh path, then compare all records and IDs. Run `npm test -- tests/integration/backup.test.ts tests/cli/backup.test.ts`; expect red.
- [ ] Use the SQLite backup API, not a copy of an open database file. Write a temporary output on the destination filesystem, close it, and verify integrity, foreign keys, application ID, and schema version before publishing it under a new name. Reserve the destination exclusively; never overwrite an existing file.
- [ ] Restore without mutating the backup. Validate a temporary copy before exposing the new target. Reject corrupt, unrelated, newer-schema, same-path, symlink, or existing destinations. Do not auto-upgrade a backup during restore; report the required app/schema version.
- [ ] Test failed backup/restore cleanup, interruption before publication, and an existing target containing unrelated data. Both source and existing target must remain unchanged. Verify private permissions on final and temporary files.
- [ ] Run a subprocess against the restored database and verify balances, IDs, versions, and review flags. No in-place restore or database switching is automatic.
- [ ] Run focused checks and feature map. Commit: `feat: back up and restore local account data`.

### Task 12 — Full checks, local hook, and conditional CI

**Create or extend:** `.husky/pre-commit`, `.secretlintrc.json`, `scripts/check-secrets.ts`, `tests/policy/check-runner.test.ts`; `.github/workflows/check.yml` when a remote is configured.
**Modify:** scripts/package manifest, README, verification guide.

- [ ] Test that the full check runner forwards child failures and that no later successful command hides an earlier failure. Test a synthetic secret fixture in a temporary Git repository with the selected scanner. Do not put a real credential or realistic credential string in the project history.
- [ ] Use the existing Secretlint configuration and pin Secretlint plus its recommended rule preset in npm dependencies. Implement `scripts/check-secrets.ts` for staged and tracked content using Git argument arrays and NUL-delimited paths. Scan staged blob contents, not unstaged working copies. Check the repository history before publishing through the same scanner over historical blobs. Test added, modified, renamed, and deleted files. `check:secrets` must fail with a clear diagnostic if unavailable; never silently skip it.
- [ ] Define `npm run check` to run document/private-file/boundary checks, formatter, lint, types, all tests (including CLI and feature map), and build. `npm ci` must recreate the dependency tree. Test under macOS locally; use Linux in CI when available.
- [ ] Install Husky after Git is verified. Keep the hook quick: staged private-file and secret checks plus lint. CI runs the full check independently of the hook. Review staged paths before the first application commit even before the hook exists.
- [ ] If a remote exists, add PR/default-branch CI with read-only permissions, pinned reviewed action SHAs, the pinned Node runtime, `npm ci`, the pinned npm secret scanner, and `npm run check`. No private-data artifacts or provider secrets. Verify required status checks in repository settings if authorized and supported. Otherwise record CI/merge protection as pending with the exact missing condition; do not create a remote for this task.
- [ ] Run `npm run check`. Update enforcement status only for checks actually run. Commit: `ci: verify manual-account workflows and repository policy`.

### Task 13 — Demo, review, and slice completion

**Create:** `docs/slice-1-demo.md`; maintain `docs/superpowers/plans/2026-10-17-slice-1-progress.md`.
**Modify:** README, docs index, feature map, design current-state/next-step sections.

- [ ] Write a runnable demo using a newly created temporary directory and only synthetic data. Capture generated account IDs from JSON, not copied IDs. Show create → entries → mismatch → reconcile → correction → review flag → re-reconcile → snapshot → backup → restore.
- [ ] Document exact commands, expected amounts, exit codes, and cancellation behavior. Feature-map verification runs these same workflows through real CLI processes. File references must exist, and mapped commands must produce the stated visible signals.
- [ ] Run `npm ci`, `npm run check`, and the demo using the built CLI from outside the repository directory. Confirm no test opens `ynab-export/` or an unrequested database.
- [ ] Request code review against the design and conventions using superpowers:requesting-code-review. Fix material findings with focused regression tests. Run final checks after the last code change using superpowers:verification-before-completion.
- [ ] Record actual command results and limitations. Keep CI pending if no remote exists. Do not label later slices or scheduled Tracking updates complete.
- [ ] Commit: `docs: record Slice 1 demo and verification`. Present the runnable result for user review before planning Slice 2.

## Completion checklist

- [ ] Cash/Credit accounts work with no provider or imported history.
- [ ] Account IDs remain stable after rename and opening corrections.
- [ ] Signed balances, cents, dates, and cutoff rules pass meaningful edge cases.
- [ ] Identical manual purchases remain separate.
- [ ] Clearing, reconciliation, mismatches, and correction review work after restart.
- [ ] Tracking balances are dated snapshots, not summed transactions.
- [ ] Failed writes and stale confirmations leave no partial records.
- [ ] Backup/restore preserves the complete record and never overwrites a live target.
- [ ] Documented terminal workflows run against isolated synthetic data.
- [ ] Local checks pass; CI and merge protection status are stated accurately.
- [ ] No YNAB import, Plaid integration, envelope calculation, or web interface is claimed.

## Sources for implementation choices

Checked October 17, 2026. Recheck exact package versions during Task 1 rather than treating this plan as a lockfile.

- [Node releases](https://nodejs.org/en/about/previous-releases): Node 24 is LTS; prefer a supported LTS runtime.
- [Drizzle SQLite](https://orm.drizzle.team/docs/get-started/sqlite-new): ORM support for better-sqlite3.
- [Drizzle Kit generation](https://orm.drizzle.team/docs/drizzle-kit-generate): generated SQL and custom migrations.
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md): selected synchronous driver and backup API. Validate compatibility with the pinned runtime on the target machine.
- [SQLite backup](https://www.sqlite.org/backup.html): use database-aware backup rather than copying an open database file.

## Review and handoff

Independent document review on October 17, 2026: approved, with no blocking gaps. Clarified the restore path exception and manual staged-file inspection before automated policy checks exist. A second review approved the final update that reconciles the plan with tool-setup files that appeared during planning. Re-read those files before execution. The user subsequently selected Drizzle ORM; the schema, types, and migration tasks now reflect that decision. Execution is a separate task; no implementation was performed as part of writing this plan.
