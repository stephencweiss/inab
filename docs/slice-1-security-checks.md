# Slice 1 security checks

Checked October 17, 2026, at commit `ba2b057`, before writing the [demo guide](slice-1-demo.md). All checks used local source and synthetic temporary fixtures. No household database or export was opened.

## Automated evidence

| Check | Result |
| --- | --- |
| `npm ci` | Passed: 250 packages installed, 251 audited; pinned tree recreated and Husky installed |
| `npm run check` | Passed: documents, private paths, module boundaries, formatting, lint, types, 34 test files and 339 tests, current-file secrets, and build |
| `npm run check:tracked -- --tracked` | Passed: complete current index path set |
| `npm run check:tracked -- --staged` | Passed: Task 12 staged paths |
| `npm run check:secrets -- --tracked` | Passed: complete current index contents, including the lockfile |
| `npm run check:secrets -- --staged` | Passed: Task 12 staged blob contents |
| `npm run check:secrets -- --history` | Passed after the Task 12 commit: reachable history from all local refs |
| Historical private-path check | Passed: the existing path policy found no blocked paths across 16 commits and 139 distinct paths |
| `git rev-parse --is-shallow-repository` | `false`; the history scan was not limited by a shallow clone |
| Installed hook | Git uses `.husky/_`; the Task 12 commit passed staged private-path and secret checks before lint |

The local runtime was Node.js 24.16.0 and npm 11.13.0 on macOS. The full test phase took 81.43 seconds. The four accepted moderate development-dependency audit findings remain unchanged.

## Controls covered by tests

- [Secret and hook tests](../tests/policy/secrets.test.ts) reject unsafe index content even when the working file is clean. They cover added, modified, renamed, and deleted files, unusual path names, historical deletion, masked output, and missing scanner or preset failures. Candidate scans refuse symbolic links instead of reading external targets. Synthetic markers contain no valid credential bytes.
- [Private-path tests](../tests/policy/private-files.test.ts) reject forced ignored database and export paths, including staged type changes. Their export names refer to temporary synthetic files.
- [Check runner tests](../tests/policy/check-runner.test.ts) verify that a child failure stops later checks and keeps its nonzero exit code.
- Storage and recovery tests verify private file permissions, explicit database targets, input validation, atomic writes, stale-confirmation rejection, source preservation, recovery validation, exclusive publication, and failure cleanup. See [migration](../tests/integration/migrations.test.ts), [correction](../tests/integration/reconciliation-corrections.test.ts), and [recovery](../tests/integration/backup.test.ts) tests.
- [Workflow tests](../tests/policy/feature-map.test.ts) restrict database, backup, and restore targets to fixed paths in a new synthetic temporary fixture before execution. The CLI tests use the same temporary-database helper. Source inspection found no provider or network client in the implemented application.

## Remote status and manual checks

The [GitHub workflow](../.github/workflows/check.yml) has PR and `main` triggers, read-only permissions, pinned action commits, Node.js 24.16.0, `npm ci`, and the full check. An [earlier remote run](https://github.com/stephencweiss/inab/actions/runs/39066991656) passed. The Task 12 changes were verified locally; they were not pushed or run in Linux CI during this check.

Read-only GitHub inspection found no classic branch protection and no effective branch rules for `main`. Requiring the `check` job in the `Check` workflow before merge remains pending repository configuration. No remote setting was changed.

The [demo guide](slice-1-demo.md) is the remaining user check. It covers the visible terminal workflow and cancellation. Web authentication and provider access are later features. These checks do not prove that arbitrary text contains no private data; inspect the publish scope as described in the [verification guide](verification.md).
