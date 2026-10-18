# Database schema and migrations

Status: required implementation standard; automated enforcement is planned.

Adapted from SuChef's database schema convention for Drizzle and SQLite. PostgreSQL grants are not used.

Record schema changes as ordered migrations in source control. Review their SQL. Never edit a migration already applied to a persistent database; add another migration.

Drizzle TypeScript table definitions are the schema authority. List every schema file explicitly in `drizzle.config.ts`; do not use a glob or a barrel to hide new files. Use the SQLite dialect. Verify that all schema files are included.

Generate migrations with Drizzle Kit. Review and commit the SQL and generated metadata together. Use a custom migration in the same chain for triggers or other SQL that Drizzle cannot represent. Apply through the application's target-aware, backup-first migration command and the Drizzle migrator. Do not maintain a second migration runner or use `drizzle-kit push` against persistent data.

Define database CHECK constraints explicitly; inferred TypeScript types do not enforce them. Test the applied schema, migration history validation, and rollback behavior. Keep the ORM and Kit versions compatible and pinned.

Before applying a migration to household data, create a usable backup. Test upgrades on a temporary copy. Do not assume every migration can run backward; document restore-based recovery when needed.

Verify a new database, an upgrade from the prior schema, constraints, and failure recovery. SQLite connection setup must enable and verify foreign-key enforcement. Do not run tests or sample-data seeds against the user's database.
