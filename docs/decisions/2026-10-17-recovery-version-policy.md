# Recovery version policy

Status: accepted implementation constraint for Slice 1.

Public backup and restore require the current schema. Validate the INAB application ID and the complete known Drizzle migration ledger before copying. Refuse older, newer, changed, or unknown history and report the recorded and supported schema versions where available. Recovery does not run migrations.

The migration backup primitive retains its separate role. It can preserve a validated older ledger prefix before an explicit upgrade. The validated ledger remains the only schema version authority.

Use SQLite's backup API to create a consistent temporary database on the destination filesystem. Validate integrity, foreign keys, application ID, and schema version before publishing a new file exclusively. New files use owner-only read/write access. New directories use owner-only access. Never overwrite an existing target or change an unrelated path's permissions.

Backup and restore leave their sources unchanged. Restore publishes a new database path; it neither replaces a live database nor selects the restored database automatically. The user inspects it and supplies its path explicitly for later commands.

Confirmation applies to the source file shown in the preview. Check its file identity before copying and before publication. Refuse a replacement file. Committed changes to the same source file remain allowed; SQLite copies a consistent current state.
