# Slice 3 budget demo

Status: implemented; user manual review is pending. All examples use synthetic USD values. Keep database and review files outside the checkout.

## Automated demo

Use Node.js 24.16.0 and installed pinned dependencies:

```sh
npm run demo:slice-3
```

The demo builds the CLI and runs it from private temporary directories. It checks both a start-fresh plan and a synthetic migrated plan. It removes its temporary files when finished. The fixed accounting examples start in October 2026; coverage uses the current local date and includes explicit zero assignments for each elapsed month. Run it in November 2026 or later.

Each path starts with Cash $1,000 and a zero-balance card. It activates October, assigns $200 to Food, records a $60 card purchase, corrects that purchase to $55, clears it, pays $55, and assigns another $50 in November. Expected November results:

| Value | USD |
| --- | ---: |
| Cash and total held funds | 945.00 |
| Food Available | 195.00 |
| Ready to Assign | 750.00 |
| Card balance | 0.00 |
| Card payment reserve | 0.00 |

The purchase is counted once. Clearing does not change its budget date. The demo also checks incomplete activation, unallocated activity, a stale revision, safe activation retry after later writes, and backup/restore. Imported monthly records remain source history; they are not replayed as assignments or spending.

## Manual review

Initialize a new private database, then create synthetic Cash and Credit accounts using the existing account commands. Use September 30, 2026 opening balances of $1,000 and $0. Capture their returned IDs.

```sh
npm run inab -- --db "$DB" budget activation start --month 2026-10 --review "$REVIEW"
npm run inab -- --db "$DB" budget activation review --review "$REVIEW" --interactive
npm run inab -- --db "$DB" budget activation preview --review "$REVIEW" --json
```

`DB` and `REVIEW` must be explicit private paths. The review file must be new. The guide asks for the account boundary balances, evidence, categories, card reserve links, Ready to Assign, assignments for each elapsed month, activity treatment, and coverage evidence. Help repeats a question without saving; back removes dependent answers; abandon preserves saved choices. A preview does not activate the database. Use the review revision returned by preview for a separate final confirmation:

```sh
npm run inab -- --db "$DB" budget activation commit --review "$REVIEW" --expected-review REVIEW_REVISION --confirm --json
npm run inab -- --db "$DB" budget show --month 2026-11
```

Before confirming, inspect the account bridge and every opening amount. An earlier start requires complete activity from that point. A later register opening balance alone does not prove an earlier budget balance. An old pending purchase needs an explicit opening-versus-later treatment. When included in opening, its amount must also be present in the reviewed opening working balance.

Opening ordinary categories must be normalized after the preceding month rollover. Imported negative Available cannot be copied into the first month. Supply reviewed Cash/Credit overspending treatment and resolved opening values. Negative card reserves are allowed and stay visible.

## Scripted activation format

`budget activation set --review PATH --expected-review N --decision JSON` accepts this complete shape. Replace IDs with returned local IDs, and `throughDate` with today's local date. Include every elapsed category/month assignment, including confirmed zero values. This example has only one active month:

```json
{
  "kind": "facts",
  "facts": {
    "startMonth": "2026-11",
    "currency": "USD",
    "opening": {
      "accounts": [
        { "accountId": "CASH_ID", "kind": "cash", "balanceCents": 100000, "closed": false, "evidence": "Synthetic statement" },
        { "accountId": "CARD_ID", "kind": "credit", "balanceCents": 0, "closed": false, "evidence": "Confirmed zero" }
      ],
      "categories": [
        { "categoryId": "food", "availableCents": 0, "evidence": "Confirmed zero" },
        { "categoryId": "payment", "availableCents": 0, "evidence": "Confirmed zero" }
      ],
      "readyToAssignCents": 100000,
      "evidence": "Synthetic opening equation",
      "deficitAcknowledged": false
    },
    "categories": [
      { "id": "food", "groupId": "living", "name": "Food", "archived": false, "cardAccountId": null },
      { "id": "payment", "groupId": "cards", "name": "Card payment", "archived": false, "cardAccountId": "CARD_ID" }
    ],
    "assignments": [
      { "month": "2026-11", "categoryId": "food", "amountCents": 0 },
      { "month": "2026-11", "categoryId": "payment", "amountCents": 0 }
    ],
    "events": []
  },
  "coverage": {
    "throughDate": "2026-11-05",
    "evidence": "All synthetic activity checked",
    "includedTransactionIds": [],
    "postedBridgeEventIds": []
  }
}
```

All internal amounts are integer cents. An event is one of these complete shapes:

```json
{
  "kind": "transaction",
  "id": "TRANSACTION_ID",
  "sourceId": "live:TRANSACTION_ID",
  "date": "2026-11-02",
  "order": 0,
  "accountId": "CASH_ID",
  "amountCents": -6000,
  "allocation": { "kind": "categories", "lines": [{ "categoryId": "food", "amountCents": -6000 }] }
}
```

Allocation can instead be `{ "kind": "income" }` or `{ "kind": "unallocated" }`. Unallocated activity blocks activation. After activation, it makes reports incomplete until reviewed. Split lines must sum exactly to the parent signed amount. Combine repeated category lines.

```json
{
  "kind": "transfer",
  "id": "TRANSFER_ID",
  "sourceId": "transfer|FROM_TRANSACTION_ID|TO_TRANSACTION_ID",
  "date": "2026-11-03",
  "order": 1,
  "fromAccountId": "CASH_ID",
  "toAccountId": "CARD_ID",
  "amountCents": 6000,
  "categoryId": null
}
```

A live transfer must match its real legs. Historical imported transfers use `history|FROM_ROW_ID|TO_ROW_ID` with verified equal opposite amounts, mapped accounts, and dates. A Tracking side with no row uses `external:ACCOUNT_ID`. Manual historical transfers use a unique plain manual evidence ID. A source row can supply only one budget effect; never invent split parents or match rows by amount alone. Cash-to-Tracking outflows need a category. Tracking inflows use income (`categoryId: null`) or an explicit refund category. Other Credit transfer directions remain unsupported.

## Daily commands and corrections

`budget status` returns the current budget revision. Every write requires that revision. Transaction allocation also requires the transaction revision. `budget assign --amount` sets the month's Assigned total; it is not an increment.

```sh
npm run inab -- --db "$DB" budget assign --month 2026-11 --category food --amount 200.00 --expected-version N --confirm --json
npm run inab -- --db "$DB" budget allocate TRANSACTION_ID --category food --expected-transaction-version T --expected-version N --confirm --json
npm run inab -- --db "$DB" budget activity --month 2026-11 --unallocated --json
```

Use repeatable `--line CATEGORY_ID:SIGNED_USD` for splits, `--income` for Ready to Assign treatment, or `--unallocated` for an explicit return to review. To correct an allocated transaction amount, first return it to unallocated, use the existing transaction edit command, then supply the corrected allocation. Reports remain incomplete during that sequence. Ordinary amount edits cannot retain an invalid old allocation.

Live transfers have add, link, edit, and unlink commands. History-only transfers use historical correction or an opening amendment; live edit/unlink commands cannot promote or discard them. Edit both legs through the budget operation; unilateral amount/date edits are refused. Linking keeps existing transaction IDs. Activity versions equal the current budget revision. Historical corrections use `budget activity correct ID --decision JSON --expected-activity-version N --expected-version N --confirm`; the JSON is one complete event with the same ID and source identity. Original import rows stay unchanged.

Opening corrections and date changes across the active boundary set `needs-review`. Use `budget opening amend --month YYYY-MM --review NEW_PATH`, review the replacement facts, preview, and commit. A bridge-changing historical correction also requires this amendment. Reviewed budget balances must also agree with current registers; activity after a register opening cannot exist only as invented budget history. No read command silently repairs an opening.

Check help for required account revisions on transfers and category rename, archive, unarchive, and reorder syntax. Archived categories keep their history. Future assignments cannot use money promised to another month; a later return cannot fund an earlier deficit.

## User review checklist

- [ ] The start month and opening evidence are clear.
- [ ] Help, back, abandon, and resume preserve the expected choices.
- [ ] The Food and card values match the demo table.
- [ ] Pending and cleared views do not count spending twice.
- [ ] Unallocated activity and funding shortfalls remain visible.
- [ ] A correction changes the correct month and later months.
- [ ] Restored reports match the original.

Passing automated checks does not mark this manual review complete.
