# Git quality checks

Status: active required local checks, verified by real Git/Husky tests. Remote merge enforcement remains a separate task.

Use Node.js 24.16.0 and run `npm ci` in each checkout or worktree. Keep Husky installed.

The commit hook runs `npm run check:commit` in this order, stopping at the first failure:

1. `npm run check:documents`
2. `npm run check:tracked -- --staged`
3. `npm run check:secrets -- --staged`
4. `npm run check:commit-state`
5. `npm run lint`
6. `npm run typecheck`
7. `npm run test:unit`

`test:unit` covers `tests/unit/` only. `npm run check:quick` is an alias for the commit checks.

The push hook first checks the proposed revisions. It then runs `npm run check:push` in this order, stopping at the first failure:

1. `npm run check:push-state`
2. `npm run check`
3. `npm run check:tracked -- --tracked`
4. `npm run check:secrets -- --tracked`
5. `npm run check:secrets -- --staged`
6. `npm run check:secrets -- --history`

The full `check` command includes all unit, policy, database, and terminal tests, plus the build. Both gate commands can also run directly.

## Match the tested files

Before a commit, stage the intended changes. The hook refuses unstaged tracked changes and unignored untracked files. Staged private-path and secret checks run first. A clean working file cannot hide unsafe index contents.

Before a push, the index and working tree must be clean. Each non-deletion update must point to the current `HEAD`. Check out another branch before pushing its tip. A deletion-only push does not run the suite. Invalid hook input fails.

The direct push command checks local `HEAD`. The Git hook also checks the revisions Git will publish. Push checks refuse shallow repositories. History scans require a complete local repository and cover local refs only. Make the refs intended for publication available locally before scanning them.

Save or select unrelated work yourself. Hooks do not stage, stash, reset, or delete files. After a failure, read the reported check, correct the cause, and repeat the operation. If dependencies are missing, run `npm ci`. If files differ, select and stage the intended files yourself. Missing commands, dependencies, and incomplete checks are failures.

## Bypass and CI

Git supports explicit local bypasses with `git commit --no-verify` and `git push --no-verify`. A bypass skips the matching hook. Local hooks are convenience checks, not an access boundary.

GitHub Actions continues to run the full check on pull requests and pushes to `main`. A local pass does not prove remote CI passed. Hook installation does not require passing checks before merge. See the [verification guide](../verification.md) for the remote enforcement gap and current evidence.

Use synthetic fixtures. Keep household data and credentials outside source, test output, and CI artifacts. See the [agent safety convention](agent-safety.md).
