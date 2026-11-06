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

Run the commands below from the repository root, in the same terminal tab. Select Node.js 24.16.0 with your version manager first. For example, with nvm, run `nvm use 24.16.0`. Check that `node --version` prints `v24.16.0`. Install pinned dependencies with `npm ci` if needed.

### 1. Create the demo paths and accounts

`DB` and `REVIEW` are shell variables, not values supplied by INAB. An unset `DB` expands to an empty argument and causes `explicit-db-required`. This block sets both variables, creates a new private demo directory, initializes storage, and creates the two synthetic accounts:

```sh
DEMO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/inab-slice-3-manual.XXXXXX")"
DB="$DEMO_DIR/plan.sqlite"
REVIEW="$DEMO_DIR/budget-review.json"

printf 'Demo directory: %s\nDatabase: %s\nReview file: %s\n' "$DEMO_DIR" "$DB" "$REVIEW"

npm run inab -- --db "$DB" init --confirm

CASH_ID="$(npm run --silent inab -- --db "$DB" account add --name "Synthetic cash" --kind cash --opening 1000.00 --as-of 2026-09-30 --confirm --json | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).account.id')"
CARD_ID="$(npm run --silent inab -- --db "$DB" account add --name "Synthetic card" --kind credit --opening 0.00 --as-of 2026-09-30 --confirm --json | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).account.id')"

printf 'Cash ID: %s\nCard ID: %s\n' "$CASH_ID" "$CARD_ID"
npm run inab -- --db "$DB" account list --json
```

Expected: two accounts, Cash opening 100000 cents and Credit opening 0 cents, both dated September 30, 2026. INAB creates the database and tables. Do not create an empty `.sqlite` file or a review file yourself. Creating the first account completes start-fresh setup.

The files remain in the printed demo directory for inspection, until you or the system remove them. Save the printed paths. Shell variables apply only to this terminal session. In a new terminal, set `DB` and `REVIEW` to those existing paths to resume; do not repeat account creation. The commands below guard against unset paths before invoking INAB.

### 2. Start and complete the guided review

Run `activation start` once for this new review file. To resume an existing review, run only `activation review`:

```sh
npm run inab -- --db "${DB:?Run manual setup in this terminal first}" budget activation start --month 2026-10 --review "${REVIEW:?Run manual setup in this terminal first}"
npm run inab -- --db "${DB:?Set DB to the printed database path}" budget activation review --review "${REVIEW:?Set REVIEW to the printed review path}" --interactive
```

Use these answers. Accounts can appear in either order; use their displayed names.

| Prompt | Answer |
| --- | --- |
| Was Synthetic cash/card closed at the boundary? | `no` for each |
| Boundary balance for Synthetic cash | `1000.00` |
| Boundary balance for Synthetic card | `0.00` |
| Independent boundary balance evidence | `Synthetic September statement` for each |
| Number of categories, including card reserves | `2` |
| Category 1 stable ID / name / group | `food` / `Food` / `living` |
| Is Food a card payment reserve? | `no` |
| Food opening Available / evidence | `0.00` / `Confirmed zero` |
| Category 2 stable ID / name / group | `payment` / `Card payment` / `cards` |
| Is Card payment a card payment reserve? | `yes` |
| Linked Credit account ID | Paste the printed Card ID value, without quotes; do not type `$CARD_ID` into the prompt |
| Card payment opening Available / evidence | `0.00` / `Confirmed zero` |
| Opening Ready to Assign / equation evidence | `1000.00` / `Synthetic opening equation` |
| Acknowledge an opening deficit? | `no` |
| October 2026 Assigned: Food / Card payment | `200.00` / `0.00` |
| November 2026 Assigned: Food / Card payment | `50.00` / `0.00` |
| Assigned in any later elapsed month | `0.00` for both categories |
| Additional historical or bridge events | `0` |
| Evidence of complete activity and assignments | `New synthetic accounts; no transactions` |
| Save this completed review? | `yes` |

Help repeats a question without saving; back removes dependent answers; abandon preserves saved choices. On resume, `continue` uses saved answers, `edit` changes a selected answer, and `done` leaves without activation. A completed review still needs preview and confirmation.

### 3. Preview and confirm activation

Capture the current review revision from the CLI output, then print its balance summary:

```sh
PREVIEW_RESULT="$(npm run --silent inab -- --db "${DB:?Set DB first}" budget activation preview --review "${REVIEW:?Set REVIEW first}" --json)"
REVIEW_REVISION="$(printf '%s\n' "$PREVIEW_RESULT" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).review.revision')"
printf '%s\n' "$PREVIEW_RESULT" | node -e 'const result = JSON.parse(require("node:fs").readFileSync(0, "utf8")); console.log(JSON.stringify(result.summary, null, 2));'
printf 'Review revision: %s\n' "$REVIEW_REVISION"
```

Check that the opening difference is zero, account bridges are verified, and the calculated amounts match your answers. Preview does not activate the database. When ready, use the captured revision for a separate confirmation:

```sh
npm run inab -- --db "${DB:?Set DB first}" budget activation commit --review "${REVIEW:?Set REVIEW first}" --expected-review "${REVIEW_REVISION:?Run preview first}" --confirm --json
npm run inab -- --db "${DB:?Set DB first}" budget show --month 2026-11
```

Expected for this manual activation: Cash/held funds $1,000, Food Available $250, Ready to Assign $750, card balance $0, and payment reserve $0. This manual path has no purchase or payment yet. The automated demo's $195 Food / $945 Cash result also includes the corrected $55 purchase and payment.

Before confirming a different start state, inspect every opening amount and account bridge. An earlier start requires complete activity from that point. A later register opening balance alone does not prove an earlier budget balance. An old pending purchase needs an explicit opening-versus-later treatment. When included in opening, its amount must also be present in the reviewed opening working balance.

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
- [ ] The Food and card values match the expected results for the chosen manual or automated path.
- [ ] Pending and cleared views do not count spending twice.
- [ ] Unallocated activity and funding shortfalls remain visible.
- [ ] A correction changes the correct month and later months.
- [ ] Restored reports match the original.

Passing automated checks does not mark this manual review complete.
