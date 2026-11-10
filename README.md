# INAB

A personal envelope-budgeting app for one household. Terminal first; protected family web access later.

Status: Slices 1 and 2 provide local account workflows and setup migration. The user reports local migration complete. Slice 3 adds budget activation, categories, assignments, spending allocation, transfers, and card payment reserves. The user completed Slice 3 manual review on November 10, 2026.

Next: publish and review the Slice 3 pull request. The [demo](docs/slice-3-demo.md), [accounting examples](docs/budget-examples.md), and [closeout record](docs/superpowers/plans/2026-11-10-slice-3-closeout.md) record scope and verification. Keep household activation separate from synthetic checks.

Run `npm run inab -- --help` for command status. Terminal launches show an INAB banner; JSON, scripts, and version output stay plain. `npm run build` creates the terminal entry point at `dist/cli/main.js`.

With `--json`, a terminal receives two-space indentation. Pipes and redirected files receive compact JSON. JSON errors use stderr's terminal state separately from stdout. Use `npm run --silent inab -- ... --json` when npm's command headers would interfere with parsing.

Start with the [document guide](docs/README.md), [project design](docs/superpowers/specs/2026-10-17-inab-design.md), and [verification plan](docs/verification.md).

## Initialize storage

Use an explicit path and confirm the write:

```sh
npm run inab -- --db /absolute/private/path/plan.sqlite init --confirm
```

Add `--json` for a structured result with the database path and schema version. Repeated init preserves the schema. Init creates a working database; restore creates a new copy. Other database commands require an existing source. New directories use owner-only access, and new database files use owner-only read/write access. Init rejects a symlink target and an unrelated database.

Generate schema changes with `npm run db:generate -- --name=NAME`. Review and commit generated SQL and metadata together. Apply reviewed migrations to an existing target with `npm run db:migrate -- --db /absolute/private/path/plan.sqlite`. Existing-data upgrades first create a consistent private SQLite backup beside the database. Unknown or changed migration history fails before migration.

The build bundles SQL and metadata under `dist/db/migrations/`. The built CLI can run from another working directory.

## Manage local accounts

Use the same explicit database target for each command:

```sh
npm run inab -- --db /absolute/private/path/plan.sqlite account add --name "Example cash" --kind cash --opening 123.45 --as-of 2026-10-16 --confirm --json
npm run inab -- --db /absolute/private/path/plan.sqlite account list --json
npm run inab -- --db /absolute/private/path/plan.sqlite account show ACCOUNT_ID --json
npm run inab -- --db /absolute/private/path/plan.sqlite account rename ACCOUNT_ID --name "New name" --expected-version 1 --confirm --json
npm run inab -- --db /absolute/private/path/plan.sqlite account opening ACCOUNT_ID --amount 100.00 --as-of 2026-10-15 --expected-version 2 --confirm --json
```

Use the returned account ID and current revision for edits. Duplicate names remain separate accounts. Cash inflows are positive; cash outflows and credit debt are negative. Opening amounts are the bank's posted closing balance on the stated date. Currency is USD. Tracking creation uses `--kind tracking` without an opening amount or date; it shows "no balance recorded" until the first snapshot is recorded.

In a terminal, omitted values prompt for input. The date prompt shows today's local calendar date. Confirm the target and old/new values, or enter `a` or `abandon`. Scripts require complete input, `--as-of` for opening balances, and `--confirm`. `--json` keeps standard output structured and sends errors to standard error. Exit codes are 0 for success or cancellation, 2 for invalid input, 3 for a missing account, 4 for a stale revision, same-date snapshot conflict, or reconciliation mismatch, and 1 for a storage failure. Each successful write returns an operation ID; a write failure reports that ID for inspection before any retry.

Opening corrections reject posted entries inside the new opening period. An opening amount or date correction marks all valid reconciliations `needs-review`. The preview lists affected IDs and cutoff dates. Confirmation saves the correction, review states, and audit records together. The [account workflow map](docs/agent/feature_map.json) contains executable synthetic examples.

## Initial setup and YNAB migration

After initializing an explicit private database path, run `npm run inab -- --db /absolute/private/path/plan.sqlite setup`. An interactive terminal offers start fresh or migrate from YNAB. Scripts can choose `setup fresh --confirm --json` or use `setup migrate preview --register REGISTER_CSV --plan PLAN_CSV --review NEW_PRIVATE_JSON --json`.

Migration requires an empty database with setup open. Review account class, closed state, opening balances, source history, and missing evidence through the guided `setup migrate review --review PRIVATE_JSON` command. Review choices stay in a private file and can resume while the database remains empty. Scripted changes use the printed source keys and `--expected-review N`. Final `setup migrate commit --review PRIVATE_JSON --expected-review N --confirm` creates a private backup, commits everything together, and closes migration. Choosing start fresh, including the first confirmed manual account creation, also closes migration.

The exports do not supply bank posting dates, split parents, account classes, or observed account balances. Source clearing labels are retained as evidence. History defaults to inspection without changing live balances; acknowledged coverage warnings remain visible. Explicit post-opening row decisions can create Cash/Credit register entries. Imported monthly values remain reference history; active budgeting is later work. Tracking observations and adjustment review are available only within import/history; general manual Tracking transactions remain future work.

Use `import history accounts`, `import history register ACCOUNT_ID`, `import history plan --month YYYY-MM`, and `import history report IMPORT_ID` to inspect the result. Import/history commands require the same explicit `--db`. Later YNAB imports are refused. To migrate again, create a new database and preserve the old one. See the [synthetic demo](docs/slice-2-demo.md) for a complete runnable example. Review files and exports stay outside the checkout.

## Activate and use a budget

After setup, start a separate reviewed budget activation. An earlier month is supported when its opening state and activity through today can be verified. Migration setup stays closed.

```sh
npm run inab -- --db /absolute/private/path/plan.sqlite budget activation start --month YYYY-MM --review /absolute/private/path/new-budget-review.json
npm run inab -- --db /absolute/private/path/plan.sqlite budget activation review --review /absolute/private/path/new-budget-review.json --interactive
npm run inab -- --db /absolute/private/path/plan.sqlite budget activation preview --review /absolute/private/path/new-budget-review.json --json
npm run inab -- --db /absolute/private/path/plan.sqlite budget activation commit --review /absolute/private/path/new-budget-review.json --expected-review N --confirm --json
npm run inab -- --db /absolute/private/path/plan.sqlite budget show --month YYYY-MM
```

Opening ordinary category balances must reflect the prior month rollover. Missing values, unresolved negative ordinary openings, missing activity, and unexplained balance differences block activation. The [demo guide](docs/slice-3-demo.md) gives complete script input and pending/bridge rules. Imported monthly values remain source history; only confirmed opening and assignment facts become active.

Use `budget status` for the current revision. Category add/rename/archive/unarchive/reorder, `budget assign`, `budget move`, `budget allocate`, `budget transfer`, and `budget activity` use that revision and explicit confirmation. Assignment amounts set monthly totals. Transfers create or link equal opposite legs; card payments do not count spending twice. Cash/Tracking boundary flows keep Tracking snapshots separate. Credit advances and Credit/Credit transfers remain unsupported.

New transactions are visibly unallocated until reviewed. Reports stay incomplete and new assignments wait until that activity is allocated. Amount edits with an existing split require an explicit return to unallocated and a replacement allocation. Opening changes or date changes across the active boundary require a reviewed opening amendment. Backdated changes recalculate later months. Future assignments cannot reuse committed funds.

## Conventions

- [Maintain convention files and indexes](docs/conventions/writing-conventions.md)
- [Test executable behavior before implementation](docs/conventions/red-green-development.md)
- [Run local Git quality checks](docs/conventions/git-quality-checks.md)
- [Define complete values and validate inputs](docs/conventions/interfaces.md)
- [Use inferred types and safe guards](docs/conventions/type-inference.md)
- [Document constraints and check comment forms](docs/conventions/jsdoc.md)
- [Place helpers and check module boundaries](docs/conventions/utilities.md)
- [Keep database operations safe and atomic](docs/conventions/database-access-rules.md)
- [Review migrations and verify recovery](docs/conventions/database-schema.md)
- [Document and verify working user workflows](docs/conventions/feature-map.md)
- [Explain demo goals before instructions](docs/conventions/demo-guides.md)
- [Protect private data and bound agent work](docs/conventions/agent-safety.md)

## Record manual activity

```sh
npm run inab -- --db /absolute/private/path/plan.sqlite transaction add --account ACCOUNT_ID --date 2026-10-17 --amount -60.00 --payee "Synthetic shop" --confirm --json
npm run inab -- --db /absolute/private/path/plan.sqlite register ACCOUNT_ID --json
npm run inab -- --db /absolute/private/path/plan.sqlite transaction edit TRANSACTION_ID --date 2026-10-17 --amount -55.00 --payee "Synthetic shop" --memo "Correction" --expected-version 1 --confirm --json
npm run inab -- --db /absolute/private/path/plan.sqlite transaction clear TRANSACTION_ID --posted-on 2026-10-17 --expected-version 2 --confirm --json
npm run inab -- --db /absolute/private/path/plan.sqlite transaction unclear TRANSACTION_ID --expected-version 3 --confirm --json
```

Use returned transaction IDs and revisions. Identical purchases remain separate. Add accepts optional `--memo` and `--posted-on`. Edit requires `--memo`; use `--memo ''` to clear it. Edit keeps the posting state. Use clear or unclear to change it. Each transaction write also advances the account revision.

An old pending purchase can occur before opening. Its posting date must be after opening and on or after occurrence. Future activity is refused because scheduled entries are deferred. Tracking registers and transaction writes are not supported in Slice 1. Register output shows signed working, cleared, and uncleared amounts. It reads account values and entries from one database snapshot.

Amount or posting corrections mark affected reconciliations `needs-review` from the earliest old or new posting date onward. Backdated cleared additions and unclearing use the same rule. Earlier checks stay valid. Pending, payee, memo, and occurrence-only corrections preserve valid checks. The preview lists affected check IDs and dates before confirmation. Failed writes report the operation ID; inspect the result before retrying.

## Reconcile a bank balance

```sh
npm run inab -- --db /absolute/private/path/plan.sqlite reconcile ACCOUNT_ID --as-of 2026-10-17 --bank-balance 975.00 --confirm --json
npm run inab -- --db /absolute/private/path/plan.sqlite reconciliation list --account ACCOUNT_ID --json
```

Compare the bank's posted closing balance at the cutoff with the cleared register balance. Pending entries stay uncleared. Credit debt is negative. A mismatch reports the difference, exits with code 4, and saves no reconciliation or adjustment. A match shows a preview and requires confirmation. Scripts require a cutoff, bank balance, and `--confirm` for a match. Terminal prompts show the local date default; an explicit date overrides it.

Confirmation rechecks the account revision and current balance, then saves the reconciliation, original entry evidence, and audit record together. Repeat confirmation at the same cutoff and account revision returns the existing record with `reused: true` and no new operation ID. Lists show the full opening and entry evidence. Registers show `reconciled` only when that evidence still matches current balance values. Payee and memo edits keep coverage and preserve the original evidence revision. Corrections preserve original evidence and mark affected checks `needs-review`. Confirmation rechecks both the account revision and the affected check list. A new check can confirm the corrected balance; old review records keep their original evidence and review state.

## Record Tracking balances

```sh
npm run inab -- --db /absolute/private/path/plan.sqlite snapshot add --account ACCOUNT_ID --as-of 2026-10-16 --balance 5200.00 --confirm --json
npm run inab -- --db /absolute/private/path/plan.sqlite snapshot list --account ACCOUNT_ID --json
npm run inab -- --db /absolute/private/path/plan.sqlite snapshot correct SNAPSHOT_ID --balance 5300.00 --expected-version 1 --confirm --json
```

Assets are positive; liabilities are negative; zero is valid. Each observation has an effective date, an observed timestamp, and source `manual`. Account show and list display the last known balance with its effective date and source. Observations are never summed. An older effective date does not replace the latest balance. Empty Tracking accounts show `no balance recorded`.

Only Tracking accounts accept snapshots. They cannot use the transaction register or bank reconciliation. Future effective dates are refused because scheduling is not supported. Scripts require the account, date, amount, and `--confirm` for add; correction requires the snapshot ID, amount, expected revision, and `--confirm`. Terminal input shows today's local date as a default. An explicit date overrides it.

A second add for the same account and date exits with code 4. The error gives the existing snapshot ID and revision and a `snapshot correct` command. Correction retains the ID and effective date, updates the observed timestamp, and advances the snapshot revision. Each snapshot write also advances the account revision. Confirmation rechecks both revisions and date uniqueness inside one write transaction. Snapshot, account revision, and original before/after audit evidence commit together. Stale previews exit with code 4. Storage failures report the operation ID; inspect the result before retrying.

Account show and list each read account values and latest observations from one database snapshot. Their JSON output adds `latestSnapshot` without replacing account IDs or existing account fields. The workflow map includes the complete synthetic snapshot sequence.

## Back up and restore

```sh
npm run inab -- backup --db /absolute/private/path/plan.sqlite --to /absolute/private/path/backup.sqlite --confirm --json
npm run inab -- restore --from /absolute/private/path/backup.sqlite --to /absolute/private/path/restored.sqlite --confirm --json
npm run inab -- --db /absolute/private/path/restored.sqlite account list --json
```

Each destination must be new. Existing targets, symlink endpoints, same-path copies, and conflicting destination sidecars are refused. Restore takes `--from` and `--to`; it does not take `--db`. Scripts require all paths and `--confirm`. Terminal prompts show the source and destination before confirmation. Cancellation creates no output.

Both commands read their source without changing it. SQLite creates a consistent temporary copy on the destination filesystem. The copy must pass integrity, foreign-key, application-ID, and schema-version checks before exclusive publication. New files use owner-only read/write access; new directories use owner-only access. A failed copy removes its temporary output and preserves any existing or racing destination.

Public recovery requires the current schema. Older, newer, or unknown migration history is refused; version mismatches report the file and required schema versions where available. Recovery never upgrades a file. The migration command retains its separate backup-before-upgrade workflow. See the [recovery version policy](docs/decisions/2026-10-17-recovery-version-policy.md).

Successful JSON results include the operation ID, source, destination, schema version, and `migrationNeeded: false`. A missing source exits with code 3. Invalid paths, existing destinations, and unsupported files exit with code 2. Unexpected failures exit with code 1 and report the operation ID and destination for inspection before a retry. Commands do not retry automatically.

Restore preserves account IDs, entries, snapshots, revisions, audit history, and reconciliation evidence and review states. It creates a separate database and does not switch later commands to it. Inspect the restored copy, then select its path explicitly with `--db`.

## Verify changes

Use `npm ci` to install the pinned dependencies. Run `npm run check` for documents, private paths, module boundaries, formatting, lint, types, all tests, current-file secrets, and the CLI build. The commit hook checks documents, staged private paths, staged secret contents, matching working files, lint, types, and unit tests. The push hook runs `npm run check:push` for the full check and publication scans from a clean current revision. See the [Git quality convention](docs/conventions/git-quality-checks.md) and [verification guide](docs/verification.md). Keep household data outside the repository.
