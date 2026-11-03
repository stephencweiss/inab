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
| Budget money remains correct | Accounting examples and invariant tests | Planned | Slice 3 |
| Split amounts remain correct | Parent/allocation sum tests | Planned | First split support |
| Documented workflows work | Feature-map schema, source reference, and exact terminal execution tests | Active for account, transaction, reconciliation, correction review, Tracking snapshots, and recovery | First working workflow |
| Provider sync handles retries, updates, and manual overlap | Fixture-based adapter tests, reviewed matching, and pre-opening history tests | Planned | Slice 4 |
| Private web responses require login | Access, session, and cache tests | Planned | Web slice |

Financial rules need runtime validation, database constraints, and tests. Lint alone cannot prove balanced amounts or correct migration.

Each mapped workflow runs as a separate test with a 30-second limit and its own temporary fixture. Snapshot addition/display and conflict/correction use separate five-second CLI tests. This keeps independent workflows from sharing one timeout budget when CLI startup is slower in CI. Every mapped command, expected exit, output check, capture guard, and cleanup remains active. The ten-second child process limit is unchanged.

## Local and CI entry point

`npm run check` runs each installed check in order and stops at the first failure. It runs the document check, the tracked-path check, the import boundary check, Prettier, ESLint, `tsc --noEmit`, Vitest, and Secretlint. Vitest uses at most one worker because CLI and policy tests also start child processes. Four concurrent workers caused existing CLI workflows to exceed the test limit under host CPU load; the serial focused run passed. The five-second default test limit and ten-second CLI process limit remain unchanged. It also runs CLI subprocess tests and builds the terminal entry point with TypeScript. Help, init, migration target handling, account create/list/show/rename/opening, transaction add/edit/clear/unclear/register, reconcile/reconciliation list, snapshot add/correct/list, backup/restore, and invalid-command handling are verified. The hand-edited account map runs through the real CLI against a new temporary synthetic database. Recovery steps restrict every source and destination to fixed paths inside that temporary fixture before execution. The init test builds and runs an isolated copy of the terminal output from another working directory.

The commit hook runs the document check, staged private-path and Secretlint checks, and lint. The staged checks read index paths and index blobs; a clean working copy cannot hide unsafe staged contents. CI runs `npm run check` for pull requests and for `main`. The workflow uses Node.js 24.16.0, `npm ci`, read-only repository permissions, and pinned action commits. Do not run destructive formatting or file writes in CI checks. Do not expose secrets to pull requests or upload household databases or raw provider payloads as artifacts.

The workflow file does not make the check required for merge. Read-only GitHub checks on 2026-10-17 found no branch protection or effective ruleset for `main`. Requiring the `check` job in the `Check` workflow before merge remains a repository configuration task. Local hooks are convenience checks, not an access boundary.

## Private data checks

Reject exports, database files and sidecars, backups, browser profiles, and real environment files. Allow synthetic fixtures only under `tests/fixtures/`. The check reads tracked files and files Git does not ignore, not just `.gitignore` entries. A file can already be tracked, or be added with force. Use `npm run check:tracked -- --staged` for added or changed index paths, or `--tracked` for the complete tracked set. The default also checks unignored files. Git paths use NUL-delimited output.

Secretlint 13.0.7 and its recommended preset are pinned in the lockfile. `npm run check:secrets` scans candidate working files, including `package-lock.json`. It refuses symbolic links instead of reading external targets. `npm run check:secrets -- --staged` scans added or changed index blobs; deletion needs no content scan. `--tracked` scans every current index blob. These modes use Git argument arrays and NUL-delimited paths, including paths with spaces and newlines. A missing scanner, preset, or configuration fails the check, even for an empty selection.

Before publishing, run `npm run check:tracked -- --tracked`, inspect the staged paths, and run all three explicit secret checks:

```sh
npm run check:secrets -- --tracked
npm run check:secrets -- --staged
npm run check:secrets -- --history
```

History mode scans unique path/blob pairs reachable from every local Git ref with the same pinned scanner. It includes deleted and replaced contents, without checking out old files. Ensure the local repository contains the complete history and all refs intended for publication. Normal checks and the commit hook do not repeat this historical scan. Synthetic tests use temporary Git repositories and invalid key markers with no credential bytes. They cover added, modified, renamed, and deleted paths, index/working-copy differences, lockfiles, historical deletions, unavailable scanner/preset failures, and the installed hook commands. Secret output is masked. No scanner proves that arbitrary text is free of personal data. Review fixture contents and publish scope. Do not turn real records into public fixtures by changing names alone; create new examples.

## Completion evidence

The [Slice 1 security check record](slice-1-security-checks.md) lists the commands run before the demo guide and the remaining remote and manual checks.

For a behavior change, record the test that failed before the fix and passed after it. Run the relevant broader checks once the change is stable. Report the actual commands, results, and any remaining gap.

For a docs-only change, check links, convention indexes, and consistency with the product design. Do not claim application tests passed when there is no application.

When adding a custom lint or policy rule, test that it rejects a representative violation and permits legitimate code. Do not disable the rule broadly to pass the first build.

## First tooling tasks

Include these at the start of Slice 1, not as a separate long infrastructure project:

1. Done: Node.js 24.16.0, npm, the public registry, and the lockfile.
2. Done: document, tracked-path, lint, type, and test commands.
3. Done for JSDoc comments, explicit interfaces, redundant types, TypeScript source files, and Sonar complexity. Import boundary rules are active. SuChef exceptions for form data and `src/lib` are not copied.
4. Done: the Husky hook and `npm run check`.
5. The workflow file is present. Required merge protection is absent and still needs configuration.
6. Done: the first manual-account workflow and its feature map, including invalid input, missing IDs, and stale revision checks.

## SuChef evidence

The reviewed checkout has strict TypeScript, ESLint custom rules, lint rule tests, a feature map with unit/browser checks, and a Husky hook that runs lint and feature-map validation. Its hook does not run all tests or type checks. No `.github` directory was present. INAB now has a hook and a CI workflow. The feature-map check starts with the first working workflow.

## Slice 2 migration checks

The [Slice 2 demo](slice-2-demo.md) runs the built CLI from a separate temporary working directory. It copies only synthetic CSV fixtures, checks pause/resume while household tables stay empty, stale confirmation without writes, atomic confirmation, exact duplicates and zero rows, plan history, Tracking adjustment review, refusal after setup, safe receipt retry after the source file is removed, and backup/restore. User manual review and household migration are still separate steps.

Import sources and review files require explicit private paths outside the checkout. Resource limits and strict CSV/review schemas are tested. Source statuses remain distinct from posting evidence. Missing transfer/split relationships are warnings, and historical source totals remain distinct from live balance effects and revised adjustments. Date/amount/payee hashes do not define transaction identity.

The two new migrations install setup/import storage and reviewed relationship/evidence guards. Current schema version is 4, derived from the validated migration ledger. Prior-schema upgrades retain accounts and audit history, classify an existing household as start-fresh complete, and preserve recovery backups. No reset operation or automatic household import is installed.

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
