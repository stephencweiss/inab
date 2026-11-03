# Review Back navigation

**Goal:** Return from nested review menus without leaving the session. Make saved-choice persistence clear.

- [x] Add failing tests for Back shortcuts, parent menus, retained choices, and exit guidance.
- [x] Add context-specific Back controls to evidence, row, account, warning, and observation menus.
- [x] Explain Back and Abandon in terminal guidance, the dictionary, and the manual guide.
- [x] Run focused tests, repository checks, and the synthetic demo.

## Scope

Back returns to a parent menu where shown. Initial guided steps and free-text/date/amount fields keep their current controls. Confirmed choices remain in the private review file. Abandon exits; it does not delete that file. JSON and script responses stay compatible.

## Verification

Before implementation, six shared-question and setup tests failed for absent Back hints, the missing History Back option, and the old exit message. Nine new menu navigation tests also failed. All 43 nested-menu tests pass. The full repository check passed 754 tests in 60 files, plus document, path, boundary, formatting, lint, type, secret, and build checks. The built synthetic demo passed. Independent review found and then approved the correction to the existing-observation evidence Back route. No household data was used.
