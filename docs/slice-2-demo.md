# Slice 2 synthetic migration demo

Status: the synthetic workflow uses the built CLI. User manual review remains pending. No household export or database is used.

Run from the Slice 2 checkout with Node.js 24.16.0 and installed dependencies. The automated demo creates temporary databases and copies synthetic CSV fixtures. It runs the built CLI from another working directory, checks the results, then removes its temporary files. The manual review below keeps its files for inspection.

The migration requires an empty database with setup open. Review can pause before import; confirmation commits all records and closes migration. The history view preserves source amounts and clearing labels. It does not prove bank posting dates or historical accounting equivalence. No active budget is created.

```sh
npm run demo:slice-2
```

This command builds the CLI and runs [the TypeScript demo](../scripts/demo-slice-2.ts).
To run the file directly after a build, use `npx tsx scripts/demo-slice-2.ts`.

Expected final output: `{"syntheticDemo":"passed","sourceRows":5,"trackingObservedCents":13000,"trackingAdjustmentCents":3000}`. Build output appears before it. The original +25 Tracking adjustment remains in source/audit history; the explicitly confirmed active adjustment is +30.

## Normal migration path

The interactive guide explains these steps before asking for choices:

1. Keep YNAB transactions as history for inspection. They do not change active balances.
2. Set Cash/Credit starting balances from the bank's posted closing balance on a chosen date. History covered by that balance is not added again.
3. After confirming import, use INAB for new activity. Later posted transactions affect balances; pending activity stays separate.

Moving imported rows into active activity is optional. Tracking accounts use reviewed balance observations and adjustments. Monthly plan history remains available for inspection.

A terminal launch displays the INAB ASCII banner in cyan, followed by INAB CLI, the current version, and the household budgeting description. JSON, scripts, and version output omit it.

## Manual review

The script above is an automated check. It prints a pass summary and deletes its temporary databases and review files. It does not pause for manual inspection.

Run these commands from the Slice 2 worktree:

```sh
cd /Users/sweiss/.codex/worktrees/slice-2/inab
mkdir -p /Users/sweiss/inab-demo

npm run inab -- --db /Users/sweiss/inab-demo/demo.sqlite init --confirm

cp tests/fixtures/ynab/register.csv /Users/sweiss/inab-demo/register.csv
cp tests/fixtures/ynab/plan.csv /Users/sweiss/inab-demo/plan.csv
```

INAB creates the SQLite database and its tables. Do not create an empty `.sqlite` file yourself. The copied CSVs contain synthetic data only. Use a new demo directory for each manual session; do not overwrite files from an earlier review.

Create the migration review file:

```sh
npm run inab -- --db /Users/sweiss/inab-demo/demo.sqlite setup migrate preview \
  --register /Users/sweiss/inab-demo/register.csv \
  --plan /Users/sweiss/inab-demo/plan.csv \
  --review /Users/sweiss/inab-demo/review.json
```

Preview creates `review.json`; do not create it yourself. It saves review choices outside the database. The database remains empty and setup remains open until import confirmation.

Open the interactive review:

```sh
npm run inab -- --db /Users/sweiss/inab-demo/demo.sqlite setup migrate review \
  --review /Users/sweiss/inab-demo/review.json --interactive
```

These are real absolute paths for this machine. The files remain in `/Users/sweiss/inab-demo` after the commands finish. Run the review command again to resume the same session.

The guide selects the source account for you. Each question offers help and `[a]bandon`. Enter `h`, `H`, or `help` to read the relevant definition from the shared [term dictionary](term-dictionary.md). The History action menu uses `h` or `H` for history; enter the full word `help` there. Help repeats the same question and keeps its default. It does not save a choice, change the review revision, or confirm a write.

For these fixtures, use these answers:

| Step | Answer | Meaning |
| --- | --- | --- |
| Start migration review | Press Enter, or enter `c` / `continue` | Begin or resume the guided steps. `d` / `done` leaves normally; `a` / `abandon` cancels the session. Saved choices remain in either case. |
| Account 1 of 1: Demo cash; name | Press Enter | Keep `Demo cash`. |
| Account kind | `cash` | Checking, savings, or cash in the budget. Other choices are `credit` for credit cards and `tracking` for accounts outside the budget. The guide introduces these choices before asking; `abandon` leaves without saving the current account choice. |
| Is this account closed? | Press Enter, or enter `n` / `no` | Keep the account open (default). Use `y` / `yes` for a closed account, or `a` / `abandon` to leave. `true` and `false` are not accepted. |
| Save this review choice? | Press Enter, or enter `Y` / `yes` | Save the account mapping in the review file. |
| Posted closing balance date | `2026-10-22` | Set the synthetic opening cutoff. Dates use `YYYY-MM-DD`. The displayed default is today from the local calendar; opening-date help explains this source and the posted closing balance. |
| Opening balance | `100.00` | Set a synthetic Cash closing balance of 100 USD. |
| Save this review choice? | Press Enter, or enter `Y` / `yes` | Save the opening values. |
| History action | `h` / `history` | Keep the current row choices and acknowledge unverified history coverage. For these fixtures, the three source register rows remain history outside active balances. |
| Save this review choice? | Press Enter, or enter `Y` / `yes` | Acknowledge that the CSV does not prove complete historical coverage. |
| Review complete. Next | `save` | Leave without importing. The same command resumes this review. |

Each section starts after a blank line. The History section places its heading before the account context and explains each action:

```text

History:
Account: Demo cash
Source history does not prove complete coverage. History-only rows do not change live balances.
history: keep the current row choices and acknowledge unverified history coverage; history-only rows stay outside active balances.
edit: select a source row and change its treatment/evidence.
save: leave this section for the summary without adding an acknowledgement; previously saved choices remain. No import occurs.
--> Action ([h]istory, [e]dit, [s]ave, [a]bandon, help):
```

Here `h` / `H` chooses history, `e` / `E` opens row selection, `s` / `S` returns to the summary, and `a` / `A` leaves the session. The full word `help`, in any case, shows the definition and repeats the action question. Saving this section does not add a coverage acknowledgement or import records. Previously saved row choices remain in all cases.

The summary should show one Cash account, an opening of 100 USD on October 22, 2026, five source rows, five history-only rows, no live-linked rows, and no required issues. The five rows include three register rows and two plan rows. The split-parent warning remains: the CSV does not supply that relationship evidence. This synthetic Cash fixture has no Tracking observation to review.

Saved mapping and opening prompts show `[k]eep (default), [e]dit, [h]elp, [a]bandon`. Keeping them does not save a new revision.

On resume, press Enter or enter `c` / `continue`, then press Enter or enter `k` / `keep` for each saved mapping and opening, and `history` to keep the existing history choice. Already saved coverage acknowledgement does not require another confirmation. At the summary, `review` opens numbered account, row, observation, and warning choices. To test import, choose `import` and then `yes` at the separate confirmation. This completes setup and prevents later imports into that database. Choose `save` if you want to keep reviewing first.

When a text field has a current value, the guide offers explicit confirmation:

```text
--> Account name: current value is [Demo cash]. [c]onfirm or type new name; or [h]elp, or [a]bandon:
```

Enter `c` or `confirm`, ignoring case, to keep that name. Enter also keeps it. Type another name to replace it. A later save question confirms the full proposed account choice. Existing payee text uses the same controls; dates, amounts, IDs, and file paths keep their own input formats.

Before each save, the guide shows the full proposed choice. For an account named `Deeemo cash`, this looks like:

```text
Account 1 of 1: Deeemo cash
Kind: cash
Closed: no
--> Save this review choice? ([Y]es (default), [N]o, [h]elp, [A]bandon):
```

Enter saves the displayed choice. `N` / `no` rejects that choice; `A` / `abandon` leaves the session. Previously saved choices remain. These shortcuts ignore case. Final import still requires a separate explicit confirmation.

Every question lists its accepted values or input format. Menus mark each available first-letter shortcut in brackets, such as `[r]eview`, `[s]ave`, and `[t]racking`. A first letter is available only when it is unique and not reserved for help or abandon. Invalid input repeats that question. Choices ignore case. Except for reserved `h` and `a`, a unique first letter selects an enum choice: `t` or `T` selects `tracking`, but `c` is ambiguous between `cash` and `credit`, so enter the full word. Except at the History action menu, help reserves `h`; abandon reserves `a`. Enter the full word for choices such as row treatment `history`, `accounts`, and `adjustment`. Generic yes/no questions accept `y`, `Y`, `n`, or `N` and have no default unless the question shows one. The save-choice question defaults to yes; final import requires an explicit yes.

Nested menus offer `[b]ack`. Enter `b`, `B`, or `back` to return to the previous menu. Back discards the unfinished choice and keeps all confirmed choices. It does not change the review revision or import records. The evidence menu returns to the summary; observation actions return to the observation list; adjustment-row selection returns to the account chooser. An empty adjustment-row list still offers Back. Row treatment returns to the source-row chooser. Account actions and monthly conflict actions return to their lists. History reached from a warning offers Back to that warning list; initial account History uses Save to return to the summary.

Free-text, date, and amount questions do not offer Back. Use abandon to leave the session and resume from the same private review file. If an older open session does not show Back, leave with `a`, start the updated review command again, and select the same review file. Confirmed choices remain; a new preview is not needed.

Enter `a` or `abandon` to leave. The hidden `cancel` alias also works. Previously confirmed choices remain; the current unfinished choice is not saved. Help at a save question only explains the proposed save. Answer the repeated question to save, reject, or leave.

`--interactive` and `-i` explicitly request the guide and require a terminal. Omitting the flag in a terminal also starts the guide. For script inspection, replace `--interactive` with `--json`; this prints review data without prompts. Do not combine these flags. Scripted changes still use explicit commands such as `setup migrate account` with all required arguments.

A source `Cleared`/`Reconciled` label does not supply a bank posting date. Use history `edit` only when you can supply the evidence needed for pending or posted treatment. Rows are selected by number and show their date, payee, amount, treatment, and role. Tracking rows also allow explicit opening and adjustment roles. In observation review, select posted adjustment evidence and supply an external observed balance. The guide does not invent a balance or revise an adjustment without confirmation. Unresolved source evidence can be saved for later review.

The synthetic Cash example keeps all source history outside its opening balance; it does not count purchases twice. Source-only history remains inspectable after setup closes.

Cancellation, descriptor limits, malformed inputs, target/source replacement, review locking, injected failures at each commit stage, concurrent confirmations, audit retention for discarded observations, and migration recovery have automated tests. Run `npm run check` for current evidence. A successful synthetic demo does not authorize importing household data or prove full historical YNAB accounting equivalence.

If a running review still shows `cancel` or rejects `y`, leave that session and run the review command again from the Slice 2 worktree. A running Node.js process keeps the code it already loaded. Restarting loads the updated prompts and resumes confirmed choices from the same review file.

When the summary has required issues, its next-action prompt shows `[r]eview (default), [s]ave, [h]elp, [a]bandon`. Press Enter to review the remaining evidence. This does not save a revision or import records. A complete review has no default next action.

## Understand warnings and blockers

Select a numbered issue to see its meaning, effect, and action. A warning alone does not block import.

- **Posting date overlaps opening balance:** A transaction posted on October 23 cannot be added to an opening balance at the close of October 29 without counting it twice if that balance covers it. Keep the row as history when covered. Otherwise correct the opening balance date/amount or posting date from bank evidence. A repeated account-level check is shown once with the affected row; raw validation is retained.
- **History completeness is not verified:** The export does not prove a complete account history. Confirming History accepts this limit. The required acknowledgement clears, but the warning remains. History-only rows remain inspectable without changing active balances.
- **Split purchase links are not in the export:** A split is one purchase allocated to several categories. The export does not prove which rows belong together. INAB retains rows without rebuilding those links. This warning does not prove that splits exist; no action is required.

After a confirmed save, look for `Cleared blocker`, `Acknowledged ... warning remains`, or `New blocker`. These messages describe the change in review checks. They do not mean missing source evidence was recovered. The full saved proposal appears before confirmation so you can see which treatment, date, or amount you accepted.

If you reopen the same review after its import completed, the text command prints `Migration completed` and exits without prompts or another import. The matching stored receipt is checked even if the original CSV files were removed. A replaced or mismatched database still reports `stale-target`. JSON inspection keeps its current response contract.
