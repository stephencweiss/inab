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
| Imports preserve identity and commit atomically | Synthetic CSV/value checks, setup eligibility and legacy upgrade checks, review-file identity/locking, exact source row accounting, duplicate/zero preservation, Tracking selection/adjustment evidence, canonical live register validation, injected write rollback, concurrent confirmations, receipt reuse, CLI/history workflows, and backup/restore are installed | Active | Slice 2 |
| Migrations and restore preserve data | Temporary database init/upgrade, history, rollback, constraints, private files, consistent backup/restore, complete record recovery, source preservation, exclusive publication, interruption cleanup, and unsupported-source rejection tests | Active | First persisted data |
| Budget money remains correct | Synthetic accounting examples, normalized opening checks, Cash/Credit month rules, future commitments, source membership, stale writes, boundary corrections, transfer rollback, version-4 upgrade, and recovery tests are active | Verified locally; user manual review passed November 10, 2026 | Slice 3 |
| Split amounts remain correct | Parent/allocation sum tests | Planned | First split support |
| Documented workflows work | Feature-map schema, source reference, and exact terminal execution tests | Active for account, transaction, reconciliation, correction review, Tracking snapshots, and recovery | First working workflow |
| Provider sync handles retries, updates, and manual overlap | Fixture-based adapter tests, reviewed matching, and pre-opening history tests | Planned | Slice 4 |
| Private web responses require login | Access, session, and cache tests | Planned | Web slice |

Financial rules need runtime validation, database constraints, and tests. Lint alone cannot prove balanced amounts or correct migration.

Each mapped workflow runs as a separate test with a 30-second limit and its own temporary fixture. Snapshot addition/display and conflict/correction use separate five-second CLI tests. This keeps independent workflows from sharing one timeout budget when CLI startup is slower in CI. Every mapped command, expected exit, output check, capture guard, and cleanup remains active. The ten-second child process limit is unchanged.

## Local and CI entry point

`npm run check` runs each installed check in order and stops at the first failure. It runs the document check, the tracked-path check, the import boundary check, Prettier, ESLint, `tsc --noEmit`, Vitest, and Secretlint. Vitest uses at most one worker because CLI and policy tests also start child processes. Four concurrent workers caused existing CLI workflows to exceed the test limit under host CPU load; the serial focused run passed. The five-second default test limit and ten-second CLI process limit remain unchanged. Real Git/Husky integration tests alone use a 30-second test limit. It also runs CLI subprocess tests and builds the terminal entry point with TypeScript. Help, init, migration target handling, account create/list/show/rename/opening, transaction add/edit/clear/unclear/register, reconcile/reconciliation list, snapshot add/correct/list, backup/restore, and invalid-command handling are verified. The hand-edited account map runs through the real CLI against a new temporary synthetic database. Recovery steps restrict every source and destination to fixed paths inside that temporary fixture before execution. The init test builds and runs an isolated copy of the terminal output from another working directory.

The commit hook runs `npm run check:commit`: documents, staged private paths, staged secrets, commit state, lint, types, and `test:unit` (`tests/unit/` only), in that order. `check:quick` is an alias. The state check refuses unstaged tracked changes and unignored untracked files. The staged checks run first and read index paths and index blobs; a clean working copy cannot hide unsafe staged contents.

The push hook checks each proposed ref update against current `HEAD`, requires a clean index and working tree, and runs `npm run check:push`. The direct command independently checks clean state, an existing `HEAD`, and complete local history. It runs the full check, tracked private paths, and tracked, staged, and history secret scans, stopping at the first failure. Deletion-only pushes skip the suite; mixed pushes still check updates. Tests use real Git and installed Husky with temporary repositories and bare local remotes. They prove that failures stop operations without changing user files or remote refs. Explicit local bypasses remain available. See the [Git quality convention](conventions/git-quality-checks.md) and [decision](decisions/2026-10-18-local-quality-gates.md).

CI runs `npm run check` for pull requests and for `main`. The workflow uses Node.js 24.16.0, `npm ci`, read-only repository permissions, and pinned action commits. Do not run destructive formatting or file writes in CI checks. Do not expose secrets to pull requests or upload household databases or raw provider payloads as artifacts.

The workflow file does not make the check required for merge. Read-only GitHub checks on 2026-10-17 found no branch protection or effective ruleset for `main`. Requiring the `check` job in the `Check` workflow before merge remains a repository configuration task. Local hooks are convenience checks, not an access boundary.

## Private data checks

Reject exports, database files and sidecars, backups, browser profiles, and real environment files. Allow synthetic fixtures only under `tests/fixtures/`. The check reads tracked files and files Git does not ignore, not just `.gitignore` entries. A file can already be tracked, or be added with force. Use `npm run check:tracked -- --staged` for added or changed index paths, or `--tracked` for the complete tracked set. The default also checks unignored files. Git paths use NUL-delimited output.

Secretlint 13.0.7 and its recommended preset are pinned in the lockfile. `npm run check:secrets` scans candidate working files, including `package-lock.json`. It refuses symbolic links instead of reading external targets. `npm run check:secrets -- --staged` scans added or changed index blobs; deletion needs no content scan. `--tracked` scans every current index blob. These modes use Git argument arrays and NUL-delimited paths, including paths with spaces and newlines. A missing scanner, preset, or configuration fails the check, even for an empty selection.

Before publishing, run `npm run check:push` from a clean committed checkout. It includes `npm run check:tracked -- --tracked` and all three explicit secret checks:

```sh
npm run check:secrets -- --tracked
npm run check:secrets -- --staged
npm run check:secrets -- --history
```

History mode scans unique path/blob pairs reachable from every local Git ref with the same pinned scanner. It includes deleted and replaced contents, without checking out old files. Ensure the local repository contains the complete history and all refs intended for publication. The full `check` command and commit hook do not repeat this historical scan. `check:push` does. A shallow repository is refused before publication checks. The scan covers available local refs, not missing remote history. Synthetic tests use temporary Git repositories and invalid key markers with no credential bytes. They cover added, modified, renamed, and deleted paths, index/working-copy differences, lockfiles, historical deletions, unavailable scanner/preset failures, and the installed hook commands. Secret output is masked. No scanner proves that arbitrary text is free of personal data. Review fixture contents and publish scope. Do not turn real records into public fixtures by changing names alone; create new examples.

## Completion evidence

Local gate tests use synthetic Git repositories, installed Husky hooks, and bare local remotes. The focused gate and staged-secret run passed 49 tests. The installed commit hook also passed all 115 unit tests on the Task 2 commit. These checks prove the local gate behavior; the implementation plan records the red/green results and measured durations. Final full-suite and direct publication-check results must be recorded after they run.

The [Slice 1 security check record](slice-1-security-checks.md) lists the commands run before the demo guide and the remaining remote and manual checks.

For a behavior change, record the test that failed before the fix and passed after it. Run the relevant broader checks once the change is stable. Report the actual commands, results, and any remaining gap.

For a docs-only change, check links, convention indexes, and consistency with the product design. Do not claim application tests passed when there is no application.

When adding a custom lint or policy rule, test that it rejects a representative violation and permits legitimate code. Do not disable the rule broadly to pass the first build.

## First tooling tasks

Include these at the start of Slice 1, not as a separate long infrastructure project:

1. Done: Node.js 24.16.0, npm, the public registry, and the lockfile.
2. Done: document, tracked-path, lint, type, and test commands.
3. Done for JSDoc comments, explicit interfaces, redundant types, TypeScript source files, and Sonar complexity. Import boundary rules are active. Form data and shared helpers use the same scoped rules.
4. Done: the Husky hook and `npm run check`.
5. The workflow file is present. Required merge protection is absent and still needs configuration.
6. Done: the first manual-account workflow and its feature map, including invalid input, missing IDs, and stale revision checks.

## Slice 2 migration checks

The [Slice 2 demo](slice-2-demo.md) runs the built CLI from a separate temporary working directory. It copies only synthetic CSV fixtures, checks pause/resume while household tables stay empty, stale confirmation without writes, atomic confirmation, exact duplicates and zero rows, plan history, Tracking adjustment review, refusal after setup, safe receipt retry after the source file is removed, and backup/restore. User manual review and household migration are still separate steps.

Import sources and review files require explicit private paths outside the checkout. Resource limits and strict CSV/review schemas are tested. Source statuses remain distinct from posting evidence. Missing transfer/split relationships are warnings, and historical source totals remain distinct from live balance effects and revised adjustments. Date/amount/payee hashes do not define transaction identity.

The two new migrations install setup/import storage and reviewed relationship/evidence guards. That slice installed schema version 4. Current schema version is 7, including the three Slice 3 migrations, derived from the validated migration ledger. Prior-schema upgrades retain accounts and audit history, classify an existing household as start-fresh complete, and preserve recovery backups. No reset operation or automatic household import is installed.

### Guided migration review

The terminal review walks source accounts by name, asks for explicit account kinds and closed states, guides opening and history choices, and presents a separate import confirmation. `--interactive` and `-i` require a terminal; a terminal review defaults to guidance. `--json` stays prompt-free and conflicts with explicit interactive mode. Complete script commands remain supported.

Tests cover accepted choices and retry, cancellation without partial choices, multi-account progress, saved choices, concurrent review rejection, numbered rows, missing mappings, future-date exits, source and monthly conflict context, Tracking evidence and deferral, exact-cent display, and separate final import confirmation. The October 29, 2026 full check passed 553 tests in 56 files; the built synthetic demo also passed. The [manual guide](slice-2-demo.md) gives exact paths, setup commands, prompt answers, and expected summary values. User manual review remains pending.

### Migration term help

The [term dictionary](term-dictionary.md) shares its definitions with the built CLI. A test checks that the document and definitions agree. All migration decisions offer `h` / `help` and `a` / `abandon`, ignoring case. Help shows the relevant definition and repeats the same question without changing its default or saving choices. Confirmation shortcuts accept `Y/y` and `N/n`; ambiguous enum initials are rejected. Final import confirmation still has no default yes.

Tests cover each question type, setup and fresh-start guidance, private review-file help, opening and Tracking date/balance topics, unchanged revisions during help, preserved defaults, explicit confirmation after help, and script compatibility. The October 30, 2026 full check passed 659 tests in 58 files; the built synthetic migration demo also passed. Manual user review remains pending.

### Consistent abandonment controls

All displayed terminal exit options use abandon. Manual write confirmations share the migration question controls and accept `y` / `yes`, `n` / `no`, and `a` / `abandon`, ignoring case. Manual final writes keep explicit confirmation without a default. Existing migration save defaults remain unchanged. Real terminal tests cover controls, Ctrl-C, EOF, and preservation of raw name/payee/memo input. Human exit messages say Abandoned; script response fields remain compatible.

The October 30, 2026 prompt audit found no displayed cancel option. `npm run check` passed 700 tests in 59 files, and the built synthetic migration demo passed. The [manual guide](slice-2-demo.md) explains restarting older running sessions without losing confirmed review choices.

### Review progress and layout

The guide lists required review steps before the first question and shows addressed/remaining counts after each saved choice. Duplicate mapping blockers are grouped by source account. Before kinds are known, opening steps are explicitly conditional on Cash/Credit. Counts can change with new evidence, and warnings are separate. Blank lines separate sections, headings come first, and `-->` marks questions.

The History menu explains its actions: history keeps row choices and accepts the coverage warning; edit changes a source row; save returns to the summary without a new acknowledgement or import. Here `h` selects history and full-word `help` displays the definition. Tests cover case-insensitive h/e/s/a, help without a save, section order, singular step wording, and returning to summary before another account's opening prompts. The final October 30, 2026 check passed 730 tests in 60 files; the built synthetic demo also passed.

### Review Back navigation

Nested review menus offer case-insensitive `b` / `back` to return to their parent. Back leaves confirmed choices and the review revision unchanged. Initial guide steps and free-text/date/amount fields keep their current controls. Abandon exits, keeps saved choices, and explains how to resume with the same review command and file. Script and JSON responses are unchanged.

Tests cover the Observations-to-Evidence-to-summary path with a real private review file, empty adjustment lists, account and row selection, History from warnings, monthly conflicts, and deeper observation edits. The October 30, 2026 full repository check passed 754 tests in 60 files; the built synthetic demo passed. Independent review approved the corrected parent routes. The [manual guide](slice-2-demo.md) explains how to resume an older running session.

### CLI shortcut audit

All terminal menu sites were reviewed. Shared menu hints mark unique alphabetic first letters, with h reserved for help and a for abandon; numeric selectors and ambiguous initials keep their full values. Dedicated start, closed, save, and History controls remain explicit. Manual account creation now uses the same account-kind menu. IDs, paths, dates, revisions, and amounts keep their input formats; script subcommands and flags are unchanged.

Current text values offer c/confirm or replacement text, ignoring case for controls. Enter keeps the current value. Help repeats the same prompt, and save remains separate. With no current value, c remains ordinary input. Tests cover every menu pattern, reserved and ambiguous initials, manual Tracking selection, current text confirmation, replacements, and help. The October 30, 2026 full check passed 780 tests in 60 files; the built synthetic demo passed. Independent review found no remaining gaps.

### Explain migration issues and saved outcomes

Selected opening-date conflicts show the affected transaction posting date, account opening date, effect, and evidence-based correction choices. A repeated account-level conflict is hidden only while its row-level diagnostic remains visible; standalone checks remain. Summary, issue selection, and progress share that visible list. Raw validation, JSON, import reports, and commit checks are unchanged.

History acknowledgement is explained as acceptance of an export limit, with the warning remaining. Missing split links are an informational limitation and do not assert that splits exist. After a confirmed save, the guide reports cleared blockers, accepted acknowledgements, and new blockers. Tests cover standalone overlaps hidden behind a missing-payee check and genuinely new conflicts introduced by a second row.

The October 30, 2026 final repository check passed 805 tests in 60 files. The built synthetic demo passed, and independent review approved the final behavior. All source data and databases used for verification were synthetic. User manual review remains separate.

### Migration orientation and terminal welcome

The interactive guide explains the normal path before its first question: retain YNAB history for inspection, confirm Cash/Credit starting posted balances, and use INAB for later activity. It explains pending balances, optional promotion of imported rows, and Tracking observations/adjustments. History and opening sections reinforce that path. Saved row choices remain until explicitly edited.

Terminal launches display an INAB ASCII banner on stderr. Noninteractive, JSON, and version output omit it. Tests exercise the actual CLI entry point with terminal state, verify banner output once, and check plain JSON/version output. The November 2, 2026 full repository check passed 813 tests in 61 files; the built synthetic migration demo passed. No migration rules or household data were changed.

### Completed migration review

Reopening an already imported review in text mode prints `Migration completed`, exits successfully, and does not prompt or import again. The stored receipt must match the target identity and review revision. Tests remove the original CSV sources, compare database/review bytes before and after, and verify that replacing the target still reports `stale-target`. JSON inspection and commit retry contracts stay unchanged.

The terminal splash uses the supplied slanted ASCII artwork, ANSI colors, the shared CLI version, and the INAB budgeting description. Version-dependent tests use the shared version value so a version change does not require editing display assertions.

The installed/quick secret-hook policy cases use a 30-second test budget, matching the other real Git-hook tests. Each case runs three hooks; each subprocess retains its ten-second limit and all secret/private-path ordering assertions. A publication run exceeded Vitest's default five-second case limit, while the isolated assertions passed. The bounded case budget avoids treating process startup delays as a scanner failure.

## Slice 3 budget checks

The [budget examples](budget-examples.md) define the supported results. Tests cover opening conservation and normalization, exact signed splits, Cash/Credit overspending, multiple cards, positive card funds, refunds and payments, maximum cumulative future commitments, and month changes. Reports are bounded to 1,200 months. Missing allocations make results incomplete and block new assignments.

Application/storage tests verify earlier activation, independent boundary evidence, explicit pending treatment, complete elapsed assignments, source/live deduplication, unique historical transfer membership, stale previews, retry receipts, and atomic rollback. Current budget account balances must agree with existing registers. History-only transfer edits cannot create register entries or silently remove source activity. Existing account/transaction commands advance affected budget revisions and preserve reconciliation review. Boundary changes leave a usable opening amendment path.

Private activation files use bounded validated IO, owner-only permissions, locks, saved revisions, full baseline checks, and database/device/inode identity. Terminal tests cover help, back, edit, abandon, resume, changed daily coverage, JSON without prompts, script errors, exact-cent reports, and separate final confirmation. The hand-edited feature map runs a synthetic budget workflow and restricts all database/review/recovery paths before execution.

The [Slice 3 demo](slice-3-demo.md) runs the built CLI for both fresh and synthetic migrated plans, including a corrected card purchase, payment, month change, stale refusal, safe retry, and restore. The [progress record](superpowers/plans/2026-11-05-slice-3-progress.md) records actual full-check and demo results. Automated evidence does not close the user's manual review.

## Slice 3 manual review and publication

The user confirmed the full Slice 3 demo and all seven manual checklist items complete on November 10, 2026. The [closeout record](superpowers/plans/2026-11-10-slice-3-closeout.md) records the final prompt, display, documentation, and later-income funding changes and their verification. Local verification does not claim remote CI or merge completion.
