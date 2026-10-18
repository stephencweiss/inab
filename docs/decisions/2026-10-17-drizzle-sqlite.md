# Use Drizzle with SQLite

Date: October 17, 2026
Status: agreed by the user.

Use Drizzle ORM with better-sqlite3 and SQLite. Use Drizzle Kit to generate SQL migrations. Review and commit generated SQL and metadata before applying changes.

Drizzle TypeScript table definitions own the schema. Derive stored row types from those tables. Keep raw SQL for operations that need it, including database-specific constraints and custom migrations. Preserve transaction, backup, and migration checks.

This replaces the Slice 1 proposal to use handwritten SQL schemas without an ORM. It changes the plan and conventions; it does not authorize or claim dependency installation in this turn.

- [SQLite support](https://orm.drizzle.team/docs/get-started/sqlite-new)
- [Migration generation](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [Updated implementation plan](../superpowers/plans/2026-10-17-slice-1-manual-accounts.md)
