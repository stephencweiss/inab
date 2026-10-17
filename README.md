# INAB

A personal envelope-budgeting app for one household. Terminal first; protected family web access later.

Status: local account creation, inspection, rename, and opening correction work from the terminal. Private database initialization, migrations, and the check baseline are installed.

Run `npm run inab -- --help` for command status. `npm run build` creates the terminal entry point at `dist/cli/main.js`.

Start with the [document guide](docs/README.md), [project design](docs/superpowers/specs/2026-10-17-inab-design.md), and [verification plan](docs/verification.md).

## Initialize storage

Use an explicit path and confirm the write:

```sh
npm run inab -- --db /absolute/private/path/plan.sqlite init --confirm
```

Add `--json` for a structured result with the database path and schema version. Repeated init preserves the schema. Only init creates a database; other database commands require an existing target. New directories use owner-only access, and new database files use owner-only read/write access. Init rejects a symlink target and an unrelated database.

Generate schema changes with `npm run db:generate -- --name=NAME`. Review and commit generated SQL and metadata together. Apply reviewed migrations to an existing target with `npm run db:migrate -- --db /absolute/private/path/plan.sqlite`. Existing-data upgrades first create a consistent private SQLite backup beside the database. Unknown or changed migration history fails before migration. User backup and restore commands remain planned.

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

Use the returned account ID and current revision for edits. Duplicate names remain separate accounts. Cash inflows are positive; cash outflows and credit debt are negative. Opening amounts are the bank's posted closing balance on the stated date. Currency is USD. Tracking creation uses `--kind tracking` without an opening amount or date; it shows "no balance recorded" until snapshot support is added.

In a terminal, omitted values prompt for input. The date prompt shows today's local calendar date. Confirm the target and old/new values, or enter `cancel`. Scripts require complete input, `--as-of` for opening balances, and `--confirm`. `--json` keeps standard output structured and sends errors to standard error. Exit codes are 0 for success or cancellation, 2 for invalid input, 3 for a missing account, 4 for a stale revision, and 1 for a storage failure. Each successful write returns an operation ID; a write failure reports that ID for inspection before any retry.

Opening corrections reject posted entries inside the new opening period. Corrections also stop when reconciliation evidence exists; its review workflow comes later. Transaction, snapshot, and reconciliation commands remain planned. The [account workflow map](docs/agent/feature_map.json) contains executable synthetic examples.

## Conventions

- [Maintain convention files and indexes](docs/conventions/writing-conventions.md)
- [Test executable behavior before implementation](docs/conventions/red-green-development.md)
- [Define complete values and validate inputs](docs/conventions/interfaces.md)
- [Use inferred types and safe guards](docs/conventions/type-inference.md)
- [Document constraints and check comment forms](docs/conventions/jsdoc.md)
- [Place helpers and check module boundaries](docs/conventions/utilities.md)
- [Keep database operations safe and atomic](docs/conventions/database-access-rules.md)
- [Review migrations and verify recovery](docs/conventions/database-schema.md)
- [Document and verify working user workflows](docs/conventions/feature-map.md)
- [Protect private data and bound agent work](docs/conventions/agent-safety.md)
