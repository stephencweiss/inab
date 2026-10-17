# INAB

A personal envelope-budgeting app for one household. Terminal first; protected family web access later.

Status: terminal help, private database initialization, migrations, and the check baseline are installed. Account workflows remain planned.

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
