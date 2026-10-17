# Slice 1 implementation progress

## October 17, 2026 — Task 1

Scope: terminal help and error dispatch, subprocess harness, exact database dependency pins, and emitting build. Account workflows remain planned. This session stops after Task 1. Existing user changes remain unstaged and uncommitted.

### Versions and compatibility

The existing Node.js 24.16.0 pin and all existing exact tool versions are retained. Node 24 is supported LTS according to the [official release schedule](https://nodejs.org/en/about/previous-releases).

| Package | Exact version | Official npm Node engine |
| --- | --- | --- |
| TypeScript | 6.0.3 | >=14.17 |
| tsx | 4.23.15 | >=18.0.0 |
| Vitest | 5.0.5 | ^22.12.0 or ^24.0.0 or >=26.0.0 |
| ESLint | 10.13.0 | ^20.19.0 or ^22.13.0 or >=24 |
| typescript-eslint | 8.71.2 | ^18.18.0 or ^20.9.0 or >=21.1.0 |
| Prettier | 3.9.10 | >=14 |
| Husky | 9.1.7 | >=18 |
| drizzle-orm | 0.45.4 | Not declared |
| drizzle-kit | 0.31.11 | Not declared |
| better-sqlite3 | 13.0.3 | >=22 |
| @types/better-sqlite3 | 9.6.0 | Not declared |

Checked exact package metadata through the [official npm registry](https://registry.npmjs.org/). ORM 0.45.4 accepts better-sqlite3 >=7 and its types. ORM and Kit use the released stable tags, not release candidates. The current online Drizzle quick start shows RC commands; those commands were not copied. An in-memory driver/ORM query returned `{ value: 1 }` on Node 24.16.0. No persistent database was created.

### Red and green evidence

- Baseline: `npm run check` passed before implementation: 8 test files, 49 tests. Document, tracked-path, format, lint, types, and secret checks passed.
- Red: `npm test -- tests/cli/help.test.ts` discovered 4 subprocess tests and failed all 4. After correcting the helper's loader resolution for an external working directory, subprocess diagnostics confirmed missing `src/cli/main.ts`; actual exit 1 differed from expected 0 or 2.
- Green: the same focused command passed all 4 tests. Help exits 0; unknown commands and flags, including an unknown flag beside `--help`, exit 2. Tests verify separate output streams and empty temporary working directories.
- `npm run lint` and `npm run typecheck` passed. Strict NodeNext, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` are enabled.
- `npm run build` passed and emitted `dist/cli/main.js`. Source and built help matched byte-for-byte in an external temporary directory, with exit 0, empty stderr, and no files created.
- Independent specification and code-quality reviews approved Task 1 with no material findings.
- Final `npm run check` passed: 9 test files, 53 tests, plus document, tracked-path, format, lint, type, secret, and build checks. The full check now includes the build.

### Remaining concerns

`npm audit` reports 4 moderate development-dependency findings through `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild`. They refer to [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), which concerns the esbuild development server. The selected stable Kit still includes that dependency. No development server is started. No forced downgrade or dependency override was applied. The runtime dependency installation reported zero vulnerabilities.

Task 2 and all persistent data workflows remain open. No Task 1 commit was made because the tool baseline is existing user work.


## October 17, 2026 — Task 2

Scope: document fixtures, private-path checks, source import boundaries, and the sequential full-check runner. No account operation is added. The user accepted the four development-dependency audit findings and authorized Task 2.

- Reused the existing temporary document tests under `tests/policy/docs.test.ts`. All four cases passed before changes; no missing document behavior was claimed.
- Red: the required three-file policy command found the missing boundary checker and a staged-mode failure: a previously committed private path was incorrectly included in the staged set. With an empty boundary-check skeleton, 21 forbidden dependency cases failed as expected. Runner tests found the missing runner module.
- Additional red cases: three cross-domain imports passed incorrectly; a staged private-path type change was missed. The focused tests confirmed those failures before the fixes.
- Green: TypeScript AST and module resolution enforce domain, application, and CLI imports, including aliases, re-exports, import types, and dynamic imports. Computed imports and unresolved dependencies fail in restricted modules. Domain modules import their own directory and shared helpers only. `src/bootstrap.ts` owns composition.
- Private checks retain the default candidate scan and add explicit `--staged` and `--tracked` modes. Temporary Git fixtures verify force-staged ignored files, NUL-delimited names, generated synthetic JSON, staged type changes, and deletions. The existing secret-scanner candidate API is unchanged.
- The full runner runs every current check in order and stops with the first failure. Tests verify the failure status and that later checks do not run.
- Verification: `npm test -- tests/policy/docs.test.ts tests/policy/private-files.test.ts tests/policy/boundaries.test.ts` passed. `npm run check` passed, including document, private-path, boundary, format, lint, type, test, secret, and build checks. Final results: 12 test files and 86 tests passed. The required three-file policy command passed all 35 tests. The TypeScript runner needed broader local execution access for its IPC socket; no external service was used.

- Independent specification and code quality reviews approved Task 2 with no material findings. The lead agent also ran the full check: 12 test files and 86 tests passed, with all checks and the build passing.

Task 2 is complete. The task commit is `chore: enforce source and private-data boundaries`. Later account workflows remain open.

## October 17, 2026 — Task 3

Scope: focused contract, inference, and comment lint rules. No account operation is added. The existing rules were active before this task; they were moved into `tools/eslint-plugin-inab/` and loaded as the `inab` plugin. Existing unit tests now use the moved sources. The TypeScript-only source rule remains separate. No package change was needed.

- Inspected the matching SuChef rules and interface/comment tests. Its focused sources and package metadata contained no license notices. Existing INAB changes remain: `approved:` comments, no form-data or shared-helper exemptions, and raw input fields allowed only for named raw types in adapters.
- Red: `npm test -- tests/policy/lint-rules.test.ts` passed 18 existing-behavior cases and failed three new scope cases. The raw-input exception incorrectly reached a method's output. An `unknown[]` operation parameter was missed. A guard accepted an unrelated `unknown` parameter. An initial test-helper parser setup error for non-TypeScript files was corrected before recording this red result.
- Green: all 21 installed-configuration tests passed after the focused fixes. They also verify domain/application fields, undefined results, raw adapter inputs, complete adapter outputs, SDK contract references, parsers, row validators, guards, tagged unions, redundant annotations, standard assertion/literal checks, source/test comments, and source/tool extensions. Existing standalone unit coverage remains active.
- The unknown rule checks direct and nested written parameter annotations; it does not resolve type aliases or prove that a parser validates data. Raw-input optional-field exceptions stop at function boundaries. A guard exemption applies only to its checked parameter.
- Review red and green: an added rest-parameter case failed because the parser stores its annotation on the rest node. The rule now reads that annotation before checking the argument. Typed rest parameters and parser rest inputs remain allowed. All 23 focused policy tests pass.
- Verification: focused tests, `npm run lint`, and `npm run typecheck` passed. `npm run check` passed all document, private-path, boundary, format, lint, type, test, secret, and build checks: 13 test files and 109 tests. The runner needed broader local execution access for its IPC socket, as in Task 2.

Independent specification review passed. Code quality review found the rest-parameter gap recorded above, then approved the fix with no remaining material findings. Task 3 is complete. The task commit is `chore: enforce explicit contracts and useful comments`. Task 4 remains open.

## October 17, 2026 — Task 4

Scope: exact USD cents, date validation, and pure Cash/Credit balance rules. No database or account command is added.

- Red: `npm test -- tests/unit/money.test.ts tests/unit/dates.test.ts tests/unit/balances.test.ts` failed all three suites because the required modules did not exist.
- Green: the same command passed all 66 tests. Decimal parsing uses integer arithmetic before conversion to safe integer cents. Tests cover both safe limits, invalid decimal forms, unsafe inputs, intermediate overflow, and zero amounts by use.
- Strict calendar dates stay as strings. Tests reject invalid leap days and run the same date parser in Honolulu, Chicago, and Kiritimati subprocesses. No midnight conversion or system clock is used by domain code.
- Balance tests verify the synthetic 91500 working / 97500 cleared / -6000 uncleared example, signed credit balances, old pending purchases, posting after the report cutoff, account ownership, and opening boundaries. Tracking accounts have null opening values and no register balance.
- Balance calculation returns an explicit result because invalid entries and unsafe sums are expected failures. Working includes all register entries. Cleared includes postings strictly after opening through the cutoff. Uncleared includes only entries without a posted date.
- Entry validation accepts a separate current local date for writes and rejects future activity. A historical report cutoff does not act as the current date. No future-entry or snapshot command is added.
- Focused tests, `npm run lint`, and `npm run typecheck` passed. `npm run check` passed all document, tracked-path, boundary, format, lint, type, test, secret, and build checks: 16 test files and 175 tests. As in prior tasks, the runner needed broader local execution access for its temporary IPC socket. Review results follow separately.

Independent specification and code quality reviews approved Task 4 with no material findings. The lead agent also ran the full check: 16 test files and 175 tests passed, with all checks and the build passing.

Task 4 is complete. The task commit is `feat: define exact manual-account balances`. Task 5 remains open.


## October 17, 2026 — Task 5

Scope: safe SQLite initialization, the first generated Drizzle schema and custom trigger migration, history checks, upgrade backups, and explicit terminal targets. No account operation or user restore command is added. Bootstrap wiring is introduced now so CLI modules do not import storage.

- Red: `npm test -- tests/integration/migrations.test.ts tests/cli/init.test.ts` failed because storage did not exist and init returned exit 2. The first green run passed all seven initial tests.
- Generated `0000_manual_accounts.sql` with pinned Kit 0.31.11 and generated the custom `0001_reconciliation_account_guard.sql` in the same chain. The lead reviewed SQL and metadata before any application. All applications used temporary synthetic databases. Regenerating the unchanged schema reported no schema changes and created no migration.
- Schema tests check nullable opening pairs, required values, USD/classes/status/source, integer storage and safe ranges, foreign keys, unique snapshot and reconciliation keys, and same-account evidence after child and parent changes. Ordinary Drizzle queries return safe money values as numbers; raw migration history uses checked integer conversion.
- History preflight compares the full ordered ledger prefix with committed SQL hashes and timestamps, and uses that known ledger sequence as the schema version. Unknown ledger rows, newer versions, changed history, changed SQL artifacts, and unrelated application IDs fail before migration. Missing read/migration targets do not create files.
- The pinned Drizzle migrator rolls back all application schema on a midway failure. Its own empty ledger table can remain because it creates that table before its transaction. The pinned SQLite ledger uses `SERIAL`, so its `id` is null; validation uses ledger row order with exact hash/timestamp pairs rather than assuming generated integer IDs.
- A synthetic version-1 fixture upgrades with its account record retained. The online SQLite backup keeps the prior schema/data and passes integrity checks. Backup failure stops the upgrade. New backups use private temporary files, check identity/version/integrity/foreign keys, then publish exclusively. Failure removes temporary output; an existing destination stays unchanged. Private database, directory, journal, backup, and temporary permissions are verified on this macOS host. Linux uses the same file modes; CI evidence is pending.
- A two-connection test confirms immediate Drizzle transactions block a second writer and roll back changes on failure. Writable application connections enable and verify foreign keys, set a bounded busy timeout, and use the DELETE journal mode.
- Additional red/green cases found missing human target preview, publication of an incomplete backup, and missing migration metadata in an isolated built bundle. Each test failed before its fix. Source and built modules now resolve their own migration paths without the current directory or a source-tree fallback. The built test creates an isolated copy and runs init twice from outside the repository.
- Before review, `npm run check` passed: 18 test files and 198 tests, including 23 storage/CLI cases. Document, private-path, boundary, format, lint, type, secret, and build checks all passed. The first full run stopped at generated JSON formatting; formatting preserved parsed metadata values and SQL hashes. Regeneration still reported no schema changes. The test/build tool required broader local execution access for its IPC socket, as in prior tasks. No external service or household database was used.

- Quality review found a split commit defect: Drizzle committed schema/history before a separate schema-header write. A regression injected a failure immediately after the native commit; reopening then failed on the mismatched header. The fix removes the second writable version and uses the validated Drizzle ledger sequence for runtime and backup checks. The same regression now reopens successfully and repeated init reports the committed version. See the [implementation decision](../../decisions/2026-10-17-migration-version-authority.md).

- After the review fix, `npm run check` passed again: 18 test files and 199 tests, including 24 storage/CLI cases. All policy, format, lint, type, secret, and build checks passed.

Independent specification and code quality reviews approved the revised implementation with no remaining material findings.

Task 5 is complete. The task commit is `feat: initialize private SQLite storage`. Task 6 remains open. The four accepted development-dependency audit findings remain unchanged.


## October 17, 2026 — Task 6

Scope: local account create/list/show/rename/opening commands, application-owned ports, atomic account/history storage, and the first hand-edited account workflow map. No migration or Task 7 transaction command is added.

- Red: `npm test -- tests/integration/accounts.test.ts tests/cli/accounts.test.ts` failed because account operations were absent and account commands returned exit 2. The first green run passed nine tests.
- Added creation contracts without placeholder identity, generated permanent account and operation IDs, injected IDs/clocks, USD validation, and signed cents. Tracking has null opening values and shows "no balance recorded". Duplicate names remain separate IDs. Local date defaults are shown in terminal prompts; scripts require explicit dates.
- Writes preview database target, ID/revision, and complete old/new values. Edits require the expected revision. Storage rechecks revision and operation constraints inside an immediate transaction. Account and complete before/after history changes roll back together on an injected history failure. Storage errors report the attempted operation ID; no retry occurs.
- Opening corrections reject posted entries on or before the new boundary and recheck after preview. Corrections stop when reconciliation evidence exists until its review workflow is implemented in Task 9. Account class and currency remain immutable. Mutated-preview regression tests failed before commit-time validation was added.
- Account and transaction reads validate raw values before display. Normal account operations require the latest migration ledger. Timestamp regressions rejected date-only/local forms after a failing test showed `Date.parse` accepted them; row timestamps now require canonical UTC ISO with seconds or milliseconds.
- The hand-edited map records exact synthetic terminal commands and expected success/failure signals. Its test executes those commands against a new temporary database, captures generated ID/revision, and rejects bad structure, duplicate workflow IDs, and broken source references. The map is not generated from command output.
- Additional red/green checks covered exact planned `--as-of` and correction `--amount` flags, storage failure operation IDs, and human working/cleared/uncleared display. Focused checks include prompt input, date default, explicit dates, confirmation, stale revisions, missing IDs, raw row corruption, and rollback.
- Lead-agent real-terminal checks used only a temporary synthetic database. Typing `cancel`, answering `no` at confirmation, and Ctrl+C during input returned 0 with canceled output and left no account. A full cash creation showed the local date default, signed amount, database target, and ID/revision before confirmation. A canceled rename showed the same ID and revision 1 to 2 preview but preserved the original account at revision 1. A fresh process showed working/cleared 100000 cents and uncleared 0; the audit table held exactly one successful write after all cancellation cases. The temporary directory was removed.

- A late correction regression failed when a safe opening amount caused an unsafe total with an existing one-cent entry. The correction now checks the pure balance rules at preview and inside the immediate write transaction, including entries added after preview; rejection preserves account and history.
- Combined account inspection reads metadata and entries and computes totals within one storage snapshot. Its regression commits a correction immediately after the read: the returned old revision, opening, and totals agree, while a fresh inspection returns the new revision, opening, and totals.
- The feature-map validator rejects literal database targets before execution and permits only the temporary `${database}` target for database steps. Its invalid-target regression failed before this guard.
- Verification: the focused account, prompt, and feature-map command passed 23 tests; lint and typecheck passed. `npm run check` passed all document, tracked-path, boundary, formatting, lint, type, test, secret, and build checks: 22 test files and 222 tests, including the isolated built-init regression. The strengthened snapshot race regression also passed afterward. TypeScript runners required broader local execution access for temporary IPC sockets. No external service or household data was used.

Independent specification and code quality reviews approved Task 6 with no remaining material findings. The lead agent ran the final full check: 22 test files and 222 tests passed, with all checks and the build passing.

Task 6 is complete. The task commit is `feat: manage local accounts from the terminal`. Task 7 remains open. The four accepted development-dependency audit findings remain unchanged.


## October 17, 2026 — Task 7 implementation

Scope: manual Cash/Credit transaction add, edit, clear, unclear, and register commands. Reconciliation commands and invalidation remain for Tasks 8 and 9.

- Red: `npm test -- tests/integration/transactions.test.ts tests/cli/transactions.test.ts` failed because the application module was absent and the CLI rejected `--account`.
- Core green: the initial three focused tests passed with exact USD parsing, separate permanent IDs, working 91500 / cleared 97500 / uncleared -6000 after subprocess restarts, corrections, clearing, stale previews, overflow rejection, and audit rollback.
- Expanded tests cover old pending activity, posting boundaries, future activity, signed credit balances, cleared/uncleared overflow, metadata preservation, reconciliation guards, missing script input, and strict flags. The hand-written transaction map executes real commands and captures transaction IDs/revisions before each later edit.
- A timestamp precision regression failed before the ordering fix. Register order compares occurrence date, chronological creation time, and ID. A second regression proved that different account/register sum ordering could make account inspection fail after a safe correction. Both paths now use the same pure ordering helper; both regressions pass.
- Transaction mutation, account revision advance, and before/after audit evidence share an immediate write transaction. Confirmation rechecks transaction and account revisions and validates the current register before saving. Reads use one database snapshot.
- Temporary protection: when reconciliation evidence exists, changes to cleared amounts or posting dates are refused. Pending changes and payee/memo-only corrections remain available. Existing evidence is retained. Task 9 will replace this conservative guard with affected-check invalidation.

- Verification: lint, typecheck, and six focused suites passed 33 tests. The lead agent's final `npm run check` passed all document, tracked-path, boundary, formatting, lint, type, test, secret, and build checks: 24 test files and 232 tests.
- The first full run overlapped the specification review's focused tests. Two existing account CLI tests and one reviewer CLI test exceeded the five-second test limit, with no assertion failures. The full suite passed when run alone; no timeout setting was changed.
- Independent specification and code quality reviews approved Task 7 with no material findings. The specification reviewer also verified Ctrl+C at transaction confirmation in a real terminal: exit 0 and an empty register.

Task 7 is complete. The task commit is `feat: record and clear manual transactions`. Task 8 remains open. The four accepted dependency audit findings remain unchanged.
