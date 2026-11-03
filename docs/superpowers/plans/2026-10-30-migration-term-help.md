# Migration term help implementation plan

**Goal:** Keep migration prompts short and make each decision explainable through case-insensitive `h` or `help`.

- [x] Add one typed offline term dictionary, a readable document, and a check that the two agree.
- [x] Test help at every question type before implementation. Help must repeat the same prompt without changing defaults, review revisions, or database records.
- [x] Add help and abandon hints to all migration questions. Keep prior defaults. Accept upper/lowercase shortcuts and reject ambiguous enum initials.
- [x] Give date, balance, account, row, history, observation, resolution, and confirmation questions relevant dictionary topics. Explain that the date default is local today, not a YNAB value. Keep Cash and Credit guidance specific to the chosen kind.
- [x] Update the design, manual guide, document index, feature map, and verification evidence. Run focused tests, type/lint/boundary/document checks, full repository checks, and the synthetic script demo.

## Verification — October 30, 2026

New question-help tests failed before implementation. Integration tests confirmed that opening-date, save-choice, and history help did not yet exist. Three further regressions failed before explicit observation-date, observed-balance, and review-file help received their correct topics. All are now green.

`npm run check` passed 58 test files and 659 tests, plus document, tracked-path, boundary, format, lint, type, secret, and build checks. `npm run demo:slice-2` passed through the built CLI with five source rows, a 130 USD Tracking observation, and a revised 30 USD adjustment. Independent reviews found no remaining issues. Household files were not used.
