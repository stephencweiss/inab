# CLI prompt consistency

**Goal:** Display abandon across all terminal options and use case-insensitive confirmation controls.

- [x] Audit every terminal question and the main help text for displayed cancel options.
- [x] Add failing tests for manual workflow prompts, real terminal abandonment, confirmation aliases, retry without a default, and consistent exit messages.
- [x] Reuse the migration confirmation helper for manual writes. Keep script flags, response fields, existing defaults, and raw text values compatible.
- [x] Display abandon in account, transaction, reconciliation, Tracking, recovery, and migration prompts. Share the abandonment error without a runtime import cycle.
- [x] Run focused tests, the full repository check, and the built synthetic demo. Record results.

## Verification

New tests first failed for the old manual prompt text, missing letter controls, and older help/exit wording. Focused prompt tests cover 16 manual command paths, real readline abandonment, error identity, raw text preservation, and explicit confirmation without a default. The source audit finds no displayed cancel option or old Canceled exit message.

`npm run check` passed 59 test files and 700 tests, including format, lint, types, boundaries, documents, tracked paths, secrets, and CLI build. `npm run demo:slice-2` also passed through the built CLI. Script confirmation flags and JSON `canceled` fields remain compatible. Restart a running review to load current prompts; previously saved choices remain.
