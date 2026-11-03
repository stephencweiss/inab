# Migration orientation and CLI welcome

**Goal:** Make the normal migration path clear before the first review question and display INAB ASCII art at terminal startup.

- [x] Test orientation text before the first question without changing saved choices.
- [x] Explain history, Cash/Credit starting balances, later activity, optional row promotion, pending balances, and Tracking differences.
- [x] Reinforce the normal path at the opening and History sections.
- [x] Add a terminal-only INAB banner, keeping JSON, scripts, and version output plain.
- [x] Test actual CLI help, version, and JSON startup with terminal state.
- [x] Update the design, manual guide, README, and workflow map.
- [x] Verify all checks and the built synthetic demo.

## Verification

The initial test run failed because the guide did not describe the three steps before asking a question and the banner helper did not exist. Verification uses synthetic migration data and temporary databases only. No migration rule or saved choice is changed by the welcome text.

The final `npm run check` passed 813 tests in 61 files, plus document, path, boundary, formatting, lint, type, secret, and build checks. The built synthetic demo passed. Tests verify that migration orientation appears before the first question without changing saved choices, terminal help displays the banner once, and JSON/version output stays plain.
