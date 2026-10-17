# Utilities and module boundaries

Status: required implementation standard; automated enforcement is planned.

Adapted from SuChef's utilities convention for a terminal-first application.

| Kind | Proposed home |
| --- | --- |
| Generic pure helper | `src/lib/<topic>.ts` |
| Budget rules | `src/budget/` |
| Application operations | `src/application/` |
| Database access and migrations | `src/storage/` |
| External input and provider adapters | `src/adapters/` |
| Terminal commands | `src/cli/` |

Search the owning directory before adding a helper. Use a short topic name. Do not create a generic `utils.ts` or a barrel that exports every helper. Keep account, transaction, and category logic with its domain owner.

Budget rules and generic helpers must not import filesystem, database, network, terminal, or provider modules. Application operations coordinate budget rules and storage through small contracts. CLI and future web handlers call application operations; they do not contain budget arithmetic or direct SQL.

Provider adapters normalize external data. They must not rewrite the user's budget directly. Keep credentials at the adapter boundary.

Planned enforcement: import restrictions that resolve aliases and relative paths, plus tests with forbidden imports. The directories above are a proposed source layout; do not create empty modules merely to match it.
