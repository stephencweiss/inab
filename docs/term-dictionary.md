# Migration term dictionary

Status: shared definitions for migration review help.

This offline reference uses the same definitions as terminal help. The definitions in [migration-terms.ts](../src/cli/migration-terms.ts) are the source; a test checks this document against them.

## Initial setup

Choose fresh to start with manual accounts, or migrate to review YNAB exports. Confirming fresh closes YNAB imports for this database, even while it is empty. Migration prepares choices in a private review file and imports household records only after final confirmation.

## Migration review

Check the exported records and choose how INAB will use them. Choices are saved in a private review file. Review does not import household records. Back returns to the parent menu where shown. Abandon leaves the session and keeps saved choices. An unfinished choice is not saved. Run the same review command to resume.

## Account name

The name INAB will display for this account. It can differ from the source name. When a current value is shown, enter c or confirm to keep it, or type a new name. These controls ignore case. Enter also keeps the current value. Saving is a separate confirmation. Changing this name does not change the exported file or the account at your bank.

## Account kind

cash is checking, savings, or cash in the budget. credit is a credit card account. tracking is an account outside the budget, such as investments. Cash and Credit use opening balances. Tracking uses dated balance observations.

## Closed account

Whether this account is closed. Choose yes to retain it as a closed account, or no for an open account. This choice does not close an account at your bank or remove its source history.

## Opening balance

The initial posted balance in INAB at the end of the selected day. It excludes pending activity. Use the bank's posted closing balance, with credit debt negative. Do not count historical activity covered by this balance a second time.

## Closing balance date

The day for the bank's posted closing balance, written YYYY-MM-DD. The balance is for the end of that day and excludes pending activity. The displayed default is today in your local time zone, not a date taken from the export. Select the date that matches your balance evidence.

## Bank posting date

The day the bank posted an entry, written YYYY-MM-DD. It can differ from the purchase date. A YNAB cleared label does not prove a bank posting date. Supply that date from bank evidence; INAB does not infer it from clearing labels.

## Observed balance

A Tracking balance from external evidence on a stated date. Assets are positive and liabilities are negative. This is a target balance to compare with recorded history, not an amount to add to other observations.

## Observation date

The date of the externally observed Tracking balance, written YYYY-MM-DD. It must match the selected adjustment row's bank posting date. The displayed default is today in your local time zone; confirm it against your evidence.

## Signed USD amount

An amount in US dollars, such as 12.34, -12.34, or 0. Cash assets are positive; credit debt is negative. Tracking assets are positive and liabilities are negative. For activity, inflow is positive and outflow is negative. Do not enter a currency symbol.

## Source row

One record from an exported CSV file. The guide shows its account, date, payee, and amount where available. Choose its displayed number to review it. Original source evidence remains available after review choices are saved.

## Payee

The person or business named on an entry. Review can correct the imported name while retaining original source evidence. Active Cash or Credit entries require a nonblank payee. History can retain an empty source payee.

## Row treatment

history keeps source evidence without changing live balances. pending creates unposted activity. posted uses an explicit bank posting date. Cash and Credit activity already covered by the opening balance must stay in history to avoid counting it twice.

## Row role

transaction is ordinary activity. opening sets the initial Tracking balance. adjustment is a source amount used to compare recorded history with an observed balance. Roles and posting dates require explicit choices; a clearing label does not select them.

## History coverage

Whether the exported history supplies enough evidence for your review. In the History section, history keeps current row choices and acknowledges the coverage warning; edit selects a source row to change; save returns to the summary without adding an acknowledgement or importing records. Acknowledgement does not prove missing posting dates or make history complete. History covered by an opening balance is not added again.

## Tracking observation

An explicit target balance from external evidence, linked to a selected Tracking adjustment row and date. INAB compares it with recorded history. Creating an observation does not silently revise an adjustment. Any revision needs a separate choice and keeps original source evidence for audit.

## Tracking resolution

correct-data keeps the observation while you correct source or balance evidence. revise-adjustment uses the computed adjustment only after you confirm that choice; original source evidence stays in the audit record. defer keeps the difference unresolved. None of these choices creates missing evidence.

## Monthly value conflict

Two or more exported rows give different monthly values for the same category. Check the displayed month, category, and amounts. Acknowledgement keeps the conflicting values as source history; it does not choose a winning value or create an active budget.

## Apply a change

Confirm the displayed change with an explicit yes to apply it. No rejects this change. Abandon leaves the command without applying it. An empty answer does not approve the change. Scripts must supply --confirm.

## Save a review choice

Confirm the displayed proposed values to save them in the private review file. This does not import household records into the database. Rejecting a choice leaves it unsaved. Leaving the session preserves earlier saved choices.

## Final import confirmation

The separate explicit yes that authorizes migration into the selected database. No household records are imported before this confirmation. Import checks the saved review again, creates a private backup, and closes further YNAB imports into this database.

## Source files

The YNAB register and plan CSV exports selected for this review. Keep them private and unchanged while the review is open. INAB checks their saved identity before changes or import. Corrected exports require a new preview and review file.

## Review revision

The version number of the saved review choices. Each saved change advances it. INAB checks this number before a change or import so that an older view cannot replace newer choices. Resume the review if another session has changed it.

## Evidence

Information that supports an account, date, amount, or review choice. Bank records can supply posting dates and observed balances that exports do not prove. Acknowledgement does not replace missing evidence. Save and return when you have the required records.
