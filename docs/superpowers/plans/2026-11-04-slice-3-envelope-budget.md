# Slice 3 Envelope Budget Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement approved tasks in order. Use `superpowers:subagent-driven-development` only when delegation is selected. Track each step with its checkbox.

**Goal:** Activate a verified budget and manage categories, assignments, spending, transfers, and card payment reserves from the terminal.

**Architecture:** Store reviewed opening evidence and budget facts. Derive monthly results with pure rules in `src/budget/`; application-owned ports join account and budget operations inside atomic storage transactions. Preserve imported history as evidence.

**Tech Stack:** Existing TypeScript, Node.js, Drizzle ORM, better-sqlite3, SQLite, Vitest, and terminal prompts. USD integer cents. No new runtime dependency is proposed.

---

## Status and authority

Approved November 5, 2026; implementation status and evidence are in the [progress record](2026-11-05-slice-3-progress.md). This file retains the original task checklist and proposed test-file names as planning history; use the progress record task-completion table for current status. The progress record describes actual file consolidation, the consolidated commit sequence, and verification. Planning baseline: `223f0c6` from `origin/main`; the checkout was clean after the pull. The user authorized implementation on November 5.

Read the [Slice 3 design](../specs/2026-11-04-slice-3-envelope-budget-design.md), [project design](../specs/2026-10-17-inab-design.md), [verification guide](../../verification.md), and [document guide](../../README.md). Existing conventions apply. The user reports migration complete and confirms earlier-month activation support. The selected rules are recorded in the accepted budget decision.

**Execution gate completed:** the user authorized the design and implementation. Exact accounting choices and regressions are recorded in the decision and examples. If an approved example changes, update the owning design and tests before proceeding. Do not rerun completed tasks from this retained planning checklist.

## Scope and order

Deliver one Slice 3 workflow through small commits: verified examples; pure engine; storage; activation; category/assignment commands; allocation; transfers; correction handling; terminal review; recovery and demo. Each task ends with focused passing checks and a reviewable commit. Do not add empty placeholder modules to meet the file map.

Reuse existing money/date validation, private review-file patterns, explicit database targets, audit storage, account revision checks, and reconciliation invalidation. Do not reopen migration, modify applied migration SQL, infer source split parents, or reuse `balances()` as a historical working balance: that function intentionally includes the whole register in working totals.

## Proposed files and responsibilities

| Files | Responsibility |
| --- | --- |
| `docs/decisions/2026-11-04-envelope-budget-rules.md` | Approved accounting and date rules; create only after approval |
| `docs/budget-examples.md` | Reviewed numeric inputs and expected results |
| `src/budget/types.ts`, `parse.ts`, `opening.ts` | Complete validated facts, month/input parsing, opening validation |
| `src/budget/categories.ts`, `allocations.ts`, `transfers.ts` | Pure category, exact-sum, and linked-leg rules |
| `src/budget/months.ts`, `credit.ts`, `calculate.ts` | Ordered monthly calculation and card funding |
| `src/application/budget-ports.ts`, `budget.ts` | Budget sessions, coherent reads, preview/commit operations |
| `src/application/budget-activation.ts`, `budget-activation-ports.ts` | Draft review, evidence, opening preview, atomic activation |
| `src/adapters/budget/review-file.ts` | Private validated activation drafts; bounded IO and locking |
| `src/storage/schema/budget.ts`, `categories.ts`, `allocations.ts`, `transfers.ts` | Explicit constrained Drizzle tables |
| `src/storage/budget.ts`, `budget-activation.ts`, `budget-facts.ts` | Transaction-bound stores, evidence reads, normalized facts |
| `src/cli/budget.ts`, `budget-activation.ts`, `budget-parse.ts`, `budget-render.ts` | Dispatch, guided review, script parsing, text/JSON output |
| `src/bootstrap.ts`, `src/cli/main.ts` | Wiring and command registration |
| `src/application/accounts.ts`, `transactions.ts`; `src/storage/accounts.ts`, `transactions.ts` | Atomic integration of existing account writes with budget state |
| `drizzle.config.ts`, `db/migrations/` | Explicit schema registration and newly generated migrations |
| `tests/unit/budget-*.test.ts`, `tests/integration/budget-*.test.ts`, `tests/cli/budget-*.test.ts` | Pure examples, storage safety, user workflows |
| `scripts/demo-slice-3.ts`, `docs/slice-3-demo.md`, `docs/agent/feature_map.json` | Built CLI demonstration and executable workflow evidence |

Use narrow application session methods instead of one unbounded generic storage interface. Derive stored row types from Drizzle. Include explicit absence with `null` or tagged unions. Keep SQL and runtime imports outside the pure domain.

## Proposed terminal contract

All examples below are planned commands. `DB`, `REVIEW`, and IDs are supplied by a synthetic temporary fixture. Amounts use decimal USD at the CLI and integer cents internally.

```sh
npm run inab -- --db "$DB" budget activation start --month 2026-10 --review "$REVIEW" --json
npm run inab -- --db "$DB" budget activation review --review "$REVIEW" --interactive
npm run inab -- --db "$DB" budget activation preview --review "$REVIEW" --json
npm run inab -- --db "$DB" budget activation commit --review "$REVIEW" --expected-version 3 --confirm --json
npm run inab -- --db "$DB" budget show --month 2026-10 --json
npm run inab -- --db "$DB" budget category add --group "Living" --name "Food" --expected-version 4 --confirm --json
npm run inab -- --db "$DB" budget assign --month 2026-10 --category CATEGORY_ID --amount 200.00 --expected-version 5 --confirm --json
npm run inab -- --db "$DB" budget move --month 2026-10 --from CATEGORY_ID --to OTHER_ID --amount 25.00 --expected-version 6 --confirm --json
npm run inab -- --db "$DB" budget allocate TRANSACTION_ID --category CATEGORY_ID --expected-transaction-version 1 --expected-version 7 --confirm --json
npm run inab -- --db "$DB" budget transfer add --from CASH_ID --to CREDIT_ID --date 2026-10-17 --amount 60.00 --expected-from-version 2 --expected-to-version 3 --expected-version 8 --confirm --json
npm run inab -- --db "$DB" budget activity --month 2026-10 --unallocated --json
```

`assign --amount` sets that month's Assigned total; preview its delta. Negative totals can return funds only when supported by available funds. `move` applies two assignment deltas atomically. Whole-transaction allocation is the simple path; split mode accepts repeatable `--line CATEGORY_ID:SIGNED_AMOUNT` flags, mutually exclusive with `--category`. Income uses `--income`; transfers use linked treatment rather than a normal category. Category rename, archive, and reorder are subcommands; archived categories retain history and reject new allocations. Unarchive is supported. Group IDs and category IDs, not names, identify existing records.

Activation draft editing also has a prompt-free `budget activation set --review PATH --decision JSON --expected-version N --json` command. The discriminated decision schema covers account boundary evidence, category mapping and opening Available, card reserve mapping, Ready to Assign, activity coverage, allocations, transfer links, pending treatment, and bridge facts. Publish each complete JSON shape and an example in Task 0 before implementation. The adapter parses JSON once and returns structured errors; no direct editing of the database is supported.

Include elapsed-month assignment decisions in activation. Require an explicit confirmed total, including zero, for each mapped category/month from the start month through today. Imported Assigned is a candidate; imported Activity/Available is comparison evidence. Preserve all imported values separately.

Provide `budget activity correct ACTIVITY_ID --decision JSON --expected-activity-version N --expected-version N --confirm --json` for reviewed historical events and bridge facts. Its complete validated shape describes date, amount, allocation, and pending-boundary treatment. Live-linked events are refused here and use transaction corrections instead. Preserve the source record and append correction history. Crossing the budget boundary requires a reviewed opening/bridge amendment in the same commit.

Text and JSON report active/inactive/needs-review, start month, budget revision, Assigned/Activity/Available, Ready to Assign, future commitments, unallocated activity, overspending, and owed/reserved/shortfall per card. Exit 0 means success or abandonment, 2 invalid input or an unresolved activation requirement, 3 missing entity, 4 stale revision or a confirmed-state conflict, and 1 unexpected storage failure with operation ID. JSON never prompts. Writes require explicit confirmation.

### Task 0 — Approve rules and executable accounting examples

**Files:** Create `docs/budget-examples.md` and, after approval, `docs/decisions/2026-11-04-envelope-budget-rules.md`. Update the Slice 3 design and document guide.

- [ ] Confirm the proposed date rules, opening bridge, deficit policy, and Tracking transfer representation with the user. Support earlier months is already agreed; do not ask again.
- [ ] Define the exact activation decision JSON shapes, transfer correction commands, and account/budget version parameters. Include opening evidence correction and post-activation account addition. Keep required fields complete.
- [ ] Approve the transfer matrix: Cash/Cash, Cash-to-Credit payment (including overpayment), and Cash/Tracking are supported; Credit-to-Cash advances, Credit/Credit, Credit/Tracking, and Tracking/Tracking are explicitly refused in this proposal. Missing support blocks activation for an affected earlier period; it is not permission to skip activity.
- [ ] Write numeric expected outputs for the cases below. Expand nonnumeric rows into complete examples before proceeding; no implementer may choose an accounting outcome by convenience.
- [ ] Resolve mixed cash/credit priority, deterministic multi-card allocation, same-day ordering, refunds after payment, and future-month funding with official YNAB references and the user. Describe any deliberate difference.
- [ ] Obtain approval of the design and examples, record the decision, update the project design's Slice 3 link, and commit `docs: define Slice 3 accounting rules`.

| Case | Required expected result |
| --- | --- |
| Cash opening $1,000; reserve $100 for existing debt; Food $200; Ready to Assign $700 | Opening equation $1,000 = $100 + $200 + $700; credit debt itself creates no assignable funds |
| Food $200; zero-balance card purchase $60 | Food $140, payment reserve $60, card -$60; no change to total held funds |
| Pay that card $60 from $1,000 Cash | Cash $940, card $0, reserve $0; purchase expense remains $60 |
| Cash Food purchase $60 from Food $200 | Cash $940, Food $140; no card reserve movement |
| Food $0; card purchase $60; assign $60 during same month | Before funding: Food -$60, reserve $0; after funding: Food $0, reserve $60 |
| Prior month cash overspend $40 | Next month Food starts $0; Ready to Assign falls $40 exactly once |
| Prior month credit overspend $40 | Next month Food starts $0; debt remains $40 without a reserve; no second Ready to Assign deduction |
| Opening card debt $500; reserve $200 | Owed $500, reserved $200, shortfall $300 |
| Split -$60 into -$40 and -$20 | One account effect -$60; exact category effects; reject -$59.99 total |
| Cash transfer $100 between two Cash accounts | Combined cash and all categories unchanged |
| Positive card $50; funded purchase $70 | Card ends -$20; reserve increases $20, not $70; category falls $70 |
| Mixed cash/credit overspending; two cards; ties on one date | Specify exact per-card reserves and cash/credit deficits, including insertion-order variants |
| Refund before payment, after payment, and across a month | Specify category, payment reserve, debt, Ready to Assign, and any reserve deficit |
| Interest, debt-reducing statement credit, payment beyond reserve | Distinguish spending, debt reduction, and payment deficit; no invented income |
| Assign $100 in a future month; then change the current month | Held funds are committed once; define visible future deficit and refusal/repair behavior |
| Earlier activation; later account opening; old pending row | Evidence bridge and pending treatment count each budget effect once and preserve register balance |
| October opening Food $100, Ready to Assign $900; assign $200; spend $60; November assign $50 | October Available $240, Ready to Assign $700; November Available $290, Ready to Assign $650; reviewed elapsed assignments are saved once |
| Pay $70 from Cash $100 to a card owing $50 with reserve $70 | Cash $30, card +$20, reserve $0; held funds $50; approve the exact Ready to Assign adjustment without inventing income |
| Credit cash advance or balance transfer during an earlier activation period | Explicit unsupported-treatment refusal; do not omit it or infer a normal card payment |

### Task 1 — Parse facts and validate opening conservation

**Create:** `src/budget/types.ts`, `parse.ts`, `opening.ts`; `tests/unit/budget-opening.test.ts`, `budget-parse.test.ts`.

- [ ] Red: test strict `YYYY-MM`, invalid leap dates, missing versus zero values, unsafe cents, currency mismatch, Tracking exclusion, nonzero closed accounts, duplicate source effects, missing evidence, and the $1,000 opening equation above.
- [ ] Run `npm test -- tests/unit/budget-opening.test.ts tests/unit/budget-parse.test.ts`; expect missing-module or missing-behavior failure.
- [ ] Green: implement validated fact contracts and checked opening calculation. Reuse `src/lib/money.ts` and `date.ts`; return explicit errors and difference amounts.
- [ ] Rerun the focused tests, `npm run typecheck`, and `npm run check:boundaries`; expect success. Commit `feat: validate budget opening state`.

### Task 2 — Calculate Cash categories, assignments, and month changes

**Create:** `src/budget/categories.ts`, `allocations.ts`, `months.ts`, `calculate.ts`; `tests/unit/budget-cash.test.ts`, `budget-months.test.ts`.

- [ ] Red: encode approved Cash, income/refund, exact split, assignment/move, future commitment, overspending, rollover, ordering, and overflow examples. Test backdated corrections across December/January and unchanged unrelated months.
- [ ] Run `npm test -- tests/unit/budget-cash.test.ts tests/unit/budget-months.test.ts`; expect required-rule failures.
- [ ] Green: implement pure month calculation with an explicit report horizon and stable ordering. Return incomplete results for unallocated activity, never an unqualified verified total.
- [ ] Verify assignments conserve funds, split sums equal parents, and moving money out and back restores all totals. Rerun focused tests and types; commit `feat: calculate Cash envelope budgets`.

### Task 3 — Calculate card reserves and transfers

**Create:** `src/budget/credit.ts`, `transfers.ts`; `tests/unit/budget-credit.test.ts`, `budget-transfers.test.ts`. Modify `src/budget/calculate.ts`.

- [ ] Red: encode every approved card and transfer example from Task 0, including mixed spending, two cards, positive crossings, same-month coverage, refunds after payment, interest, and month changes.
- [ ] Run `npm test -- tests/unit/budget-credit.test.ts tests/unit/budget-transfers.test.ts`; expect missing behavior.
- [ ] Green: implement explicit per-card reserve movements, debt/shortfall reporting, paired transfers, and categorized boundary flows. Reject self-transfers, mismatched cents/currency, duplicate legs, and duplicate source effects.
- [ ] Confirm permutations of storage row order give the approved result. Run all budget unit tests and types; commit `feat: calculate card reserves and transfers`.

### Task 4 — Install constrained budget storage and verify upgrade recovery

**Create:** four proposed schema files, `tests/integration/budget-schema.test.ts`. **Modify:** `drizzle.config.ts`, migration tests, and generated migration SQL/metadata.

- [ ] Red: test one activation, explicit card/category link uniqueness, foreign keys, valid month/cents/revisions, unique transaction allocation positions, one transfer membership per leg, and preservation of import records. Verify no default budget row makes empty migration setup nonempty.
- [ ] Run `npm test -- tests/integration/budget-schema.test.ts`; expect missing tables/constraints.
- [ ] Green: define reviewed tables. Generate with `npm run db:generate -- --name=slice_3_budget`; review all SQL and metadata before application. Use a custom migration in the same chain only for needed cross-table guards. Do not edit migrations 0000–0003.
- [ ] Test fresh initialization, synthetic version-4 upgrade with manual and imported data, backup-before-upgrade, failure preservation, and current-version validation. Update schema-version assertions and migration bundling expectations.
- [ ] Run `npm test -- tests/integration/budget-schema.test.ts tests/integration/migrations.test.ts tests/integration/backup.test.ts`; expect success. Commit schema, SQL, and metadata together as `feat: add budget storage schema`.

### Task 5 — Assemble complete budget facts from stored evidence

**Create:** `src/storage/budget-facts.ts`, `src/application/budget-ports.ts`; `tests/integration/budget-facts.test.ts`.

- [ ] Red: verify one coherent snapshot; source-to-live deduplication; no history-only register replay; explicit category/card mappings; missing boundary history refusal; and earlier start with a verified account bridge.
- [ ] Run `npm test -- tests/integration/budget-facts.test.ts`; expect missing normalization behavior.
- [ ] Green: normalize validated rows into budget facts through application-owned ports. Retain evidence IDs and revisions. Never infer links from date/amount/name. Do not call `balances()` to obtain a past working balance.
- [ ] Verify live account totals and import bytes/rows/receipts stay unchanged during assembly. Run focused tests, types, and boundaries; commit `feat: assemble traceable budget facts`.

### Task 6 — Review and commit activation atomically

**Create:** activation application/ports, storage, adapter files from the map; `tests/unit/budget-activation.test.ts`, `tests/integration/budget-activation.test.ts`, `budget-review-file.test.ts`.

- [ ] Red: test fresh and migrated setup, legacy manual accounts, earlier/current month, incomplete setup, future start refusal, missing values, missing activity, differing account boundaries, old pending entries, explicit negative opening acknowledgement, and stale evidence.
- [ ] Include the two-month assignment example. Verify confirmed imported Assigned values become active assignment facts once, while imported Activity/Available and all original source records remain unchanged. Missing elapsed-month assignments block activation.
- [ ] Run `npm test -- tests/unit/budget-activation.test.ts tests/integration/budget-activation.test.ts tests/integration/budget-review-file.test.ts`; expect missing operations.
- [ ] Green: implement private bounded versioned drafts bound to database identity and evidence revisions. Reuse migration review IO patterns without changing that format. Preview is read-only. Abandon preserves saved choices; resume does not require the original CSV files.
- [ ] In one immediate transaction revalidate target, setup, evidence, coverage, opening equation, and draft revision; save active state, opening facts, mappings, and audit. Failure leaves no active budget. Return a saved receipt on identical retry; conflicting second activation is refused.
- [ ] Inject failure after each write group, race two confirmations, change the target and an account between preview and commit, and test a successful retry after removing source CSV paths. Verify no partial result or duplicate effect. Commit `feat: activate reviewed budgets atomically`.

### Task 7 — Add category, assignment, and money-move operations

**Create:** `src/application/budget.ts`, `src/storage/budget.ts`; `tests/integration/budget-commands.test.ts`.

- [ ] Red: test add/rename/archive/unarchive/reorder, stable IDs, duplicate names, unique card links, set-versus-delta assignment semantics, paired moves, future commitments, deficit repair, concurrent previews, and audit rollback.
- [ ] Run `npm test -- tests/integration/budget-commands.test.ts`; expect missing operations.
- [ ] Green: implement read/preview/commit with budget revision and evidence checks in the write transaction. Archive preserves history; card payment categories cannot be relinked while dependent facts exist.
- [ ] Inject failure between move deltas and before audit. Assert all facts and revision remain unchanged. Run focused tests and types; commit `feat: manage budget categories and assignments`.

### Task 8 — Allocate transactions and integrate all existing writes

**Modify:** application/storage account and transaction modules. **Create:** `tests/integration/budget-allocation.test.ts`, `budget-corrections.test.ts`.

- [ ] Red: test whole and split allocation; income versus refund; clearing without a second budget effect; amount/date/opening edits; new accounts after activation; category-only corrections; and explicit unallocated activity.
- [ ] Run `npm test -- tests/integration/budget-allocation.test.ts tests/integration/budget-corrections.test.ts`; expect stale-budget or missing-integration failures.
- [ ] Green: save allocations, account/transaction revisions, budget revision, reconciliation review states, and audit in one transaction. Existing manual writes must participate even when invoked through old commands. Before activation their behavior stays usable.
- [ ] Require replacement allocation lines or a reviewed unallocated transition for amount edits. Budget opening evidence edits set `needs-review`; expose a preview/commit amendment that revalidates the opening equation and bridge before returning to active. Do not silently rebuild the opening from changed accounts.
- [ ] New accounts require an effective entry date and explicit treatment of their balance as existing budget funds, income, or debt; prevent counting a transfer-funded account as new income. Preserve manual-only creation before activation.
- [ ] Confirm backdated edits change all affected later reports and future deficits, while memo edits preserve money. Run existing transaction/account/reconciliation tests plus focused tests; commit `feat: keep budgets correct during account corrections`.
- [ ] Test and implement historical activity/bridge correction through the declared command contract: preserve source rows, check event and budget revisions, audit before/after, refuse live-linked events, revalidate boundary-crossing amendments, and recalculate later months. Inject failure after historical event update to prove rollback. Include these changes in this task's commit.

### Task 9 — Write and correct linked transfers

**Modify:** `src/application/budget.ts`, `src/storage/budget.ts`, affected transaction commands. **Create:** `tests/integration/budget-transfers.test.ts`.

- [ ] Red: test Cash/Cash, Cash/Credit payment, categorized Cash/Tracking boundary, explicit linking of existing legs, already-linked source rows, mismatched evidence, and correction of either leg through old commands.
- [ ] Test the complete approved transfer matrix, explicit unsupported directions, and the card overpayment example. A payment crossing zero must preserve held funds and cannot consume its reserve twice.
- [ ] Run `npm test -- tests/integration/budget-transfers.test.ts`; expect missing transfer behavior.
- [ ] Green: create or link both legs atomically, preserving existing IDs. Distinguish Cash/Credit transfers from card payments in the validated contract. A Tracking boundary uses explicit external-leg evidence and leaves snapshots unchanged.
- [ ] Provide preview/commit edit and unlink/reclassify operations for erroneous links; require balanced replacement facts and affected reconciliation review. Refuse unilateral edits through old transaction commands. Inject failure after the first leg and before audit; test stale revisions for both accounts and budget. Commit `feat: record linked budget transfers safely`.

### Task 10 — Expose script commands and coherent monthly reports

**Create:** `src/cli/budget.ts`, `budget-parse.ts`, `budget-render.ts`; `tests/cli/budget.test.ts`. **Modify:** main, bootstrap, help tests.

- [ ] Red: run all proposed terminal contracts against temporary synthetic data. Cover malformed input, missing entity, incomplete activation, stale version, missing confirmation, split sums, future assignments, unallocated activity, and text/JSON output.
- [ ] Run `npm test -- tests/cli/budget.test.ts`; expect unsupported-command failures.
- [ ] Green: wire operations through bootstrap. Reads use a single snapshot and include completeness/status fields, account versus category distinctions, future deficits, and card shortfalls. Scripts cannot prompt. Help states set/delta semantics and required IDs/revisions.
- [ ] Verify reports from October activation through November match unit examples; no report writes a month-close record. Run focused CLI tests, types, and boundaries; commit `feat: expose terminal budget commands`.

### Task 11 — Add guided activation and terminal help

**Create:** `src/cli/budget-activation.ts`, `tests/cli/budget-activation.test.ts`. **Modify:** shared help terms only where needed; keep `docs/term-dictionary.md` consistent.

- [ ] Red: test orientation, earlier-month coverage, boundary evidence, exact differences, missing data choices, help/back/abandon, resume, changed target, conflicts, and a separate final confirmation without a default yes.
- [ ] Run `npm test -- tests/cli/budget-activation.test.ts`; expect missing guided flow.
- [ ] Green: guide decisions through the same application operations as script commands. Show each unresolved amount or relationship with its reason and next action; do not turn a source limitation acknowledgement into proof of complete activity.
- [ ] Verify help does not save or advance revisions; back preserves valid choices and rechecks dependent choices. Terminal mode, JSON, script mode, and completed retry remain separate. Commit `feat: guide budget activation review`.

### Task 12 — Prove recovery, publish workflow evidence, and close the slice

**Create:** `scripts/demo-slice-3.ts`, `docs/slice-3-demo.md`. **Modify:** `package.json` only to add `demo:slice-3`; README, document guide, project design status, verification guide, feature map, and `tests/policy/feature-map.test.ts` where needed.

- [ ] Red: extend the workflow harness for actual new commands, with success and refusal cases and fixed temporary paths. Add restore comparison of openings, allocations, transfers, assignments, revisions, source history, and derived reports to `tests/integration/backup.test.ts`.
- [ ] Green: complete the built CLI scenario for both start-fresh and synthetic imported setups. Include earlier activation, a month change, funded card purchase/payment, correction, stale preview, restore, and incomplete activation refusal.
- [ ] Run `npm run demo:slice-3` after adding its script; expect exact documented totals from an isolated temporary working directory. Keep examples synthetic and clock-controlled.
- [ ] Run `npm run check`, `npm run demo:slice-2`, and `npm run demo:slice-3`. Record actual command results, runtime, revision, red/green evidence, review findings, and limits in this plan or a dated progress record. Run no household data tests.
- [ ] Review the complete changes against the approved spec. Resolve findings, then commit `docs: record Slice 3 workflow and verification`. Update the feature map only for working commands. Present the demo for user manual review; do not label manual review passed without the user result.

## Completion evidence

Slice 3 is complete only when approved accounting examples pass, both setup paths activate safely, categories and assignments work, transactions and transfers have one financial effect, card reserves are correct, later months respond to corrections, unresolved states remain visible, all writes are atomic, and restore reproduces the same budget. Planned checks stay marked planned until installed and run. Push, deployment, and household activation are outside this planning task.
