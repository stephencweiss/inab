# Review progress and layout

**Goal:** Show the review workload at the start, keep progress readable, and explain History actions before asking for a choice.

- [x] Test grouping of repeated mapping blockers into required steps, conditional opening steps, split groups, and unresolved source rows.
- [x] Show initial steps and warning counts; update addressed and remaining steps after each save. State that new evidence can change counts.
- [x] Put section headings above their content, add blank-line separators, and mark every action question with -->.
- [x] Explain history/edit/save, support h/e/s/a in the History menu, and keep full-word help without side effects. Other prompts keep h as help.
- [x] Verify focused behavior, full repository checks, and the built synthetic demo. Record evidence and independent review.

## Verification

Tests first failed for absent step counts, old prompt markers, and missing History action shortcuts. Progress tests cover conditional account opening steps, duplicate mapping blockers, split groups, and unmapped rows. A separate multi-account regression failed before History save was changed to return directly to the summary. It now passes without adding a coverage acknowledgement or prompting for another opening.

The final `npm run check` passed 60 test files and 730 tests, including document, path, boundary, formatting, lint, type, secret, and build checks. The built synthetic demo also passed. Independent review approved the progress model, action markers, History shortcuts, and corrected save flow. No household database was used.
