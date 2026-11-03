# Tracking transactions and balance adjustments

Date: October 20, 2026
Status: balance model agreed by the user; Slice 2 implementation is not started.

## Agreed model

Tracking accounts can contain transactions. Transactions change the recorded balance. A snapshot records an observed balance at a defined boundary. The system calculates an explicit reconciliation adjustment equal to the observed balance minus the recorded balance at that boundary.

| Point | Record | Resulting balance |
| --- | --- | --- |
| t0 | Initial balance +100 | 100 |
| t1 | Transaction -10 | 90 |
| t2 | Transaction +15 | 105 |
| t3 | Observed balance 130; adjustment +25 | 130 |

The observed value 130 is a target, not an additional +130 transaction. Earlier transactions remain in history. The adjustment accounts for the remaining difference. Transactions after the observation continue from the adjusted balance.

Keep the observation and its adjustment linked. Show the difference as an explicit record; never hide it. Tracking balances remain outside the budget. This decision does not authorize automatic balancing adjustments for Cash or Credit accounts.

Import must preserve existing source adjustments and avoid generating them again. Keep history already covered by an opening balance outside the active register, as agreed in the [opening-history decision](2026-10-20-import-opening-history.md).

## Observation dates and same-date selection

Agreed October 21, 2026: the effective date describes the balance at the end of that day. Keep the recorded time separate; importing an older observation does not change its effective date.

Retain one observation per Tracking account and effective date. If several observations are candidates for that date, require the user to select one. Discard the other candidates as observations; do not average, sum, or automatically choose among them. Only the retained observation can supply the closing balance and linked adjustment for that date.

Discarding an observation candidate does not erase its raw import source row or source disposition. Those records explain what was imported or excluded. They must not act as extra observations or create extra adjustments. Replacing an already retained observation must preserve the audit evidence; the exact review contract remains to be defined.

## Ordering and pending transactions

Agreed October 21, 2026: include confirmed posted transactions through an observation's effective date before its closing-balance adjustment. Pending transactions do not enter this calculation. Accepting an imported record does not itself confirm bank posting.

When a previously pending transaction is confirmed posted, use its posting date:

- After an observation's effective date: change the later recorded balance; that observation stays valid.
- On or before an observation's effective date: flag the affected observation for review. Preserve its original amount, adjustment, and evidence.
- Unknown posting date: retain the pending state and report the uncertainty. Do not use the purchase date as a substitute.

For example, an October 20 closing observation of 130 remains valid if a pending withdrawal of 10 posts October 21; the later recorded balance is 120. If it posts October 20 or earlier, apply the review rule instead. Other later observations whose evidence is affected also require review.

Slice 2 preserves posting evidence and reports uncertainty during import. Automatic pending-to-posted matching through Plaid belongs to Slice 4.

## Changes to earlier activity

Agreed October 21, 2026: when a change to earlier activity affects an observation's balance evidence, mark the affected observation `needs-review`. Apply the same rule to manual changes, reviewed imports, and future Plaid updates. The source of the change does not determine the review rule.

Preserve the original observed amount, linked adjustment, and evidence. Do not automatically change the adjustment to force agreement. Show the revised recorded balance and its difference from the observed balance for review. Save the transaction change, affected review states, and audit history together.

For example, changing t1 from -10 to -15 leaves the original +25 adjustment intact. The revised balance at t3 is 125, while the original observation remains 130. Flag that observation for review with a difference of +5 needed to reach the observed amount. Resolve the flag through the explicit review process below.

## Review resolution

Agreed October 21, 2026: show changed transactions, the original observed balance, the linked adjustment, the revised recorded balance, and the remaining difference. The user can correct transaction data, explicitly confirm a revised adjustment when the observed balance is still correct, or leave the observation flagged for later review.

For the example above, if the observed balance remains 130 and the revised recorded balance is 125, confirmation revises the adjustment from +25 to +30. This replaces the active adjustment amount; it does not add another +30 transaction. Preserve the previous +25 adjustment and original evidence in audit history. Retain one active observation for the account and date.

Never revise an adjustment merely because new data arrived. Until the user resolves the difference and confirms the result, retain `needs-review`. Correcting transaction data must be followed by a fresh check of the evidence; do not clear the flag based only on the edit. Confirmation must recheck the current account and observation revisions and commit the adjustment, evidence, review state, and audit history together. A change affecting later observations applies the same review rule to those observations.

Slice 2 provides this review only where needed for import and historical inspection. Standalone manual Tracking commands remain future Slice 6 work. The exact CLI and import review file contracts still need design.

## Delivery scope

Agreed October 21, 2026: Slice 2 supports only the Tracking behavior needed to import and inspect history correctly. Preserve source adjustments and observation evidence, prevent double counting, and flag affected observations during reviewed imports.

Broader manual Tracking transaction entry, editing, and new observation/adjustment commands belong to future Slice 6 work. Existing Slice 1 snapshot commands remain available. Manual and future Plaid changes must follow the same review rule when those workflows are implemented; this rule does not bring those commands or Plaid into Slice 2.

## Planning questions

Before implementation, define replacement of an incorrect observed amount and the exact review contracts. Dates, ordering, pending treatment, and resolution of changed transaction evidence are agreed above. Do not silently change an old adjustment or count pre-observation activity twice. Define zero-difference observation behavior, repeat confirmation identity, migration of Slice 1 snapshots, and audit evidence.

The Slice 2 plan must cover imported transaction and observation evidence together. Detailed import contracts and schema remain proposed. Broader manual command design is deferred to Slice 6. Slice 1 still uses its existing snapshot-only implementation.

This extends the [Slice 1 scope decision](2026-10-17-tracking-snapshot-scope.md). See the [project design](../superpowers/specs/2026-10-17-inab-design.md) and [Slice 2 plan](../superpowers/plans/2026-10-20-slice-2-ynab-import.md).

Scope update October 21, 2026: YNAB import is [initial setup only](2026-10-21-ynab-bootstrap-only.md). The general change and review rules above do not authorize subsequent imports into a completed plan. Slice 2 applies only the parts needed during bootstrap and historical inspection; later manual and provider workflows remain future work.
