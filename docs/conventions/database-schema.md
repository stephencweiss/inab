# Database schema and migrations

Status: required implementation standard; automated enforcement is planned.

Adapted from SuChef's database schema convention. PostgreSQL grants and Drizzle configuration are not copied into INAB.

Record schema changes as ordered migrations in source control. Review their SQL. Never edit a migration already applied to a persistent database; add another migration.

Keep one authoritative schema definition. If a schema generator is selected, make its inputs explicit and verify that every schema module is included. If SQL migrations are authoritative, do not maintain a second handwritten schema copy.

Before applying a migration to household data, create a usable backup. Test upgrades on a temporary copy. Do not assume every migration can run backward; document restore-based recovery when needed.

Verify a new database, an upgrade from the prior schema, constraints, and failure recovery. SQLite connection setup must enable and verify foreign-key enforcement. Do not run tests or sample-data seeds against the user's database.
