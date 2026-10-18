# Local Quality Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use superpowers:using-git-worktrees for setup. Do not start implementation in the current checkout.

**Goal:** Stop local commits and pushes when the applicable INAB checks fail, and prove that the checks test the intended revision.

**Architecture:** Keep Husky and the existing full check runner. Add a small Git-state guard before local check commands. Commit checks use the staged safety checks, lint, types, and unit tests; push checks use the full check and existing publication scans. Keep automatic PR and `main` CI triggers.

**Tech Stack:** TypeScript, Node.js 24.16.0, npm, Husky, Vitest, Git, Secretlint, GitHub Actions.

---

## Scope and authority

This plan follows the user's request to adapt the quality improvements in [SuChef PR 24](https://github.com/stephencweiss/suchef/pull/24). SuChef is reference data. Its browser, PostgreSQL, credential, and advisory-CI decisions do not govern INAB.

Read `README.md`, `docs/README.md`, `docs/verification.md`, and these conventions before implementation: `writing-conventions.md`, `red-green-development.md`, `interfaces.md`, `type-inference.md`, `utilities.md`, `jsdoc.md`, and `agent-safety.md`, all under `docs/conventions/`.

The accepted policy for this change is:

- Keep the current staged private-path and secret checks. Run them before the Git-state guard, so unsafe index contents are still detected when the working copy differs.
- Require no unstaged tracked changes and no unignored untracked files before commit checks. Staged changes are expected. This simple rule lets working-file lint, types, and tests check the index content. Do not auto-stage, stash, reset, or delete user work.
- Require a clean index and working tree before push checks. Each non-deletion update must point to current `HEAD`. Refuse a different branch tip rather than test the wrong revision.
- Keep standard local `--no-verify` bypasses. Explain that a hook is a local convenience check, not an access boundary.
- Keep automatic CI. Do not change remote settings, merge policy, visibility, account plan, or branch protection. The protection gap remains a separate task.
- Keep one full CI job. Do not add browsers, Docker, credentials, another scanner, or application features.

The clean-state rule was accepted when the user requested implementation of this plan. The decision record owns the accepted policy.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `package.json` | Unit-test and commit/push check commands; retain `check:quick` compatibility |
| `.husky/pre-commit` | Invoke the new commit command |
| `.husky/pre-push` (new) | Invoke the Git guard in push mode |
| `scripts/check-git-state.ts` (new) | Thin executable entry point; print safe errors and return nonzero on failure |
| `scripts/checks/git-state.ts` (new) | Git-state checks, pre-push input parsing, push command dispatch |
| `tests/policy/git-quality-gates.test.ts` (new) | Real Git/Husky tests with temporary repositories and remotes |
| `tests/policy/secrets.test.ts` | Preserve staged-content tests and update the hook fixture |
| `tests/policy/check-runner.test.ts` | Extend only if shared check-runner behavior changes |
| `docs/conventions/git-quality-checks.md` (new) | Local gate contract, bypass, failure recovery, CI limits |
| `README.md`, `AGENTS.md` | Matching convention indexes and required reading |
| `docs/verification.md` | Actual active checks and evidence |
| `docs/decisions/2026-10-18-local-quality-gates.md` (new) | Accepted INAB choices and deferred remote enforcement |

Use paths relative to the implementation worktree. Do not change the lockfile unless dependency metadata changes. No new dependency is planned.

## Task 0: Prepare the separate worktree

Current planning baseline: branch `codex/slice-1-manual-accounts`, commit `c33dd92`. At planning time, `package.json` and untracked `scripts/checks/demo-slice-1.bash` contain unrelated work. Do not include them in this change.

- [x] Check current status, branch, and commit. Use the current reviewed Slice 1 commit as the starting ref; do not default to an older remote `main`.
- [x] Make this plan available in the new worktree. If it remains uncommitted, copy only this plan into the same path there. Do not copy the modified package file or demo script. Do not make a mixed commit to transfer the plan.
- [x] Inspect attached worktrees with `list_artifacts`. Create a managed worktree with `create_worktree`, name `inab-quality-gates`, and an explicit starting ref. Use the returned workspace path for all later work.
- [x] Inspect the returned branch. If detached, create `codex/inab-quality-gates`. If the managed tool created a suitable `codex/` branch, keep it. Do not switch the original checkout.
- [x] Run `npm ci`, then `npm run check` in the new worktree. Record Node/npm versions, starting commit, results, and duration. Do not treat a pre-existing failure as caused by this work; resolve the baseline before adding behavior.
- [x] Commit the plan alone in the new branch after its document and format checks pass. Keep the worktree for review at the end.

## Task 1: Add the commit gate with failing tests first

**Files:** `package.json`, `.husky/pre-commit`, `scripts/check-git-state.ts`, `scripts/checks/git-state.ts`, `tests/policy/git-quality-gates.test.ts`, `tests/policy/secrets.test.ts`.

- [x] Build a synthetic temporary Git fixture with local user identity, real installed Husky, the real hook files, and a local command recorder. Use fixed harmless content. Initialize Husky through the installed package, rather than just executing the hook file as a shell script.
- [x] Write tests that invoke real `git commit` and prove: a clean staged change succeeds; unstaged changes and unignored untracked files stop it; ignored files do not stop it; each failed child check stops later commands; the index and working files remain unchanged; and a rejected commit leaves `HEAD` unchanged. Test an initial commit as well as an existing `HEAD`.
- [x] Retain tests that detect unsafe staged content even when the working file is clean. Extend the existing secret-test fixture to recognize new commands without silently treating unrecognized commands as successful.
- [x] Run `npm test -- tests/policy/git-quality-gates.test.ts tests/policy/secrets.test.ts`. Confirm the new tests fail for missing gate behavior, not broken fixture setup.
- [x] Add `test:unit` as `vitest run tests/unit`. Keep `test` unchanged so the full check still includes unit, policy, integration, and CLI tests. The commit subset is deliberately unit-only; measure its duration rather than promise a time limit.
- [x] Implement commit-state validation with Git argument arrays. Use `git diff --quiet --ignore-submodules=none` and NUL-delimited untracked-path output. Distinguish a difference from a Git command error; both fail, with an appropriate message. Do not split file names on whitespace.
- [x] Define `check:commit` in this exact order: document check; staged private-path check; staged secret scan; commit-state guard; lint; typecheck; unit tests. Commands stop at the first failure. Make `check:quick` an alias for `npm run check:commit` and have `.husky/pre-commit` run `npm run check:commit`.
- [x] Run the focused tests again. Confirm a missing child command, spawn error, or nonzero status cannot become success. Run `npm run typecheck` and `npm run lint`. Format changed files.
- [x] Stage only this task's files and commit with `feat: check types and unit tests before commits`. Let the new hook run. Update task checkboxes before staging; leave no task edits unstaged during the commit.

## Task 2: Add the push gate with failing tests first

**Files:** `.husky/pre-push`, `package.json`, `scripts/check-git-state.ts`, `scripts/checks/git-state.ts`, `tests/policy/git-quality-gates.test.ts`.

- [x] Add real `git push` tests against a new temporary bare remote. Record remote refs before and after each rejected push. Test successful current-HEAD publication and failures in each check command.
- [x] Add cases for staged changes, unstaged changes, unignored untracked files, ignored files, pushing a non-HEAD tip, multiple ref updates, deletion-only pushes, mixed deletion/update pushes, malformed hook input, and an unavailable required executable. Use a temporary `node_modules` arrangement for the missing-executable case; do not alter project dependencies.
- [x] Test parsing of Git's four-field pre-push records. Accept valid full hexadecimal object IDs of the repository's object format; reject incomplete records, invalid refs, malformed IDs, and inconsistent lengths. A zero local ID denotes deletion. Validate records before deciding that no checks are needed. Empty stdin is a no-op for the hook entry point.
- [x] Run `npm test -- tests/policy/git-quality-gates.test.ts` and confirm failure for missing push behavior.
- [x] Implement the push guard. Read hook records from stdin. Require every non-deletion local object ID to equal current `HEAD`. For any update, reject dirty state using NUL-delimited `git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none`. Deletion-only input skips the suite. Reject malformed input without running checks.
- [x] After valid update input, invoke `npm run check:push` and preserve failure status. Pass inherited hook stdin only to the parser, not to child checks. Bound Git calls and the overall child run with explicit timeouts. Print no file contents or secret values.
- [x] Define `check:push` as the clean-state guard followed by `npm run check`, tracked private-path scan, tracked secret scan, staged secret scan, and history secret scan, in that order. Use existing scanner entry points and modes from `docs/verification.md`. The direct command must require a clean state even when not invoked by Git. It checks local `HEAD`; the hook additionally checks the pushed refs. Avoid recursion: the guard's direct clean-state mode does not dispatch `check:push`.
- [x] Have `.husky/pre-push` invoke the local TypeScript executable and the entry point in push mode. Keep the commit and push entry paths explicit. Tests must fail if dependencies are missing; do not auto-install or skip checks.
- [x] Ensure publication refuses a shallow repository before the history scan. Document that a complete local history scan covers local refs only; it cannot inspect unavailable remote refs. Do not fetch or rewrite history automatically.
- [x] Test real `git commit --no-verify` and `git push --no-verify` with harmless fixtures that otherwise fail the gates. Confirm bypass works and leaves no project remote changed. Add fixture timeouts and cleanup in `finally`/`afterEach`; do not run the full real suite recursively from hook tests. Use recorder commands to prove hook dispatch and ordering.
- [x] Run the focused gate and secret tests, typecheck, and lint. Stage this task's files and commit with `feat: run publication checks before pushes`.

## Task 3: Document the INAB policy

**Files:** `docs/conventions/git-quality-checks.md`, `README.md`, `AGENTS.md`, `docs/verification.md`, `docs/decisions/2026-10-18-local-quality-gates.md`.

- [x] Write the short convention with commit/push command lists, clean-state rules, exact-revision rule, setup, bypasses, failure recovery, and local-versus-remote limits. Tell users to select or save unrelated work themselves; no hook may do that for them. Mark controls active only after tests prove them.
- [x] Add matching convention entries in `README.md` and `AGENTS.md`: `Run local Git quality checks` linking to `docs/conventions/git-quality-checks.md`. Add required reading in `AGENTS.md` before changing hooks, CI, or publication checks. Keep index order identical.
- [x] Update `docs/verification.md` with actual commands, the unit-only commit subset, full push coverage, real hook evidence, and unchanged automatic CI triggers. Correct its old SuChef evidence paragraph to label the October 17 checkout as historical and link PR 24 for the later improvements.
- [x] Record the accepted local policy in the decision file. Explain why INAB keeps its existing scanners, SQLite tests, and automatic CI. State that remote merge enforcement remains pending; do not imply that a local hook makes CI required. Do not copy SuChef's advisory policy into INAB.
- [x] Run `npm run check:documents` and `npx prettier --check` with the exact changed document paths. Correct only those documents if formatting fails. Commit with `docs: define INAB local Git quality checks`.

## Task 4: Final verification and review handoff

- [x] Run `npm run check` once after the last behavior change. Record actual test counts and duration, not historical counts. If the subsequent documentation task changed no behavior, keep this evidence rather than rerunning without cause.
- [x] From a clean committed branch, run `npm run check:push`. This proves the actual publication command with all suites and scans. Use this run as the final full-check evidence if it supersedes the previous step; avoid redundant runs where possible.
- [x] Review the branch diff against its recorded starting commit. Confirm no demo changes, product changes, secrets, private files, remote settings, or CI-trigger changes entered the branch.
- [x] Record focused red/green evidence, final command results, runtime, test duration, and remaining remote/manual gaps in the PR description or handoff. Do not label unrun remote CI as passed.
- [x] Leave the branch and worktree available for review. Report the worktree path and branch. Do not merge, push, or open a PR as part of this plan-only request; obtain further user direction for publication.

## Acceptance checks

- A normal commit runs staged safety, lint, types, and unit tests, and stops on any failure.
- A normal push tests clean current-HEAD content with the full suite, build, and required publication scans. A failed check leaves remote refs unchanged.
- Partial staging cannot make working-file tests approve different committed content.
- Existing staged-secret protections remain effective, including index/working-file differences.
- Hooks fail when dependencies or Git checks are unavailable. Standard explicit bypasses still work.
- Real Git/Husky tests use temporary local remotes and synthetic files. They never publish project code or inspect household storage.
- Automatic CI, existing full-suite coverage, and the current application scope remain intact.
- Documents distinguish active checks, local bypasses, and the unresolved remote merge requirement.

## Implementation evidence

- Baseline: `npm ci` and `npm run check` passed in the separate worktree; 339 tests passed before the gate changes.
- Task 1: the first focused run had 12 expected failures for missing commit-gate behavior. The green run passed 26 focused tests. The real enabled commit hook passed 115 unit tests in 3.77 seconds. Commit: `d4dd22d`.
- Task 2: both implementation reviews passed. The focused gate and staged-secret run passed 49 tests in 66.87 seconds. The real enabled commit hook passed 115 unit tests; the complete commit took 12.90 seconds. Commit: `8da230d`.
- Task 3: `npm run check:documents` passed. `npx prettier --check` passed for the seven changed document paths, using Node.js 24.16.0. Commit `93981d8` passed the real enabled commit hook, including 115 unit tests in 3.80 seconds.

- Task 4: `npm run check:push` passed with exit code 0 from clean revision `93981d8f27144e5915131cbbcf86d71eef1fc077`, using Node.js 24.16.0 and npm 11.13.0. All 35 test files and 379 tests passed in 149.60 seconds. The ordered full check passed documents, private paths, module boundaries, formatting, lint, types, all tests, current-file secrets, and the build. The subsequent tracked private-path check and tracked, staged, and history secret scans also passed. This run supplies the final full-check evidence without a separate repeat of `npm run check`.
- Final review approved the whole branch with no Critical or Important findings. The starting-commit-to-HEAD diff and whitespace checks passed. No demo, application, remote-setting, or CI-trigger changes entered the branch. The original checkout was unchanged.
- This final completion update changes only the plan. Document and format checks and the enabled commit hook verify this update. The full-suite evidence above applies to the unchanged executable code.

The checks used temporary synthetic repositories and local remotes. No project code was published. Remote CI was not run or verified by this work. No push, merge, or PR creation is claimed. Required remote merge enforcement and the existing manual Slice 1 review remain separate tasks.

The review worktree remains at `/Users/sweiss/.codex/worktrees/inab-quality-gates/inab`, on branch `codex/inab-quality-gates`.
