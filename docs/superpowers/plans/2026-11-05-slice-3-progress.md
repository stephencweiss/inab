# Slice 3 implementation progress

Date: November 5, 2026.
Status: implemented and verified locally. Independent specification and code-quality review found no remaining serious blockers. User manual review is pending.

## Scope and decisions

The user authorized implementation of the [Slice 3 plan](2026-11-04-slice-3-envelope-budget.md). Earlier-month activation was already confirmed. The [budget rules](../../decisions/2026-11-04-envelope-budget-rules.md) and [examples](../../budget-examples.md) record selected accounting behavior.

The implementation uses pure budget rules, application-owned sessions, constrained normalized storage, and shared terminal operations. Activation is separate from migration setup. It preserves imported sources and verifies account boundaries, pending decisions, elapsed assignments, and complete activity. Daily commands cover categories, assignment totals, money moves, allocations, paired transfers, historical corrections, and reviewed opening amendments. Reads calculate all affected months without writing a month close.

The implementation splits responsibilities into more focused files than the draft map. Credit calculation shares the ordered month engine in `src/budget/calculate.ts`; storage has dedicated fact, hook, transfer, and write modules; the terminal has separate parser, command, guide, preview, and renderer modules. No new runtime dependency was added.

## Red and green evidence

- Domain tests failed before the new modules existed. Opening, allocation, Cash/Credit, refund, overspending, rollover, and future commitment cases now pass.
- Storage tests failed on missing budget tables. Generated migration 0004 installs the schema; custom migration 0005 adds relationship guards. The credit-category guard test failed before that guard was installed.
- Activation tests failed on missing operations. Earlier activation, stale evidence, exact retry, missing assignments, opening mismatch, and injected-save rollback now pass.
- Existing-write integration tests failed because transaction writes did not advance budget revisions and opening edits did not block reports. Both are now transactionally integrated.
- Review found a future-assignment return could hide an earlier deficit. A failing regression now checks maximum cumulative monthly commitments.
- Review found mixed-sign card splits used the net parent outflow instead of gross spending. A failing numeric regression now checks positive-card funds, reserve reversal, and held-funds conservation.
- Negative ordinary opening balances delayed rollover by one month. A failing regression now requires explicitly normalized opening funds; negative card reserves stay valid.
- Three failing boundary tests showed clearing could replace an old pending budget date, and date changes could break reads or silently omit spending. They now preserve reviewed dates and mark boundary changes for an accessible amendment.
- A failing historical transfer test reproduced duplicate use of one imported debit. Canonical leg validation and migration 0006's unique source memberships prevent reuse across history and live effects.
- Terminal parser, private review-file, guide, help/back/abandon/resume, target replacement, rendering, JSON, and command tests use synthetic fixtures. Review files have bounded private IO and explicit database/device/inode bindings.
- The workflow map's new budget safety test failed before budget target validation existed. The implemented map workflow now exercises activation, assignment, allocation, stale refusal, and restored reports.
- The Slice 2 version-4 upgrade test preserves account and audit history and verifies its prior-version recovery backup. Budget recovery preserves normalized facts, revisions, receipts, and derived reports.

## Verification record

Node.js 24.16.0 and the pinned dependencies are installed. The working branch is `codex/slice-3-envelope-budget`, based on `223f0c6`.

Final results on November 5:

- `npm run check` passed: documents, private paths, module boundaries, formatting, ESLint, TypeScript, all 974 tests in 82 files, current-file secret checks, and the CLI build. The test stage took 229.35 seconds.
- `npm run demo:slice-2` passed, including five synthetic source rows and Tracking observation/adjustment checks.
- `npm run demo:slice-3` passed for both fresh and migrated plans, through activation, assignments, a corrected card purchase, payment, month change, stale refusal, safe retry, and restored reports.
- Independent specification and code-quality review found no remaining serious blocker after the recorded fixes. A final narrow review approved the new-account amendment fix.
- `git diff --check` passed.

An earlier full run had 973 passing tests and one new-account amendment regression. Adding activity to an account before reviewing its opening could make saved facts unreadable. The fix keeps saved normalized facts intact while `needs-review` blocks normal reports; raw transactions remain available to the guide. The regression now completes an amendment and verifies active Ready to Assign of $1,001. The full check was rerun successfully after this fix.

The original per-task commit sequence was consolidated into one verified local change set. No hook or check was bypassed.

The default sandbox blocks the local IPC socket used by the `tsx` command runner. Required full commands run with the approved sandbox escalation; no check or hook is weakened. Earlier sandbox-only build failures are not application failures.

No household database or export was opened. No push, merge, deployment, or household activation is claimed.

## Task completion

| Plan task | Result |
| --- | --- |
| 0 | Approved design, exact rules, complete script shapes, and numeric examples recorded |
| 1–3 | Validated pure opening, Cash, Credit, allocation, transfer, and month calculations |
| 4–5 | Reviewed migrations 0004–0006, constrained schema version 7, source membership, and coherent facts |
| 6 | Private resumable review and atomic activation with exact retry receipts |
| 7–9 | Categories, assignments, moves, allocations, existing-write integration, transfer corrections, and opening amendments |
| 10–11 | Prompt-free scripts, readable reports, guided review, help/back/edit/abandon/resume, and separate confirmation |
| 12 | Full checks, both built CLI demos, workflow map, recovery, and independent review passed; user manual review remains open |
