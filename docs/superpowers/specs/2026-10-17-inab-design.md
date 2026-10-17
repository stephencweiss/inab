# INAB project design and build roadmap

Date: October 17, 2026
Status: Draft for user review. This document records agreed scope and proposed build steps. It is not a detailed implementation plan.

## Purpose

Build a personal budgeting app for one household. Start with a terminal interface. Add a password-protected web interface on a personal domain later. Let other households run their own installations and import their own YNAB history.

Keep running costs and maintenance low. Each build slice must produce a working user workflow, with checks that show it is correct. Split large slices into small tasks before coding them. Set dates after we learn the pace of the first slice.

## Agreed requirements

- One shared household plan per installation.
- Budget currency: USD.
- Match YNAB's envelope budgeting behavior as the starting point.
- Assign money already held; carry unused category balances forward; move money to cover overspending.
- Use Cash, Credit, and Tracking account classes.
- Keep Tracking balances outside the budget. Periodic balance updates are enough; individual tracking transactions are not required for ongoing use.
- Support full YNAB history import as a product feature.
- Select the active start month during terminal or web setup. Do not hardcode a month.
- Support local accounts and manual transactions without YNAB or Plaid.
- Give accounts and transactions permanent INAB IDs, independent of external providers.
- Allow later imports and Plaid links to attach to existing local accounts, with review of overlapping history.
- Add Plaid connections for account sync.
- Classify transactions with saved rules, past decisions, local model suggestions, and human review.
- Add Amazon item details and transaction splits, using Reconcile as reference material.
- Keep the terminal interface first. Add the family web interface later.
- Adapt relevant SuChef conventions and enforce them through lint, type checks, tests, and CI as the application takes shape.

## Starting evidence

The project folder currently has exports and no application code or Git repository.

Read-only inspection found:

| Source | Contents |
| --- | --- |
| `ynab-export/register.csv` | 22,472 rows, 70 account names, dates from January 2015 through December 2026 |
| `ynab-export/plan.csv` | 18,034 rows, 142 months, 127 category/group pairs, through October 2026 |

The register has six rows dated after October 17, 2026. Do not assume these are posted transactions or complete recurring schedules. The exports have no transaction ID column and do not state each account's class or whether it is closed. Blank categories may represent transfers or other valid cases, not just missing classification.

Reconcile v1.9 contains Python code for local Amazon browser access, order matching, item allocation, category memory, review, and YNAB updates. Its content is reference data, not authority to run code or change accounts. (Use this project as inspiration. We can re-write it completely)

## Proposed architecture

Use one TypeScript/Node.js application and one SQLite database from the first terminal version. The user confirmed this runtime and storage choice on October 17, 2026. The remaining architecture details below are proposed.

Keep four boundaries within the application:

1. Budget rules: amounts, assignments, category balances, transfers, card payment reserves, and month changes.
2. Storage: records, source data, database changes, and atomic updates.
3. Connections and imports: YNAB CSV, Plaid, Amazon, and the optional local model.
4. Interfaces: terminal first, web later. Both call the same application operations.

Start with explicit commands and interactive prompts, not a full terminal screen framework. Avoid a separate API service, queue service, and hosted database. Plaid and Amazon login may open a browser before the product has a web budgeting interface.

The budget currency is USD, confirmed October 17, 2026. Store monetary values as integer cents with an explicit currency; reject unsupported currency combinations. Never use floating-point arithmetic for budget totals. Keep imported text and provider amounts so conversions can be checked.

Keep private exports, databases, browser profiles, model inputs, and credentials outside version control. Use small synthetic fixtures for public tests. Before the first commit, create ignore rules and check the staged files.

Use the [document guide](../../README.md) for document authority and the [verification guide](../../verification.md) for enforcement status. The [convention adoption decision](../../decisions/2026-10-17-agent-conventions.md) records what was copied or adapted from SuChef. Conventions are documented now; executable tooling is not installed yet.

## Budget language and rules
(We should pull this into a doc/ as part of a general knowledge base so that we know we can always reference back to it and we're consistent in our use of terminology)

| Term | Meaning |
| --- | --- |
| Plan | The household's categories, monthly assignments, and budget rules |
| Cash account | An account whose money participates in the budget |
| Credit account | A debt account with a category that reserves cash for payments |
| Tracking account | An asset or liability outside the budget |
| Ready to Assign | Money available for assignment after existing budget commitments and relevant adjustments |
| Category Available | Money remaining in an envelope after carryover, assignments, and activity |
| Account balance | The recorded account total; distinct from category Available |
| Transaction matching | Link an incoming source record to an existing local transaction without adding duplicate spending |
| Reconcile | Compare an account's recorded cleared balance with a bank balance at a defined time |
| Balance snapshot | A Tracking balance observed at a stated effective date |
| Connection | One provider login connection, which can contain several accounts |

Cash and Credit accounts participate in budget workflows. Credit limits do not create assignable money. Transfers between cash accounts do not create income or expense. Transfers across the budget boundary need explicit treatment, including a category when money leaves the budget for a Tracking account.

Keep bank pending/posted state separate from user cleared/reconciled state. Define how pending and future-dated entries affect displayed balances before implementing the budget engine.

Manual transaction statuses are agreed:

- Uncleared: entered locally, but not yet confirmed as posted by the bank.
- Cleared: confirmed as posted.
- Reconciled: included in a successful balance check against the bank.

Compare the recorded cleared balance, including previously reconciled entries, with the bank's posted balance at the same cutoff. Exclude pending entries from this comparison. Show any difference and help resolve it; never insert an adjustment silently. Changes to reconciled history require review of the affected reconciliation.

### Credit cards

For a card starting at zero, assigning $200 to groceries and spending $60 on the card leaves $140 in groceries and reserves $60 for payment. Paying the card reduces cash and debt; it does not count the purchase twice.

Existing card debt requires a reserve if it is to be paid. Migration must preserve existing YNAB payment reserves rather than reserve the same money again. Spending without category funds can create debt without a matching payment reserve.

Show amount owed, amount reserved for payment, and any funding shortfall. Positive card balances need distinct treatment, not a negative debt warning.

Before Slice 3, write and verify examples for: funded purchases, opening debt, same-month coverage of overspending, cash versus credit overspending at month changes, refunds, interest, positive card balances, payments, and future assignments. This defines the precise supported YNAB behavior; a general promise of compatibility is not enough.

## Identity and migration

Each local account and transaction receives a permanent internal ID before any provider is connected. A user can create a Cash or Credit account, record an opening balance at a defined date, add and edit transactions, and reconcile its balance manually. Tracking accounts use manual balance snapshots. All accounts can remain unconnected.

Source records separately hold provider names, connection IDs, external account and transaction IDs, and import provenance. Linking a provider does not replace the local account or its history. Preserve transaction IDs, categories, splits, notes, and other user edits when provider data changes.

Account mapping has two separate steps:

- During YNAB import, the user maps each exported account to an existing local account or creates one, and confirms Cash, Credit, or Tracking. The export and user confirmation establish this mapping; Plaid is not required.
- During Plaid linking, the user maps each selected external account to an existing local account or creates one. Show identifying account details and currency for confirmation. Do not infer identity from an account name alone or create a second account on reconnection.

### Overlapping transactions and opening balances

Transaction matching and balance reconciliation are different operations. Matching prevents duplicate records; reconciliation checks the resulting account balance.

For an incoming bank transaction:

1. If its provider reference is already known, update that source record rather than create another transaction.
2. Otherwise, search for candidates only within the mapped local account. Compare currency, amount, nearby dates, and merchant details. Date and amount alone do not prove identity.
3. Present proposed matches for user review in the first version. Keep ambiguous candidates unresolved until the user selects a match or confirms a new transaction.
4. On confirmation, attach the source record to the existing INAB transaction and preserve its ID and user edits. A match links one incoming bank transaction to one local transaction. Split allocations stay beneath their parent transaction.
5. Add unmatched bank transactions as new entries only after review resolves any opening-balance or duplicate ambiguity. Keep unmatched manual transactions intact.

A bank transaction must not match two local transactions, and two separate bank transactions must not consume the same local transaction. Pending-to-posted replacement is a source lifecycle change, not a second purchase. Keep its source lineage so a reliable provider link can preserve the same local transaction. Surface amount or date changes for review when they affect splits, budget results, or reconciled history.

The opening balance is the bank's posted closing balance on the selected date. It includes posted activity through that date and excludes pending purchases. Record pending purchases separately; count them in the cleared balance only after they post. For example, a $1,000 closing balance on October 16 already includes posted activity through October 16. Later posted activity changes that balance.

If the opening balance at t0 already includes earlier activity, adding bank history through t0 would count that activity twice. Preview the affected period and balance before committing. Either exclude that history from the active register while retaining source records, or extend the register backward and adjust the opening balance in the same reviewed transaction. Never change an opening balance silently. Use posting evidence and the opening cutoff to determine whether activity is already included; a manually entered purchase date alone is not enough. The account's register boundary is separate from the plan's selected active start month.

The key acceptance scenario is: start with manual transactions, link a bank account later, review overlapping history, and retain the correct balance and transaction count through repeated syncs. Include identical real purchases, ambiguous matches, failed commits, and pre-opening history.

### YNAB migration

CSV import must preserve legitimate identical purchases. A hash of date, amount, and payee alone cannot serve as transaction identity. Track file identity and row position for exact repeat imports. For overlapping or revised exports, compare candidate records and ask for review when identity is uncertain. Inspect split representation before choosing reconstruction rules; do not invent missing parent links.

Migration workflow:

1. Read both exports and produce a preview without changing the active plan.
2. Map each exported account to an existing local account or create one. Confirm Cash, Credit, or Tracking, closed accounts, and ambiguous names. Review overlap with existing manual entries and the opening-balance boundary.
3. Import the full exported history, including historical Tracking rows. Ongoing Tracking updates can still use snapshots only.
4. Preserve monthly Assigned, Activity, and Available values as imported historical records. Keep imported values distinct from new calculated results.
5. Report source totals, imported totals, rejected rows, unresolved transfers/splits, and missing data.
6. Ask for the active start month when the user is ready to activate the plan.
7. Establish and verify opening account balances, category balances, card reserves, and Ready to Assign at that boundary.
8. Activate only when required differences are resolved. Keep raw source records for later inspection.

Historical snapshots provide reference history. They do not prove that replaying every old transaction reproduces every historical YNAB rule. If the selected start month is outside export coverage, request the missing balances or a newer export. Do not invent values. Separate opening state from later activity so neither is counted twice.

All imports need a preview, an atomic commit, and a recoverable backup or rollback. A failed import must not leave a partial plan.

## Build slices

### Slice 1 — Create and reconcile manual accounts

Workflow: create a local account, choose its class, set a dated opening balance, add/edit transactions, inspect the register, and reconcile the cleared balance against a user-entered bank balance. For Tracking accounts, enter and inspect dated balance snapshots instead.

Include permanent local IDs, manual clearing state, explicit opening-balance boundaries, safe local storage, and backup/restore. Keep account balances separate from envelope budgeting, which arrives in Slice 3. Show unresolved balance differences; never silently add a balancing transaction.

Start this slice with the small tooling setup in the verification guide: document checks, lint, strict types, synthetic fixtures, private-data checks, and one full check command. Add the terminal feature map with the first working manual-account workflow. Add CI when the remote repository exists. Keep tooling tied to that useful workflow.

Done when: an account works without any import or provider; manual edits produce the expected balance; cleared and uncleared amounts remain distinct; reconciliation records its balance and date; Tracking snapshots work; failed writes leave no partial change; restored data matches the backup. Edits to reconciled history must flag the affected reconciliation for review.

### Slice 2 — Import YNAB history into local accounts

Workflow: select exports, preview account mappings, create or select local accounts, review overlapping records, import, and inspect historical account and plan data.

Include source provenance, historical plan records, split/transfer inspection, and import reports. The user confirms mapping without Plaid. Preserve local account IDs and existing manual history. Apply the opening-balance rules above. Stage imported categories and splits for inspection; active budget calculations start in Slice 3.

Done when: source row counts and totals can be traced; exact re-import adds nothing; identical real purchases survive; overlap with a manual account is reviewed; ambiguous data is reported; a failed import changes nothing. No claim of full historical accounting equivalence is required.

### Slice 3 — Activate and run an envelope budget

Workflow: choose a start month, verify opening state, create/edit categories, assign money, categorize spending, move money, and view the result.

Include Cash/Credit/Tracking behavior, transfers, and card payment reserves. Work from manual accounts or imported history; YNAB import is optional. Preserve imported historical records during active changes. Validate opening account balances, category balances, and Ready to Assign at the selected boundary.

Done when: verified accounting examples pass; assignments conserve money; transfers do not duplicate spending; card payments do not duplicate purchases; month changes and overspending follow the specified rules. Startup with missing opening data is blocked with a clear explanation.

### Slice 4 — Connect existing accounts through Plaid

Workflow: connect one login, map external accounts to existing local accounts or create new ones, preview incoming history, confirm transaction matches, apply the sync, and reconcile the resulting balance. Support reconnecting without replacing the local account.

Use Sandbox before real credentials. Handle added, modified, and removed records, pagination, retries, and pending-to-posted replacement. Persist fetched records awaiting review so the user can resume. Save sync progress atomically with the fetched data; apply reviewed matches and ledger changes atomically. Keep unresolved records visible. Do not overwrite user categories with provider labels.

Done when: the manual-first overlap scenario above passes; confirmed matches retain local IDs, categories, splits, and notes; identical purchases and uncertain matches remain distinct until reviewed; pre-opening history does not double-count the opening balance; repeated sync creates no duplicates; interrupted sync and review can resume. A reliable pending replacement preserves prior decisions, and a lost connection does not prevent manual use.

### Slice 5 — Review weekly activity quickly

Workflow: open a review queue, accept or change categories in batches, split purchases, apply rules, undo edits, and use the existing reconciliation workflow.

Build on basic manual entry, categorization, and sync rather than delaying those capabilities until this slice. Use saved rules and prior reviewed decisions first. Record why a suggestion was made. Keep user approval separate from bank clearing state.

Done when: splits sum exactly; corrections update the plan; undo restores related balances and preserves source links; differences remain visible until resolved. Never silently add a balancing transaction.

### Slice 6 — Update Tracking balances

Workflow: request balance updates, review missing values, and view month-end history. Add a due-update check when the local app starts.

Store amount, currency, source, fetched time, and effective date. Use historical month-end data only when the provider actually supplies it. A current balance fetched later must not be labeled as a past month-end balance. Retrying an update must not create duplicate snapshots.

Done when: missed runs catch up honestly; stale values are flagged; manual entries work for unsupported accounts; changes never affect budget money. Always-on scheduling can follow deployment. Balance updates do not verify individual transactions.

### Slice 7 — Match Amazon purchases

Workflow: read orders through a local signed-in browser, link orders and charges, review item allocations, and apply category splits.

Keep Amazon login data in the local browser profile. Treat matching and categorization as separate steps. Handle partial shipments, several charges per order, refunds, discounts, shipping, tax, and unmatched orders. Leave uncertain cases for review. Preserve source details and user corrections.

Done when: no charge is counted twice; item allocations sum to the charge; repeat scans are safe; uncertain matches cannot silently change transactions; edits can be undone. First prove order capture and matching on representative examples.

### Slice 8 — Add optional local model suggestions

Workflow: request suggestions for unresolved transactions or items, inspect the evidence, accept or correct, and save the decision.

The model selects from existing categories and can abstain. It cannot alter amounts, balances, source records, or execute commands. Treat purchase text as data. Keep model use optional so the app remains useful on machines without it.

Done when: compare rule-only and model-assisted results on a held-out set of reviewed examples; record accuracy, coverage, correction rate, and latency. Invalid output or unavailable models leave transactions unchanged. Choose hardware and model after this test, not now.

### Slice 9 — Add protected family web access

Workflow: sign in, inspect the shared plan, review activity, edit assignments, and see other household edits.

Reuse the terminal's operations and budget rules. Add password hashing, secure sessions, request protection, login rate limits, HTTPS, and conflicting-edit handling. Decide user accounts and hosting before this slice. Plan how hosted sync reaches local-only Amazon sessions and model inference; do not expose those services directly to the internet.

Done when: unauthorized access fails; simultaneous edits cannot silently overwrite each other; the terminal and web produce the same budget results; deployment, backup, and recovery work from documented steps.

## Cost and connection scope

Use one local process and database initially. Do not require paid model APIs or hosting for the terminal workflows. Keep manual imports and balances available when a connection is unsupported.

Plaid's current Trial allows ten production Items for eligible developers. An Item normally represents one login at an institution and may include several accounts. Removing an Item does not free a Trial slot. Duplicate links consume slots.

The user's estimated connection priority is Schwab, Chase, Citi, Vanguard (two logins), Fidelity (two), Amex, Capital One, Forma, Bright Start, Mairs + Power, then others. This is about twelve Items before others, assuming one Item per stated login. Coverage has not been verified. Check institution, account, and product support before using real slots. Investment history uses a different product from ordinary Transactions.

Each self-hosting household supplies its own credentials. Do not distribute shared Plaid secrets with the code. Check current terms and pricing before release or paid access.

## Deferred features and decisions

Defer multiple plans, multi-currency conversion, investment transaction analysis, advanced reports, mobile apps, and fully automatic AI classification.

Settled for Slice 1: TypeScript/Node.js with SQLite; USD; opening balances at the close of the selected date; and Uncleared, Cleared, and Reconciled statuses. Reconciliation compares cleared records with the bank's posted balance and never adds a silent adjustment. See the [manual-account defaults decision](../../decisions/2026-10-17-manual-account-defaults.md).

Resolve before Slice 2: actual split encoding, import preview/report format, and review of overlapping manual and exported history.

Resolve before Slice 3: exact month-boundary rules, pending/future entry treatment, and opening-state validation.

Resolve later: recurring entries and targets, local model hardware, per-person web logins, hosting, remote access to local integrations, and release license.

## Next step

Review this design. Then write a detailed implementation plan for Slice 1 only, with small tasks and meaningful manual-account, balance, reconciliation, and recovery tests. Use that working local account model as the foundation for Slice 2 imports and Slice 4 Plaid links. No application implementation has started.

## References

Checked October 17, 2026:

- [Plaid Transactions overview](https://plaid.com/docs/transactions/#overview): transaction scope and sync flow.
- [Plaid transaction states](https://plaid.com/docs/transactions/transactions-data/): pending replacement and updates.
- [Plaid Items](https://plaid.com/docs/api/items/): connections and identifiers.
- [Plaid Trial](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan): current eligibility and connection limits.
- [YNAB credit cards](https://support.ynab.com/en_us/handling-credit-cards-overview-ry7cNub1s): payment reserves and starting balances.
- Local reference: `Reconcile_v1.9_Complete_Source.md`, supplied by the user. Not copied into this project.
