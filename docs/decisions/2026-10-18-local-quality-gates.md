# Local Git quality checks

Date: October 18, 2026
Status: accepted.

## Decision

Add types and unit tests to the existing commit checks. Add a push hook that runs the complete check and publication scans. Require the tested working files to match the staged commit or current published revision. Keep staged private-path and secret scans before the commit-state check.

Use a simple clean-state rule: no unstaged tracked changes or unignored untracked files before a commit; a fully clean index and working tree before a push. Push only the current `HEAD`. This avoids an automatic stash or a second snapshot runner. Users select or save unrelated work themselves.

Test real Git and Husky with temporary repositories and local remotes. A failed push must leave remote refs unchanged. Keep Git's explicit local bypasses.

## Adaptation from SuChef

[SuChef PR 24](https://github.com/stephencweiss/suchef/pull/24) informed this change. INAB retains its pinned Secretlint scanner, SQLite tests, terminal workflows, and single automatic CI job. It does not need browser tests, Docker databases, generated database credentials, or an additional secret scanner for this change.

Keep CI runs on PR changes and `main` pushes. Do not copy SuChef's advisory merge policy or ready-for-review-only trigger. Remote settings and merge enforcement are outside this decision. Their recorded gap remains in the [verification guide](../verification.md).

The [Git quality convention](../conventions/git-quality-checks.md) owns the commands and working rules. The verification guide owns evidence and active-check status.
