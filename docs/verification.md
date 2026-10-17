# Verification and enforcement

Status: implementation plan for checks. No application tooling or CI is active yet.

Prefer rules that fail automatically over instructions an agent must remember. Each check needs a valid example that passes and an invalid example that fails. Use existing tools before writing custom rules. Tests must verify behavior, not repeat the implementation.

## Enforcement plan

| Rule | Planned check | Required by |
| --- | --- | --- |
| Conventions have matching indexes and valid local links | Document check | First tooling change |
| Application source uses TypeScript | Source-file check | First application code |
| Contracts are complete and inputs are parsed | Strict types, scoped interface lint rules, parser tests | First application code |
| Types and comments do not repeat code | Type inference, assertion, and JSDoc lint rules | First application code |
| Modules use permitted dependencies | Import boundary checks, including aliases | First application code |
| Private data and secrets stay out of source and CI | Tracked-path policy and secret scan; inspect publish scope | First commit and every CI run |
| Manual accounts and balances work without providers | Register, clearing, reconciliation, and opening-boundary tests | Slice 1 |
| Imports preserve identity and commit atomically | Synthetic import fixtures and database integration tests | Slice 2 |
| Migrations and restore preserve data | Temporary database upgrade and backup restore tests | First persisted data |
| Budget money remains correct | Accounting examples and invariant tests | Slice 3 |
| Split amounts remain correct | Parent/allocation sum tests | First split support |
| Documented workflows work | Feature-map schema and terminal execution tests | First working workflow |
| Provider sync handles retries, updates, and manual overlap | Fixture-based adapter tests, reviewed matching, and pre-opening history tests | Slice 4 |
| Private web responses require login | Access, session, and cache tests | Web slice |

Financial rules need runtime validation, database constraints, and tests. Lint alone cannot prove balanced amounts or correct migration.

## Planned local and CI entry point

Add one `npm run check` command when the TypeScript/Node setup is confirmed. It will run document checks, formatting checks, lint, type checks, focused unit and integration suites, and the terminal workflow checks available at that stage. Add the build check with the first runnable command. These commands do not exist yet.

The local commit hook should run quick staged checks. CI must run the complete required set even when hooks are skipped. Do not run destructive formatting or file writes in CI checks.

When a remote repository exists, use a CI workflow for pull requests and default-branch changes. Use a pinned runtime, a committed lockfile, frozen dependency installation, and read-only repository permissions. Pin third-party actions to reviewed commit SHAs. Do not expose secrets to pull requests or use privileged pull-request execution for untrusted code. Do not upload household databases or raw provider payloads as artifacts.

Make the CI result a required merge check through repository settings. A workflow file alone does not prevent a merge. Confirm that the selected hosting plan supports this setting. Local hooks are convenience checks, not an access boundary.

## Private data checks

Ignore local data paths before Git setup. Reject tracked exports, database files and sidecars, backups, browser profiles, and real environment files. Allow synthetic fixtures only under the documented fixture path. Check tracked paths, not just `.gitignore` entries. A file can already be tracked, or be added with force.

Use a maintained secret scanner when tooling is installed. No scanner proves that arbitrary text is free of personal data. Review fixture contents and publish scope. Do not turn real records into public fixtures by changing names alone; create new examples.

## Completion evidence

For a behavior change, record the test that failed before the fix and passed after it. Run the relevant broader checks once the change is stable. Report the actual commands, results, and any remaining gap.

For a docs-only change, check links, convention indexes, and consistency with the product design. Do not claim application tests passed when there is no application.

When adding a custom lint or policy rule, test that it rejects a representative violation and permits legitimate code. Do not disable the rule broadly to pass the first build.

## First tooling tasks

Include these at the start of Slice 1, not as a separate long infrastructure project:

1. Confirm runtime and package manager; select compatible tool versions and create the lockfile.
2. Add document, tracked-path, lint, type, and test commands with clear failures.
3. Port relevant SuChef custom rules with their tests; adapt path and framework exceptions.
4. Add the quick local hook and the full check command.
5. Add CI when a remote exists and verify a failed check blocks merge through repository settings.
6. Build the first manual-account workflow against synthetic fixtures and document its terminal commands.

## SuChef evidence

The reviewed checkout has strict TypeScript, ESLint custom rules, lint rule tests, a feature map with unit/browser checks, and a Husky hook that runs lint and feature-map validation. Its hook does not run all tests or type checks. No `.github` directory was present. INAB's CI plan adds enforcement beyond that observed setup.
