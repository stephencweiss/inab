# Database access

Status: required implementation standard; automated enforcement is planned.

Use parameterized queries through the storage boundary. Do not place SQL in terminal commands, web handlers, or budget functions. Validate record relationships, versions, and business rules inside the transaction that applies a change.

Commit related records together: imported data and import status; synced data and sync position; transaction splits and their parent; budget changes and their history. Failure must leave no partial result.

Use database constraints for IDs, relationships, and uniqueness. Check aggregate rules, such as split sums, inside the transaction. Do not claim that lint proves financial correctness.

Tests use fresh temporary databases. They must never open the household's live database. Require an explicit target for reset, seed, restore, and migration operations. Show the target before a destructive operation and follow the user's authorization.

Before web access is added, derive access from the authenticated session. A request-supplied record ID is not permission. Do not expose any private data before authentication. Test signed-out requests and stale edits. This MVP has one household plan; multi-business roles and tenant columns are outside its scope.

Required evidence: rollback on failure, relationship constraints, duplicate prevention, stale-write handling, and backup restore. Add access tests when the web boundary exists.
