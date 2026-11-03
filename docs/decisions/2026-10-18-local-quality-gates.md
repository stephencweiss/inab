# Local Git quality checks

Date: October 18, 2026
Status: accepted.

## Decision

Add types and unit tests to the existing commit checks. Add a push hook that runs the complete check and publication scans. Require the tested working files to match the staged commit or current published revision. Keep staged private-path and secret scans before the commit-state check.

Use a simple clean-state rule: no unstaged tracked changes or unignored untracked files before a commit; a fully clean index and working tree before a push. Push only the current `HEAD`. Users select or save unrelated work themselves.

Test real Git and Husky with temporary repositories and local remotes. A failed push must leave remote refs unchanged. Keep Git's explicit local bypasses.

## Rationale

Commit checks catch common errors before they enter history. The full suite runs before publication because it also verifies database, terminal, recovery, and policy behavior. Existing Secretlint scans already cover current files, staged files, tracked files, and local history; another scanner is not required for these gates.

Lint, types, and tests read working files. Requiring those files to match the index prevents a clean working copy from hiding different committed content. Requiring each pushed tip to match `HEAD` prevents tests from approving another revision. Refusing unrelated work is simpler than creating another snapshot runner and avoids an automatic stash that could disrupt it.

Automatic PR checks run again after changes. This gives each proposed revision fresh results. Keep the existing `main` checks too. Browser tests belong with the later web interface; the current terminal and SQLite workflows need no browser or network database setup.

Local hooks can be bypassed. Required merge protection is a separate repository setting and remains outside this decision. The [verification guide](../verification.md) records the enforcement gap. The [Git quality convention](../conventions/git-quality-checks.md) owns the commands and working rules.
