# YNAB migration only during initial setup

Date: October 21, 2026
Status: agreed by the user during Slice 2 planning.

Initial setup offers two paths: start fresh, or migrate from YNAB using the plan and register CSV files. YNAB migration is available only during this setup. Once setup is complete through either path, refuse further YNAB imports.

To migrate again, start a new plan in a separate database. Preserve the old database; this decision does not authorize deleting or resetting it. Restoring a backup remains a separate recovery workflow, not permission to merge YNAB data into an established plan.

Agreed October 22, 2026: migration requires an empty database with setup incomplete. Empty means no household accounts, transactions, snapshots, or imported plan/history records; installed schema and migration metadata do not count as household data. Confirming start fresh closes setup even if no accounts have been created.

Only the review before import can pause and resume through a private local review file. The database remains empty while the user reviews account mappings and other choices. Quitting and reopening resumes those saved choices, not a partly imported database. Terminal commands guide review without requiring direct file edits. Bind the review to its source CSV identities and setup target. Changed source files or target state require a fresh preview. Preview does not change active accounts. Successful import and setup completion commit together; failure leaves no partial plan.

Retry safety applies to this single setup attempt. A repeated confirmation after success reports that setup is complete and writes nothing. It does not enable another import. Preserve identical real purchases using source file identity and row position, not a hash of transaction values alone.

Remove Slice 2 support for merging YNAB history into existing manual accounts, matching manual transactions, or accepting subsequent revised exports into a completed plan. Existing installations with manual history are not migration targets. Previously initialized but unused databases must satisfy the same empty-database and incomplete-setup rules. Lack of a setup marker alone must not make an established database eligible.

The general future Plaid matching rules remain in scope for Slice 4. Tracking dates, adjustments, and review rules remain agreed; Slice 2 implements only what its setup import and inspection need. General manual and provider update handling stays in future slices.

This decision narrows the earlier full-scope import plan. The opening-history decision still prevents double counting at the new plan's selected account boundaries; it does not permit late import into existing accounts.

See the [project design](../superpowers/specs/2026-10-17-inab-design.md) and [Slice 2 plan](../superpowers/plans/2026-10-20-slice-2-ynab-import.md).
