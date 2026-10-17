# Migration version authority

Date: October 17, 2026.

Status: implementation decision within the approved Slice 1 plan. This records an implementation constraint, not a new product decision from the user.

The validated Drizzle migration ledger is the schema version authority. The version is the number of applied entries in the known migration sequence. Each recorded entry must match the committed SQL hash and journal timestamp at that position. Reject unknown entries, extra entries, changed hashes, and gaps in the known sequence. Keep the application ID check separate from schema history validation.

Do not store a second writable schema version in SQLite's `user_version` header. The pinned Drizzle migrator commits schema changes and ledger entries together. A later header write has a separate failure boundary: an interruption can leave committed schema and history that a header comparison rejects. A regression test injects a failure immediately after the native migration commit and confirms that the database can reopen and repeated init reports the committed version.

Backups and later restore checks must validate the same known ledger sequence and application ID. A private backup must pass integrity and foreign-key checks before exclusive publication. Do not add another migration ledger or runner.

The owning validation helper is [migration-history.ts](../../src/storage/migration-history.ts). The [migration integration tests](../../tests/integration/migrations.test.ts) verify the commit boundary, history checks, prior-version upgrade, and backup sequence.
