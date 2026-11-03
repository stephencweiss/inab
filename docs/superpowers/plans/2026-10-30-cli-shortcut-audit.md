# CLI shortcut audit

**Goal:** Display available first-letter controls in all terminal menus and make current text values explicit.

- [x] Audit all prompt sites in `src/cli`, including setup, migration, accounts, transactions, reconciliation, snapshots, backup, and restore.
- [x] Test unique, ambiguous, reserved, and numeric choices before changing shared menu hints.
- [x] Share account-kind choices between manual creation and migration; preserve explicit command flags.
- [x] Test and implement c/confirm for current text, including help, case, replacement values, and no-current-value input.
- [x] Update the design, manual guide, shared term help, and feature map.
- [x] Complete repository checks and the synthetic demo.

## Audit decisions

All menus use the shared choice helper or dedicated start/closed/save/History controls. The shared helper displays available letters rather than a fixed list of five special values. Cash/Credit and pending/posted require full words because their first letters conflict. Accounts/add/adjustment/acknowledge and generic history require full words because a/h are reserved. The dedicated History menu keeps h for history and full-word help. Numbered choices stay numeric.

Manual account-kind input now uses the shared menu. Other direct prompts accept IDs, paths, revisions, dates, money, or free text, so no menu-value shortcut applies. Abandon remains case insensitive. Current names and payees use c/confirm only when a current value exists. Script flags and subcommands keep their full names.

## Verification

Before implementation, 17 focused tests failed for absent shortcut hints, missing current-value confirmation, and manual Tracking shortcut input. All 234 focused tests passed. The full repository check passed all 780 tests in 60 files, plus document, path, boundary, formatting, lint, type, secret, and build checks. The built synthetic demo passed. Independent review found no remaining prompt or shortcut gaps.
