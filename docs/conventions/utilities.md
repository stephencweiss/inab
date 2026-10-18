# Utilities and module boundaries

Status: required implementation standard. The import boundary check is active.

Adapted from SuChef's utilities convention for a terminal-first application.

| Kind | Home |
| --- | --- |
| Pure account rules | `src/accounts/` |
| Generic pure helper | `src/lib/<topic>.ts` |
| Budget rules | `src/budget/` |
| Application operations | `src/application/` |
| Database access and migrations | `src/storage/` |
| External input and provider adapters | `src/adapters/` |
| Terminal commands | `src/cli/` |

Search the owning directory before adding a helper. Use a short topic name. Do not create a generic `utils.ts` or a barrel that exports every helper. Keep account, transaction, and category logic with its domain owner.

Account rules, budget rules, and generic helpers are pure. Each imports only its own directory and `src/lib/`. Shared helpers import only `src/lib/`. Application operations import the domain and application-owned contracts, with no runtime or concrete storage dependency. Inject IDs, clocks, and storage through those contracts. CLI modules import application operations, domain parsers, other CLI modules, and the bootstrap module; Node terminal facilities are allowed, but database drivers and concrete storage imports are forbidden.

`src/bootstrap.ts` is the sole composition module. It connects application operations and concrete storage for the CLI. Keep budget arithmetic in the domain.

Provider adapters normalize external data. They must not rewrite the user's budget directly. Keep credentials at the adapter boundary.

`npm run check:boundaries` checks static imports, re-exports, import types, and literal dynamic imports with TypeScript module resolution. It resolves aliases and relative paths. Restricted modules reject unresolved imports and computed dynamic imports. Tests verify permitted and forbidden dependencies. Do not create empty modules merely to match this layout.
