# Verification and enforcement

Status: the check baseline runs locally and in GitHub Actions. Import boundary rules are active. Storage initialization, account management, manual transactions, reconciliation and correction review, Tracking snapshots, and backup/restore workflows are verified.

Prefer rules that fail automatically over instructions an agent must remember. Each check needs a valid example that passes and an invalid example that fails. Use existing tools before writing custom rules. Tests must verify behavior, not repeat the implementation.

## Enforcement plan

| Rule | Check | Status | Required by |
| --- | --- | --- | --- |
| Conventions have matching indexes and valid local links | Document check | Active | First tooling change |
| Application source uses TypeScript | Source-file check | Active | First application code |
| Contracts are complete and inputs are parsed | Strict types and scoped interface lint rules with installed-config policy tests; money and date parser tests | Active for these parsers and the lint rules | First application code |
| Types and comments do not repeat code | Type inference, assertion, and JSDoc lint rules | Active | First application code |
| Modules use permitted dependencies | Import boundary checks, including aliases | Active | First application code |
| Private data and secrets stay out of source and CI | Tracked-path policy and secret scan; inspect publish scope | Active | First commit and every CI run |
| Manual accounts and balances work without providers | Account create/list/show/rename/opening, atomic history, stale-write, row validation, pure balance, opening-boundary, transaction register/correction/clearing, overflow, and atomic audit tests, reconciliation comparison/evidence/reuse, derived register coverage, targeted correction invalidation, preserved evidence, approved check list rechecks, rollback after invalidation, dated Tracking observations, versioned snapshot correction, unique-date refusal, coherent last-known views, row validation, aggregate revision rechecks, and snapshot audit rollback are active | Partial | Slice 1 |
| Imports preserve identity and commit atomically | Synthetic import fixtures and database integration tests | Planned | Slice 2 |
| Migrations and restore preserve data | Temporary database init/upgrade, history, rollback, constraints, private files, consistent backup/restore, complete record recovery, source preservation, exclusive publication, interruption cleanup, and unsupported-source rejection tests | Active | First persisted data |
| Budget money remains correct | Accounting examples and invariant tests | Planned | Slice 3 |
| Split amounts remain correct | Parent/allocation sum tests | Planned | First split support |
| Documented workflows work | Feature-map schema, source reference, and exact terminal execution tests | Active for account, transaction, reconciliation, correction review, Tracking snapshots, and recovery | First working workflow |
| Provider sync handles retries, updates, and manual overlap | Fixture-based adapter tests, reviewed matching, and pre-opening history tests | Planned | Slice 4 |
| Private web responses require login | Access, session, and cache tests | Planned | Web slice |

Financial rules need runtime validation, database constraints, and tests. Lint alone cannot prove balanced amounts or correct migration.

## Local and CI entry point

`npm run check` runs each installed check in order and stops at the first failure. It runs the document check, the tracked-path check, the import boundary check, Prettier, ESLint, `tsc --noEmit`, Vitest, and Secretlint. Vitest uses at most one worker because CLI and policy tests also start child processes. Four concurrent workers caused existing CLI workflows to exceed the test limit under host CPU load; the serial focused run passed. The five-second default test limit and ten-second CLI process limit remain unchanged. It also runs CLI subprocess tests and builds the terminal entry point with TypeScript. Help, init, migration target handling, account create/list/show/rename/opening, transaction add/edit/clear/unclear/register, reconcile/reconciliation list, snapshot add/correct/list, backup/restore, and invalid-command handling are verified. The hand-edited account map runs through the real CLI against a new temporary synthetic database. Recovery steps restrict every source and destination to fixed paths inside that temporary fixture before execution. The init test builds and runs an isolated copy of the terminal output from another working directory.

The commit hook runs the document check, the tracked-path check, and lint. CI runs `npm run check` for pull requests and for `main`. The workflow uses Node.js 24.16.0, `npm ci`, read-only repository permissions, and pinned action commits. Do not run destructive formatting or file writes in CI checks. Do not expose secrets to pull requests or upload household databases or raw provider payloads as artifacts.

The workflow file does not make the check required for merge. That repository setting is still open. Local hooks are convenience checks, not an access boundary.

## Private data checks

Reject exports, database files and sidecars, backups, browser profiles, and real environment files. Allow synthetic fixtures only under `tests/fixtures/`. The check reads tracked files and files Git does not ignore, not just `.gitignore` entries. A file can already be tracked, or be added with force. Use `npm run check:tracked -- --staged` for added or changed index paths, or `--tracked` for the complete tracked set. The default also checks unignored files. Git paths use NUL-delimited output.

Secretlint scans that same file set, except `package-lock.json`. It does not yet scan older Git blobs. No scanner proves that arbitrary text is free of personal data. Review fixture contents and publish scope. Do not turn real records into public fixtures by changing names alone; create new examples.

## Completion evidence

For a behavior change, record the test that failed before the fix and passed after it. Run the relevant broader checks once the change is stable. Report the actual commands, results, and any remaining gap.

For a docs-only change, check links, convention indexes, and consistency with the product design. Do not claim application tests passed when there is no application.

When adding a custom lint or policy rule, test that it rejects a representative violation and permits legitimate code. Do not disable the rule broadly to pass the first build.

## First tooling tasks

Include these at the start of Slice 1, not as a separate long infrastructure project:

1. Done: Node.js 24.16.0, npm, the public registry, and the lockfile.
2. Done: document, tracked-path, lint, type, and test commands.
3. Done for JSDoc comments, explicit interfaces, redundant types, TypeScript source files, and Sonar complexity. Import boundary rules are active. SuChef exceptions for form data and `src/lib` are not copied.
4. Done: the Husky hook and `npm run check`.
5. The workflow file is present. Required merge protection is not confirmed.
6. Done: the first manual-account workflow and its feature map, including invalid input, missing IDs, and stale revision checks.

## SuChef evidence

The reviewed checkout has strict TypeScript, ESLint custom rules, lint rule tests, a feature map with unit/browser checks, and a Husky hook that runs lint and feature-map validation. Its hook does not run all tests or type checks. No `.github` directory was present. INAB now has a hook and a CI workflow. The feature-map check starts with the first working workflow.
