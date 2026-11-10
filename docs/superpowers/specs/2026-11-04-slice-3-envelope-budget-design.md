# Slice 3 envelope budget design

Date: November 4, 2026.
Status: approved for implementation by the user on November 5, 2026. See the [progress record](../plans/2026-11-05-slice-3-progress.md) for implementation and verification evidence.

## Authority and confirmed scope

The [project design](2026-10-17-inab-design.md) owns agreed product scope. The user reports the local migration slice complete and requests a Slice 3 plan. The November 4 user decision confirms support for an earlier active start month, with reviewed activity through today. The actual start month remains a user choice during activation.

The user authorized implementation on November 5. The [budget rules decision](../../decisions/2026-11-04-envelope-budget-rules.md) records the exact selected rules and validation limits. Imported history alone is not an active budget.

Slice 3 provides terminal budget activation, categories, monthly assignments, money moves, transaction allocations, transfers, card reserves, and month views. It works with manual accounts or a completed YNAB migration. Keep imported bytes, rows, monthly values, links, and receipts intact.

## Approach

Recommended: use a reviewed opening state and calculate later months from local facts. Store assignments, allocations, transfer links, and opening evidence; derive totals through pure rules. This allows correction and avoids duplicate budget ledgers.

Alternative: replay the entire export. This requires missing posting, split, and transfer evidence and risks counting opening history twice. It conflicts with the decision to retain covered history outside the register.

Alternative: store editable monthly totals. Reads are simpler, but a correction can leave stored totals inconsistent. A cache can follow measurement; it is not a second authority in this slice.

## Activation and dates

Budget activation is separate from migration setup completion. Existing manual installations remain usable before activation. Do not reopen YNAB import.

Boundary: the opening budget state is the closing state on the day before the selected start month. Activity from the first day of that month changes the active budget. A start month can be earlier than today, but not later than the current local month. Future assignments are supported after activation; future transaction scheduling stays deferred.

Require opening Cash/Credit balances, category Available, card payment reserves, Ready to Assign, and evidence for each value. Include all nonzero closed Cash/Credit accounts. Tracking values do not supply budget money. Imported month-end Available can be a candidate for the preceding month; never treat the selected month's ending Available as its opening state. Category names alone do not identify a card reserve or merge categories.

For earlier activation, require a complete reviewed activity set through today. Missing history, unknown transfer relationships, missing categories, and unsupported split reconstruction block activation. Offer a later month or explicit missing-data entry. Do not invent source relationships or silently promote history-only rows into the account register.

Also review assignments for every elapsed month, including explicit zero values. Imported Assigned values are candidates after explicit category mapping and user confirmation; imported Activity and Available remain comparison evidence. Manual setups enter assignments directly. Activation saves the reviewed assignment facts with the opening and activity facts. Do not assume all elapsed assignments were zero or derive assignments from a final Available value.

Account opening dates can differ from the budget boundary. A later account opening is not proof of its earlier balance. Require an independently evidenced boundary balance and a complete bridge to the existing register opening. Preserve account openings and IDs. Each reviewed bridge event is counted once in the budget, with source identity or explicit manual evidence; it does not change account balances already covered by an opening. A live-linked source row has one budget effect, never both a history and live effect.

Budget date: occurrence date for manual and reviewed live activity, independent of posting date. Uncleared entries affect the budget when entered. Clearing does not spend the amount again. An old pending entry at the boundary needs an explicit included-in-opening or later-budget-effect decision; do not infer it from the date alone. Exclude future source rows from current results; retain them for inspection.

Preview the opening equation and every account bridge. Require exact agreement, with zero unexplained difference. Existing debt can remain underfunded; show its shortfall. A missing value is different from a confirmed zero. An opening Cash deficit or negative Ready to Assign must be visible and explicitly confirmed, never balanced with invented income.

## Budget rules

Use USD integer cents and checked arithmetic, including intermediate sums. A category month shows carry-in, Assigned, Activity, Available, and any cash/credit overspending. Ready to Assign and future commitments are separate visible values. Allocation lines sum exactly to the signed transaction amount.

Cash income to Ready to Assign increases assignable funds. Category refunds restore that category. Cash-to-Cash transfers have two equal opposite account legs and no category activity. Cash-to-Credit payments reduce cash, debt, and payment reserve without a second expense. Transfers out to Tracking require a spending category; inflows from Tracking require income or refund treatment. Preserve the Tracking snapshot-only command scope: a boundary transfer uses a linked external leg record, not a new general Tracking register or a claimed current Tracking balance.

Transfer limits: support Cash/Cash, Cash-to-Credit payments, and Cash/Tracking flows in either direction. Refuse Credit-to-Cash advances, Credit/Credit balance transfers, Credit/Tracking, and Tracking/Tracking in this slice with a clear unsupported-treatment error. A Cash-to-Credit payment can create a positive card balance; the approved example must account for its held-funds effect separately from reserve consumption. Earlier activation with an unsupported transfer in its required activity is blocked until the rule is defined or a later supported boundary is selected.

Assignments move held money from Ready to Assign to an envelope. Money moves between envelopes conserve their combined funds. Permit actual spending even when funds are insufficient; show the resulting overspending. Reject an assignment or move that creates a new funding deficit, including in an already funded future month. Returning assigned funds can repair an existing deficit. Do not hide a later-month deficit after a backdated correction.

Positive category balances carry forward. At month change, cash overspending reduces the next month's Ready to Assign; unfunded credit spending leaves debt without a reserve. Resolve mixed cash/credit spending using an explicit cash-first funding policy, with deterministic allocation between multiple cards. The accepted examples define same-day and multi-card results. Funding credit overspending in the same month must recalculate the payment reserve.

Funded card spending moves category funds into that card's payment reserve only for the portion that creates debt. Opening debt creates no reserve by itself. Reserve assignments can fund existing debt. Positive card balances contribute held funds and create no payment reserve until purchases create debt. Refunds to categories reverse the related reserve movement; a prior payment can leave a visible reserve deficit. Interest is categorized spending. Do not clamp a negative reserve to zero or create Ready to Assign from a debt-reducing statement credit.

Same-day input order is not a financial rule. Persist a stable activity order and prove its effect on mixed spending, refunds, and positive card crossings. Month-level cash priority and card allocation rules must produce the approved examples regardless of database row order.

## Data and operation boundaries

Pure calculations live in `src/budget/`. They accept normalized budget facts; they do not import account modules, storage, adapters, or terminal code. Application operations assemble facts from both domains through application-owned ports. `src/bootstrap.ts` remains the only composition module.

Storage: one budget state/revision; category groups and categories with stable IDs and archive state; opening account/category evidence; monthly assignment facts; transaction allocation lines; transfer links; and reviewed boundary bridge facts. A card payment category has an explicit unique account link. Keep provenance references, not copied mutable import rows.

Use one immediate transaction for related facts, account changes, revision updates, and audit history. Every budget-affecting write advances the budget revision, including old manual commands and changes to opening balances. Recheck account, transaction, budget, and preview evidence revisions at commit. A snapshot read returns facts and totals from one transaction. Read commands do not write month-close records.

Backdated edits recalculate the affected month and later months. Preserve existing reconciliation review behavior. A correction to opening evidence blocks normal budget results until a reviewed amendment resolves it. Never continue with silently stale opening evidence. Renames and memo-only edits must not change money.

Reviewed historical budget events and bridge facts also need corrections after activation. Allow versioned amount, budget date, allocation, and boundary pending-treatment amendments through a preview/commit operation. Preserve original source rows and append before/after audit evidence. Recheck the account bridge and opening equation if membership crosses the activation boundary. Never change an account register indirectly through this budget-only operation; a live-linked event must use the live transaction correction path. Recalculate all affected later months atomically with revision changes.

After activation, new ordinary transactions may remain explicitly unallocated and visible in a queue. Do not present a fully verified budget while material unallocated activity exists. A transaction amount edit with allocations requires a valid replacement allocation set in the same operation, or an explicit reviewed move to unallocated state. Paired transfer edits must update both legs together.

## Terminal workflow

Command groups: `budget activation`, `budget category`, `budget assign`, `budget move`, `budget allocate`, `budget transfer`, `budget show`, and `budget activity`. Final syntax is fixed in the implementation plan. Both text and JSON use the same application operations.

Interactive activation supports saved drafts, help, back, abandon, and explicit final confirmation. Scripts supply all values and revisions with no prompts. Previews show the explicit target, before/after amounts, affected months, opening differences, unresolved activity, and funding warnings. Use the existing exit code meanings and operation-ID error handling.

## Verification and limits

Prove opening conservation, no duplicate budget effects, assignment conservation, exact allocation sums, transfer balance, credit reserve movements, month changes, and correction propagation. Use synthetic numeric examples, temporary databases, concurrency conflicts, fault injection, and built CLI workflows. Test fresh and migrated setup, account-first use, earlier activation, restore, and prior-schema upgrade.

No Plaid, web interface, recurring schedules, targets, automation, broad Tracking register, bulk rules, or historical accounting equivalence is added. Basic split allocation is needed for correct active budgeting; bulk split review and undo remain later work.

## Reference rules checked November 4, 2026

These official references inform the proposed behavior; INAB's approved examples define its supported scope.

- [Month changes](https://support.ynab.com/en_us/when-the-month-rolls-over-a-guide-rkyyd6qC9): cash and credit overspending have different next-month effects.
- [Credit cards](https://support.ynab.com/handling-credit-cards-overview-ry7cNub1s): funded purchases reserve payment money; existing debt needs separate funding.
- [Positive card balances](https://support.ynab.com/en_us/credit-cards-with-a-positive-balance-an-overview-By_H6uzJo): positive balances do not create a payment obligation.
- [Credit card refunds](https://support.ynab.com/fr/credit-card-refunds-and-returns-H1J7qDWkj): category refunds can reduce payment reserves, including after payment.

## Implementation status

Earlier-month support was confirmed November 4. The user authorized implementation November 5. Opening facts must already reflect prior-month rollover: reject unresolved negative ordinary category balances while preserving negative payment reserves. Explicitly included old pending activity is part of the reviewed opening working balance. Assignments wait while unallocated activity makes funds incomplete.

Historical imported transfers use `history|FROM_ROW_ID|TO_ROW_ID` with confirmed equal opposite amounts, account mapping, and date. A Tracking leg without a source row uses `external:ACCOUNT_ID`. A source row can supply only one budget effect; normalized source memberships also enforce this in SQLite. Plain unique manual evidence remains valid for manual historical transfers. These rules do not claim full YNAB equivalence.
