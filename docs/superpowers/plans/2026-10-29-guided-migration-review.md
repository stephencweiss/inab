# Guided migration review implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task by task with tests before behavior changes.

**Goal:** Guide a user from source account choices to a reviewed, explicitly confirmed migration, while retaining script commands.

**Architecture:** Keep mode parsing at the CLI boundary. Use small prompt and review modules around the existing inspect/change/commit operations. Preserve storage schemas, arithmetic, evidence rules, and revision checks.

**Tech Stack:** TypeScript, Node.js 24.16.0, Vitest, existing terminal prompts.

## Tasks

- [x] Mode selection: add failing tests in `tests/cli/setup.test.ts`; implement `--interactive`/`-i`, conflicting mode rejection, terminal checks and readable interactive result output in `src/cli/setup-parse.ts`, `src/cli/setup.ts`, and help in `src/cli/main.ts`. Verify script arguments and existing JSON commands.
- [x] Validated questions: add `src/cli/migration-questions.ts` and focused tests. Show enum values, date and USD formats, explanations, and retry invalid answers. Reuse existing date/money parsers. Cancellation preserves saved choices.
- [x] Guided flow: add failing integration tests in `tests/cli/import-review.test.ts` and focused tests for account/history/Tracking choices. Replace the key/action loop in `src/cli/imports.ts` with focused `migration-guide` modules. Select accounts by name; confirm mappings, openings, coverage, row and observation evidence explicitly. Resume saved choices and show relevant blockers with actionable choices. Summarize before a separate final confirmation.
- [x] Documentation: update the approved design status, manual review guide, CLI help and feature-map examples to match the final prompts and mode rules.
- [x] Verification: run focused CLI tests through red/green, typecheck, lint, boundaries, documents, the synthetic demo, and `npm run check`. Review spec compliance and code quality independently. Fix findings, record evidence, and report remaining limits.

## Test commands

Use Node.js 24.16.0. Run `npx vitest run tests/cli/setup.test.ts tests/cli/import-review.test.ts tests/cli/migration-questions.test.ts` for focused checks. Each new behavior must fail before implementation. Run `npm run check` and `npm run demo:slice-2` after integration. Use synthetic fixtures and temporary databases only; do not inspect or modify the user's manual-session files.

## Execution evidence — October 29, 2026

- New mode tests failed before mode parsing was added. Guided account tests failed with `invalid-review-action` before replacing the action/key loop. The explicit account prompt regression failed with `invalid-account-kind` before validated enum questions were added.
- Question and history helper tests failed before their modules existed. Review regressions failed before fixes for future dates, missing mappings, source context, monthly conflict details, retained history roles, and exact-cent display.
- `npm run check` passed: 56 test files, 553 tests, plus document, tracked-path, boundary, formatting, lint, type, secret, and CLI build checks.
- `npm run demo:slice-2` passed with five source rows, a 130 USD Tracking observation, and a revised 30 USD adjustment. The built script workflow remains compatible.
- Independent spec and quality review findings were corrected and regression-tested. No household database or export was used. Manual user review remains pending.
