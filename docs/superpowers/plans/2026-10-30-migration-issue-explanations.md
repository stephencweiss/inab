# Migration issue explanations

**Goal:** Explain opening conflicts and export limits, and show what a saved review choice changed.

- [x] Reproduce duplicate row/account posting blockers with synthetic source data.
- [x] Add tests for both dates, duplicate suppression, standalone checks, split warning action, and acknowledgement outcomes.
- [x] Share the visible issue list across summary, selection, and progress while retaining domain checks and JSON.
- [x] Explain meaning, effect, and action before issue handling.
- [x] Report cleared/new blockers and accepted acknowledgements after confirmed saves.
- [x] Update the agreed design, manual guide, and workflow map.
- [x] Complete checks, independent review, and the synthetic demo.

## Verification

The synthetic reproduction produces the same two raw posting-in-opening-period checks: one identifies the row, and one is the account balance check. Tests first failed for the missing shared presentation helper, then for the old split warning guidance and missing UI wiring. Domain validation and raw import reports are unchanged. Only synthetic data is used.

The final `npm run check` passed 805 tests in 60 files and all document, path, boundary, formatting, lint, type, secret, and build checks. The built synthetic demo passed. Independent review identified and then approved fixes for standalone account conflicts and feedback when a second transaction introduces a new overlap. Raw account and row validation remain in place.
