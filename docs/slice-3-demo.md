# Slice 3 budget demo

Status: implemented; the user completed manual review on November 10, 2026. All examples use synthetic USD values. Keep database and review files outside the checkout.

## What we want to check

Slice 3 adds envelope budgeting to INAB's accounts, transactions, and imported history. Account balances show where the money is. Budget categories give that money a purpose, such as Food or a card payment. Ready to Assign is the money that still needs a purpose.

This demo checks how those parts work together. We start with $1,000 in Cash and a card with no debt. We review the opening balances, assign money to Food, and check the funds left to spend. The automated path then follows a card purchase, a correction, a payment, and a month change. Spending should reduce the correct category once, and all remaining funds should agree with the account balances.

Activation is the first step. It establishes the budget's starting month, opening funds, and activity through today. We deliberately start in October 2026 to check activation for an earlier month. The guided review asks for the opening values and each elapsed month's assignments. Saving that review prepares it for a separate preview and explicit activation command.

We want to check both the calculated results and the user experience. A reader should understand each question, correct a mistake, leave and resume a draft, and see what will change before activation.

## How to use this guide

1. **Run the automated demo** to check the full accounting scenario for both fresh and migrated plans. It creates and removes its own temporary files and checks the expected results below.
2. **Follow the manual review** to try the guided CLI yourself. It creates a separate demo database and stops after activation. Its expected balances differ from the automated demo because it has no purchases or payments yet. Try help, back, quit and resume, and JSON editing as you review the prompts. Abandon clears the answers if you want to start again.
3. **Complete the user review checklist** at the end. Report unclear questions, unexpected results, or steps that prevent you from finishing. Passing automated checks alone does not complete this review.

Scripted activation is an optional alternative to the guided review. You can skip it when following the manual path. The daily-command walkthrough adds one purchase after activation to check assignments and spending allocation; its correction commands are a reference. Start with the supplied manual answers to get a known result before trying other values.

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
| Category 1 name / group | `Food` / `living` |
| Is Food a card payment reserve? | `no` |
| Food opening Available / evidence | `0.00` / `Confirmed zero` |
| Category 2 name / group | `Card payment` / `cards` |
| Is Card payment a card payment reserve? | `yes` |
| Linked Credit account ID | Press Enter to confirm Synthetic card. To choose another listed Credit account, type its full ID; do not type `$CARD_ID` into the prompt |
| Card payment opening Available / evidence | `0.00` / `Confirmed zero` |
| Opening Ready to Assign / equation evidence | `1000.00` / `Synthetic opening equation` |
| Acknowledge an opening deficit? | `no` |
| October 2026 Assigned: Food / Card payment | `200.00` / `0.00` |
| November 2026 Assigned: Food / Card payment | `50.00` / `0.00` |
| Assigned in any later elapsed month | `0.00` for both categories |
| Additional historical or bridge events | `0` |
| Evidence of complete activity and assignments | `New synthetic accounts; no transactions` |
| Save this completed review? | `yes` |

INAB generates category IDs. A category name is its display name; a group collects related categories. The generated ID links assignments and activity even when you change the name. Existing reviews keep their IDs. Scripted JSON can still provide IDs such as `food` and `payment`.

A **card payment reserve** is cash set aside to pay one Credit account. It is separate from the debt on that card. **Assigned** is the net amount moved into an envelope during the whole month. For example, opening Available of $100 plus Assigned of $200 minus spending of $60 gives Available of $240. Enter $200 as Assigned. A negative Cash balance or negative Ready to Assign is an opening deficit. Acknowledging it means you accept the starting shortfall; it does not add funds or correct the deficit.

**Evidence** is a note about how you checked a value: for example, a dated statement, a previous plan balance, or a confirmed zero. For completeness, describe how you checked the register and each month's assignments through today. No file is attached. Use an honest note if a value is unchecked; `none` does not verify it. The guide prints the opening equation and its difference. The activation preview still checks the opening and account bridges.

Help explains the current question and its accepted answers without saving. Closed-account help gives the exact boundary date. Balance evidence is a note describing the statement or other record you checked; it does not attach a file. Back removes dependent answers. Quit preserves progress and exits. Abandon clears all review answers and exits; it does not change the database. On resume, `continue` uses saved answers, `edit` lists questions with their answers, and `done` leaves without activation. Selecting an answer changes it and asks all later questions again. Selecting 1 starts the questions again. New reviews keep the date covered by their saved answers. An older unfinished review can ask for that original date before it replays answers. If the month has changed, the guide keeps earlier assignments and asks for missing months and fresh completeness notes.

At the final review summary, **Yes** saves a completed review, **No** keeps an unfinished draft, and **Edit** opens just `facts` and `coverage` in Vim. JSON amounts are integer cents: `10000` means $100. Use `:wq` to return to the summary or `:cq` to cancel the edit. Invalid JSON or unknown fields leave saved choices unchanged. Valid edits are saved as a draft; they remain available after No or a later resume. Review identity, database binding, and revision fields are outside the editor. A completed review still needs preview and explicit confirmation.

### 3. Preview and confirm activation

Capture the current review revision from the CLI output, then print its balance summary:

```sh
PREVIEW_RESULT="$(npm run --silent inab -- --db "${DB:?Set DB first}" budget activation preview --review "${REVIEW:?Set REVIEW first}" --json)"
REVIEW_REVISION="$(printf '%s\n' "$PREVIEW_RESULT" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).review.revision')"
printf '%s\n' "$PREVIEW_RESULT" | node -e 'const result = JSON.parse(require("node:fs").readFileSync(0, "utf8")); console.log(JSON.stringify(result.summary, null, 2));'
printf 'Review revision: %s\n' "$REVIEW_REVISION"
```

Check that the opening difference is zero, account bridges are verified, and the calculated amounts match your answers. Preview does not activate the database.

Preview and confirmation JSON include `categoryName` with category IDs in opening balances, assignments, spending allocations, and monthly totals. Use these names to check that the amounts belong to the intended categories.

When ready, use the captured revision for a separate confirmation:

```sh
npm run inab -- --db "${DB:?Set DB first}" budget activation commit --review "${REVIEW:?Set REVIEW first}" --expected-review "${REVIEW_REVISION:?Run preview first}" --confirm --json
npm run inab -- --db "${DB:?Set DB first}" budget show --month 2026-11
```

Expected for this manual activation: Cash/held funds $1,000, Food Available $250, Ready to Assign $750, card balance $0, and payment reserve $0. This manual path has no purchase or payment yet. The automated demo's $195 Food / $945 Cash result also includes the corrected $55 purchase and payment.

The text report aligns category names, full IDs, and amounts in a table, with card balances and reserves in a separate table. Text and JSON reports both preserve the full IDs required by later commands.

Before confirming a different start state, inspect every opening amount and account bridge. An earlier start requires complete activity from that point. A later register opening balance alone does not prove an earlier budget balance. An old pending purchase needs an explicit opening-versus-later treatment. When included in opening, its amount must also be present in the reviewed opening working balance.

Opening ordinary categories must be normalized after the preceding month rollover. Imported negative Available cannot be copied into the first month. Supply reviewed Cash/Credit overspending treatment and resolved opening values. Negative card reserves are allowed and stay visible.

## Optional: activate from a script

**Skip this section if you completed the guided review and activation above.** It describes another way to supply the same reviewed facts. Scripts and automated tests can submit a complete JSON decision instead of answering each interactive question. This makes a known setup repeatable. Someone must still check the values and activity before supplying them.

`budget` is a subcommand of INAB. In this repository, commands start with `npm run inab -- --db "$DB" budget …`; there is no separate `budget` executable.

To try this alternative, create a separate demo database and accounts with manual step 1. Leave that database inactive. Save the JSON below to a file outside the checkout, for example:

```sh
DECISION_FILE="${DEMO_DIR:?Run manual step 1 for a new demo first}/activation-decision.json"
vim "$DECISION_FILE"
```

Replace `CASH_ID` and `CARD_ID` in the JSON with the printed account IDs, and set `throughDate` to today's local date. Include every elapsed category/month assignment, including confirmed zero values. This example starts in November 2026 and has one active month. If today is in a later month, add assignments for each later month too.

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

After saving the file, start a new review for its start month and load the decision:

```sh
SCRIPT_REVIEW="${DEMO_DIR:?Set DEMO_DIR first}/scripted-budget-review.json"
npm run inab -- --db "${DB:?Set DB first}" budget activation start --month 2026-11 --review "$SCRIPT_REVIEW"
npm run inab -- --db "${DB:?Set DB first}" budget activation set --review "$SCRIPT_REVIEW" --expected-review 1 --decision "$(cat "${DECISION_FILE:?Save the decision JSON first}")"
```

These commands replace the guided review in manual step 2. `activation set` saves the decision in the review file; it does not activate the budget. Set `REVIEW="$SCRIPT_REVIEW"`, then follow manual step 3 to preview the values, capture the current review revision, and explicitly confirm activation. The revision `1` above applies to the newly started review.

### Activity JSON reference

The decision above has no activity. The following examples show event shapes for scripts that also need to supply reviewed purchases or transfers. They are reference data, not additional commands to run. All internal amounts are integer cents. Each item in `facts.events` has one of these complete shapes:

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

This optional walkthrough checks how daily budgeting works after activation:

1. Changing Assigned replaces a month's total instead of adding the same funds again.
2. A new purchase appears as unallocated, and the report shows that allocation is incomplete.
3. Allocating the purchase reduces the intended category once and makes the report complete again.

Start from the activated manual example: Cash $1,000, Food Available $250, and Ready to Assign $750. The commands change November's assignment and record a $25 Cash purchase. Run the purchase block once; repeating it creates another purchase.

This short walkthrough covers assignments and spending allocation. Continue with **Finish the four manual checks** below to check clearing, shortfalls, corrections across months, and restore. The other operations section is a reference.

### Find account, category, and transaction IDs

These commands read the Cash account's full ID and find the category named Food, ignoring case. The Food lookup stops if there is no match or more than one match. If you renamed Food or added Cash accounts, inspect the JSON and select the intended full IDs instead.

```sh
CASH_ID="$(npm run --silent inab -- --db "${DB:?Set DB first}" account list --json | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).accounts.find(a => a.kind === "cash").id')"
FOOD_ID="$(npm run --silent inab -- --db "${DB:?Set DB first}" budget show --month 2026-11 --json | node -e '
const categories = JSON.parse(require("node:fs").readFileSync(0, "utf8")).categories;
const matches = categories.filter(c => c.name.toLowerCase() === "food");
if (matches.length !== 1) throw new Error("Expected one Food category. Inspect budget show --json and select its full ID.");
console.log(matches[0].id);
')"
printf 'Cash ID: %s\nFood category ID: %s\n' "$CASH_ID" "$FOOD_ID"

npm run inab -- --db "$DB" register "${CASH_ID:?Read the Cash account ID first}" --json
npm run inab -- --db "$DB" budget status --json
```

Shell assignments such as `FOOD_ID="$(...)"` capture output without printing it. The `printf` above displays the selected IDs. To check a saved value later, run `printf '%s\n' "$FOOD_ID"`. Names and group values normally require exact matches; this Food lookup ignores case. A group can contain several categories, so a group alone does not identify Food.

The register returns transaction IDs as `entries[].id` and transaction revisions as `entries[].revision`. An empty `entries` list means that account has no transactions yet. The activation walkthrough creates accounts and a budget, but no purchases.

Budget revisions and transaction revisions are separate numbers. `budget status` returns the current budget `revision`. Earlier examples used `N` for this number and `T` for a transaction revision; these were placeholders, not valid arguments. The commands below read the actual values.

### Change November's assignment

This helper reads the current budget revision before each budget write. `budget assign --amount` sets the month's Assigned total; it is not an increment. Changing November from $50 to $200 adds $150 to Food.

```sh
demo_budget_revision() {
  npm run --silent inab -- --db "${DB:?Set DB first}" budget status --json |
    node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).revision'
}

npm run inab -- --db "$DB" budget assign --month 2026-11 --category "${FOOD_ID:?Read the Food category ID first}" --amount 200.00 --expected-version "$(demo_budget_revision)" --confirm --json
```

Expected: Food Available $400 and Ready to Assign $600. Cash remains $1,000.

### Create a purchase and allocate it

Create one uncleared $25 Cash purchase. Capture the transaction ID and revision from the result, then inspect the unallocated activity:

```sh
TRANSACTION_JSON="$(npm run --silent inab -- --db "${DB:?Set DB first}" transaction add --account "${CASH_ID:?Read the Cash account ID first}" --date 2026-11-02 --amount -25.00 --payee "Synthetic groceries" --confirm --json)"
TRANSACTION_ID="$(printf '%s\n' "$TRANSACTION_JSON" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).transaction.id')"
TRANSACTION_REVISION="$(printf '%s\n' "$TRANSACTION_JSON" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).transaction.revision')"
printf 'Transaction ID: %s\nTransaction revision: %s\n' "$TRANSACTION_ID" "$TRANSACTION_REVISION"

npm run inab -- --db "$DB" budget activity --month 2026-11 --unallocated --json
```

Expected: the purchase appears as unallocated, and the budget report is incomplete until you allocate it. Adding a transaction also changes the budget revision, so read that revision again before allocation:

```sh
npm run inab -- --db "$DB" budget allocate "${TRANSACTION_ID:?Create the purchase first}" --category "${FOOD_ID:?Read the Food category ID first}" --expected-transaction-version "${TRANSACTION_REVISION:?Read the transaction revision first}" --expected-version "$(demo_budget_revision)" --confirm --json
npm run inab -- --db "$DB" budget activity --month 2026-11 --unallocated --json
npm run inab -- --db "$DB" budget show --month 2026-11
```

Expected: no unallocated events remain, Food Available is $375, Ready to Assign is $600, and Cash/held funds are $975. To find the transaction again later, read the Cash register. Use its latest transaction revision if another operation has changed it.

## Finish the four manual checks

Run these checks in order on the synthetic demo database, after the $25 purchase walkthrough. Reuse the same terminal and its `DB`, `CASH_ID`, `FOOD_ID`, `TRANSACTION_ID`, and `demo_budget_revision` values. The starting report must show Food Available $375, Ready to Assign $600, Cash/held funds $975, and complete allocation. The Cash purchase is still uncleared. If your starting values differ, check which earlier steps you ran before continuing. Run each purchase block once.

Create a private directory for comparison reports and define a helper that reads a transaction's current revision. Its arguments are the account ID and transaction ID:

```sh
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/inab-slice-3-checks.XXXXXX")"
printf 'Comparison reports and backup: %s\n' "$CHECK_DIR"

demo_transaction_revision() {
  npm run --silent inab -- --db "${DB:?Set DB first}" register "$1" --json |
    node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).entries.find(t => t.id === process.argv[1]).revision' "$2"
}

npm run inab -- --db "$DB" budget show --month 2026-11
```

### Check 1: clearing counts the purchase once

Save the November report, inspect the register, and clear the existing $25 purchase on November 3:

```sh
npm run --silent inab -- --db "$DB" budget show --month 2026-11 --json > "$CHECK_DIR/pending.json"
npm run inab -- --db "$DB" register "$CASH_ID" --json
npm run inab -- --db "$DB" transaction clear "${TRANSACTION_ID:?Complete the purchase walkthrough first}" --posted-on 2026-11-03 --expected-version "$(demo_transaction_revision "$CASH_ID" "$TRANSACTION_ID")" --confirm --json
npm run inab -- --db "$DB" register "$CASH_ID" --json
npm run inab -- --db "$DB" budget show --month 2026-11
npm run --silent inab -- --db "$DB" budget show --month 2026-11 --json > "$CHECK_DIR/cleared.json"

node -e '
const fs = require("node:fs");
const [before, after] = process.argv.slice(1).map(path => JSON.parse(fs.readFileSync(path, "utf8")));
require("node:assert/strict").deepStrictEqual(before.month, after.month);
console.log("PASS: clearing preserved every November budget total");
' "$CHECK_DIR/pending.json" "$CHECK_DIR/cleared.json"
```

**Pass:** the register has the same transaction ID once. Its `postedOn` becomes `2026-11-03`. Cleared Cash changes from $1,000 to $975, and uncleared Cash changes from -$25 to $0. Working Cash stays $975. Food stays $375 and Ready to Assign stays $600. The comparison prints `PASS`; it compares calculated month values because the write advances the budget revision.

### Check 2: unallocated spending and a card shortfall stay visible

Create an uncleared $385 card purchase dated November 4. Food has $375 available, so this purchase will exceed its funds by $10. These commands find the demo's single Credit account and capture the new transaction ID:

```sh
CARD_ID="$(npm run --silent inab -- --db "$DB" account list --json | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).accounts.find(a => a.kind === "credit").id')"
CHECK_CARD_JSON="$(npm run --silent inab -- --db "$DB" transaction add --account "$CARD_ID" --date 2026-11-04 --amount -385.00 --payee "Synthetic card check" --confirm --json)"
CHECK_CARD_TXN_ID="$(printf '%s\n' "$CHECK_CARD_JSON" | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).transaction.id')"
printf 'Card purchase ID: %s\n' "$CHECK_CARD_TXN_ID"
npm run inab -- --db "$DB" budget activity --month 2026-11 --unallocated --json
npm run inab -- --db "$DB" budget show --month 2026-11
```

**First pass condition:** the purchase appears in the unallocated activity list. The report ends with `Unallocated:` and its ID, rather than claiming allocation is complete. Category totals are provisional while this activity is unallocated.

Allocate it to Food, then inspect the shortfall:

```sh
npm run inab -- --db "$DB" budget allocate "$CHECK_CARD_TXN_ID" --category "$FOOD_ID" --expected-transaction-version "$(demo_transaction_revision "$CARD_ID" "$CHECK_CARD_TXN_ID")" --expected-version "$(demo_budget_revision)" --confirm --json
npm run inab -- --db "$DB" budget activity --month 2026-11 --unallocated --json
npm run inab -- --db "$DB" budget show --month 2026-11
npm run inab -- --db "$DB" budget show --month 2026-12
npm run --silent inab -- --db "$DB" budget show --month 2026-10 --json > "$CHECK_DIR/october-before-correction.json"
```

**Second pass condition:** the unallocated list is empty, while November shows Food Available -$10, Credit overspent $10, card balance -$385, payment reserve $375, and card Shortfall $10. Ready to Assign stays $600 and Cash/held funds stay $975. December still shows the $10 card shortfall. A complete allocation does not mean every purchase has funds reserved.

The card's Shortfall is the debt without cash reserved for payment. The plan-level `funding deficit` stays zero in this case. Reading December calculates rollover; it does not create a transaction or close November.

### Check 3: a correction changes November and later months

Correct the synthetic card purchase from $385 to $20, keeping its November 4 date. First remove its allocation so the amount can change, then allocate the corrected amount to Food:

```sh
npm run inab -- --db "$DB" budget allocate "$CHECK_CARD_TXN_ID" --unallocated --expected-transaction-version "$(demo_transaction_revision "$CARD_ID" "$CHECK_CARD_TXN_ID")" --expected-version "$(demo_budget_revision)" --confirm --json
npm run inab -- --db "$DB" transaction edit "$CHECK_CARD_TXN_ID" --date 2026-11-04 --amount -20.00 --payee "Synthetic card check" --memo "Corrected demo purchase" --expected-version "$(demo_transaction_revision "$CARD_ID" "$CHECK_CARD_TXN_ID")" --confirm --json
npm run inab -- --db "$DB" budget allocate "$CHECK_CARD_TXN_ID" --category "$FOOD_ID" --expected-transaction-version "$(demo_transaction_revision "$CARD_ID" "$CHECK_CARD_TXN_ID")" --expected-version "$(demo_budget_revision)" --confirm --json
npm run inab -- --db "$DB" budget show --month 2026-10
npm run inab -- --db "$DB" budget show --month 2026-11
npm run inab -- --db "$DB" budget show --month 2026-12
npm run --silent inab -- --db "$DB" budget show --month 2026-10 --json > "$CHECK_DIR/october-after-correction.json"

node -e '
const fs = require("node:fs");
const [before, after] = process.argv.slice(1).map(path => JSON.parse(fs.readFileSync(path, "utf8")));
require("node:assert/strict").deepStrictEqual(before.month, after.month);
console.log("PASS: the November correction left October unchanged");
' "$CHECK_DIR/october-before-correction.json" "$CHECK_DIR/october-after-correction.json"
```

**Pass:** October is unchanged and the comparison prints `PASS`. November and December both show Food Available $355, Ready to Assign $600, Cash/held funds $975, card balance -$20, payment reserve $20, and Shortfall $0. The same card transaction ID remains in the register with a new revision. This proves that the corrected November amount also changes December's rollover. Reports are incomplete during the temporary unallocated step and complete after allocation.

### Check 4: restored reports match the original

Back up the current demo database and restore it to a new path. Restore uses `--from` and `--to`, without `--db`:

```sh
BACKUP_PATH="$CHECK_DIR/backup.sqlite"
RESTORED_DB="$CHECK_DIR/restored.sqlite"
npm run inab -- backup --db "$DB" --to "$BACKUP_PATH" --confirm --json
npm run inab -- restore --from "$BACKUP_PATH" --to "$RESTORED_DB" --confirm --json

for DEMO_MONTH in 2026-10 2026-11 2026-12; do
  npm run --silent inab -- --db "$DB" budget show --month "$DEMO_MONTH" --json > "$CHECK_DIR/original-$DEMO_MONTH.json"
  npm run --silent inab -- --db "$RESTORED_DB" budget show --month "$DEMO_MONTH" --json > "$CHECK_DIR/restored-$DEMO_MONTH.json"
  node -e '
const fs = require("node:fs");
const [original, restored] = process.argv.slice(1).map(path => JSON.parse(fs.readFileSync(path, "utf8")));
require("node:assert/strict").deepStrictEqual(original, restored);
console.log("PASS: original and restored reports match for " + original.month.month);
' "$CHECK_DIR/original-$DEMO_MONTH.json" "$CHECK_DIR/restored-$DEMO_MONTH.json"
done
```

**Pass:** backup and restore succeed, and all three month comparisons print `PASS`. These compare the full JSON reports, including revisions, categories, complete IDs, and calculated values. Your `DB` variable still points to the original database. Keep the comparison directory until you finish the review. Mark the four checklist items only after you run the checks and see their pass conditions.

## Funding a carried card shortfall

If cash only becomes available in December, record and allocate that income in December. Assign enough of December's Ready to Assign to the card payment category. Do not change November's Food assignment to pretend the money existed then. For example, with $10 debt and no reserve from November, December income of $10 supplies Ready to Assign $10. A December payment-category assignment of $10 makes Ready to Assign $0, reserve $10, and shortfall $0. The debt remains until payment. `budget assign --amount` still sets the month's total.

Current and future funding checks use cash already received. They do not reject December's actual funds merely because November lacked that cash. A later month's income cannot fund a backdated assignment that would make the earlier month's Ready to Assign negative.

## Other operations reference

Use repeatable `--line CATEGORY_ID:SIGNED_USD` for splits, `--income` for Ready to Assign treatment, or `--unallocated` for an explicit return to review. To correct an allocated transaction amount, first return it to unallocated, use the existing transaction edit command, then supply the corrected allocation. Reports remain incomplete during that sequence. Ordinary amount edits cannot retain an invalid old allocation.

Live transfers have add, link, edit, and unlink commands. History-only transfers use historical correction or an opening amendment; live edit/unlink commands cannot promote or discard them. Edit both legs through the budget operation; unilateral amount/date edits are refused. Linking keeps existing transaction IDs. Activity versions equal the current budget revision. Historical corrections use `budget activity correct ID --decision JSON --expected-activity-version N --expected-version N --confirm`; the JSON is one complete event with the same ID and source identity. Original import rows stay unchanged.

Opening corrections and date changes across the active boundary set `needs-review`. Use `budget opening amend --month YYYY-MM --review NEW_PATH`, review the replacement facts, preview, and commit. A bridge-changing historical correction also requires this amendment. Reviewed budget balances must also agree with current registers; activity after a register opening cannot exist only as invented budget history. No read command silently repairs an opening.

Check help for required account revisions on transfers and category rename, archive, unarchive, and reorder syntax. Archived categories keep their history. Future assignments cannot use money promised to another month; a later return cannot fund an earlier deficit.

## User review checklist

- [x] The start month and opening evidence are clear.
- [x] Help does not save, back changes the prior answer, quit preserves progress, and abandon clears answers.
- [x] The Food and card values match the expected results for the chosen manual or automated path.
- [x] Pending and cleared views do not count spending twice.
- [x] Unallocated activity and funding shortfalls remain visible.
- [x] A correction changes the correct month and later months.
- [x] Restored reports match the original.

The user confirmed all checklist items complete on November 10, 2026. Automated checks and the separate December-income regression are recorded in the [closeout record](superpowers/plans/2026-11-10-slice-3-closeout.md).
